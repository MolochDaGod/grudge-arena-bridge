# Grudge Arena Bridge

Play Vanilla WoW (1.7.1) in the browser — no download required.

**Live:** https://wow.grudge-studio.com

## What Is This?

A Node.js bridge server that connects a web frontend to a private MaNGOS Vanilla WoW server. One player runs the WoW client locally, the other plays through the browser via VNC streaming — same server, two access methods.

```
┌─────────────────────────────────────────────────────────────┐
│                        VPS (Windows Server)                 │
│                                                             │
│  MaNGOS Server (Vanilla 1.7, build 4695)                    │
│  ├── realmd (:3724)       ← realm/login server              │
│  ├── mangosd (:8085)      ← world server + SOAP (:7878)     │
│  └── MySQL (:3307)        ← realmd, mangos, characters DBs  │
│                                                             │
│  Grudge Arena Bridge (Node.js :3001)                        │
│  ├── Express API          ← auth, characters, queue, play   │
│  ├── Static frontend      ← public/ (HTML/CSS/JS)           │
│  └── WebSocket /vnc       ← proxies browser → TightVNC      │
│                                                             │
│  TightVNC (:5900)         ← WoW.exe visible on VNC desktop  │
│                                                             │
│  Cloudflare Tunnel        ← secure routing, no exposed ports │
│  └── wow.grudge-studio.com → localhost:3001                  │
└─────────────────────────────────────────────────────────────┘

Player A (local):   WoW.exe → realmlist 74.208.155.229 → MaNGOS
Player B (browser): wow.grudge-studio.com → Puter login → VNC stream → WoW
```

## How It Works

1. **Browser player** visits `wow.grudge-studio.com`
2. Logs in via **Puter SDK** — this creates/links a MaNGOS account automatically
3. Picks faction → race → class → spec → name (character creation UI)
4. Clicks **Play** — bridge launches WoW.exe on the VPS desktop, auto-fills login credentials
5. **noVNC** streams the WoW client to the browser via WebSocket (`/vnc` → TightVNC :5900)
6. Player sees and controls WoW directly in the browser tab

The **local player** just runs WoW 1.7.1 with the realmlist pointed at the VPS IP and logs in normally.

## Verified Systems

| System | Status | Details |
|--------|--------|---------|
| DNS | ✅ Verified | `wow.grudge-studio.com` → Cloudflare Proxy |
| Cloudflare Tunnel | ✅ Verified | Routes `wow.grudge-studio.com` → VPS :3001 |
| Bridge API | ✅ Code ready | Express server with auth, characters, queue, VNC |
| Frontend | ✅ Code ready | Intro video, Puter auth, character creator, noVNC viewer |
| Puter Auth | ✅ Integrated | `puterUuid` → MaNGOS account (auto-create via SOAP) |
| VNC Streaming | ✅ Code ready | TightVNC + noVNC websocket proxy in server.js |
| MaNGOS 1.7 | ✅ Deployed | realmd + mangosd + MySQL on VPS |
| WoW Auto-Login | ✅ Code ready | wow-launcher.ps1 — SendKeys credentials into WoW.exe |

> **Note:** VPS services need to be started after each reboot. See [Startup](#startup-order).

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Puter UUID → MaNGOS account (creates if new) |
| GET | `/api/character/options` | Race/class combos for patch 1.7 |
| GET | `/api/character/class/:classId` | Premade specs & gear for a class |
| POST | `/api/character/create` | Create level 60 premade character |
| POST | `/api/queue/join` | Queue WSG (2v2/3v3/5v5 with battlebots) |
| GET | `/api/queue/status/:matchId` | Check match status |
| GET | `/api/record/:accountId` | Win/loss history |
| POST | `/api/play/session` | Start VNC game session (returns wsUrl) |
| POST | `/api/play/disconnect` | End VNC session |
| GET | `/api/play/stats` | Active session info |
| POST | `/api/admin/soap` | Raw SOAP GM command |
| POST | `/api/admin/cleanup` | Remove all battlebots |
| GET | `/api/health` | DB + SOAP connectivity check |

## Project Structure

```
grudge-arena-bridge/
├── server.js              ← Express API + WebSocket VNC proxy
├── lib/
│   ├── character.js       ← Puter UUID → MaNGOS account, premade characters
│   ├── mangos-db.js       ← MySQL pools (realmd, mangos, characters)
│   ├── mangos-soap.js     ← SOAP commands (account create, GM commands)
│   ├── vnc-stream.js      ← VNC session manager (launch WoW, track sessions)
│   ├── queue.js           ← WSG queue with battlebot filling
│   └── guacamole.js       ← (legacy, replaced by vnc-stream.js)
├── public/
│   ├── index.html         ← Main frontend (login, character create, game viewer)
│   ├── app.js             ← Frontend logic (Puter auth, noVNC, API calls)
│   ├── style.css          ← UI styles
│   ├── novnc/             ← noVNC client library
│   ├── img/               ← Race and faction images
│   └── *.png, *.mp4       ← Splash, logo, intro video, background
├── scripts/
│   ├── deploy-vps.ps1     ← Full VPS deployment (tunnel, MaNGOS, bridge)
│   ├── install-tightvnc.ps1
│   ├── bootstrap-local-web.ps1
│   └── admin-repair-local-web.ps1
├── streaming/
│   ├── docker-compose.yml ← (legacy Guacamole setup, replaced by VNC)
│   └── SETUP.md
├── wow-launcher.ps1       ← Auto-launches WoW.exe with credentials via SendKeys
├── SMOKE-TEST.md          ← Latest smoke test results
├── VPS-HANDOFF.md         ← VPS deployment details
├── .env                   ← Config (not committed)
└── package.json
```

## Startup Order

On the VPS, start services in this order:

1. **MySQL** — via bropack launcher or `mysqld.exe`
2. **realmd.exe** — realm/login server
3. **mangosd.exe** — world server (wait for "World initialized")
4. **TightVNC** — must be running for browser streaming
5. **Bridge** — `node server.js` in this directory

Or run everything at once:
```powershell
.\scripts\deploy-vps.ps1
```

## Local Development

```bash
npm install
# Copy .env.example to .env and configure
npm run dev    # node --watch server.js
```

Requires MySQL with MaNGOS databases and SOAP endpoint available locally.

## DNS & Networking

- `wow.grudge-studio.com` → Cloudflare Tunnel → VPS :3001
- No ports exposed directly — all traffic goes through the encrypted tunnel
- MySQL (:3307) and SOAP (:7878) are localhost-only on VPS

## Auth Flow

```
Browser → Puter SDK popup → puterUuid returned
  → POST /api/auth/login { puterUuid }
  → Bridge checks realmd DB for existing account (email = grudge:<puterUuid>)
  → If new: SOAP .account create GA_<md5hash> <random_password>
  → Returns { accountId, username, isNew, password? }
  → Frontend stores credentials for VNC auto-login
```

## Game Streaming Flow

```
POST /api/play/session { accountId, username, password }
  → Bridge checks TightVNC is alive (TCP probe :5900)
  → Launches wow-launcher.ps1 (starts WoW.exe, auto-fills credentials)
  → Returns { wsUrl: "wss://wow.grudge-studio.com/vnc" }
  → Frontend connects noVNC to wsUrl
  → server.js WebSocket proxy: browser ↔ TightVNC :5900
  → Player sees and controls WoW in the browser
```

## License

Private — Grudge Studio / Racalvin The Pirate King
