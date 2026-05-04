# Grudge Arena Bridge — VPS Handoff

## VPS Info
- **Host:** 74.208.174.62
- **OS:** Windows Server
- **User:** Administrator
- **SSH Key:** `C:\Users\nugye\.ssh\grudge-deploy-key`

## What's Deployed
The entire `Vanilla bropack v23` package was zipped and transferred as a single archive (`vanilla-bropack-full.7z`, 8.4 GB) and extracted to `C:\Vanilla bropack v23\` on the VPS. This mirrors the local setup exactly.

### Directory Layout (VPS)
```
C:\Vanilla bropack v23\
├── MaNGOS\
│   ├── mangosd.exe          ← World server
│   ├── realmd.exe            ← Login/realm server
│   ├── mangosd.conf          ← World config
│   ├── realmd.conf           ← Realm config
│   ├── grudge-arena-bridge\  ← Node.js API bridge
│   │   ├── server.js         ← Express API (port 3001)
│   │   ├── .env              ← Config (DB, SOAP, CORS, Guac)
│   │   ├── lib\
│   │   │   ├── character.js  ← Grudge ID → MaNGOS account, level 60 premades
│   │   │   ├── mangos-db.js  ← MySQL pools for realmd/mangos/characters DBs
│   │   │   ├── mangos-soap.js← SOAP commands (account create, battlebots)
│   │   │   └── queue.js      ← WSG queue with bot filling, W/L tracking
│   │   ├── streaming\        ← Guacamole docker-compose for browser WoW
│   │   ├── node_modules\     ← Dependencies (included, no npm install needed)
│   │   └── package.json
│   ├── mysql5\               ← Bundled MySQL (root/root)
│   ├── data\                 ← Maps, vmaps, mmaps, dbc
│   ├── sql\                  ← DB schemas
│   └── tools\
```

## Running Services

### 1. MySQL (bundled)
Starts with the bropack launcher. Default creds: `root` / `root` on port `3306`.
Databases: `realmd`, `mangos`, `characters`.

### 2. MaNGOS (realmd + mangosd)
- **Patch:** 1.7 — Rise of the Blood God
- **Client build:** 4695
- **SOAP:** `http://127.0.0.1:7878` (admin/admin)
- Start via the bropack batch files or run `realmd.exe` then `mangosd.exe` directly.

### 3. Grudge Arena Bridge (Node.js)
```
cd "C:\Vanilla bropack v23\MaNGOS\grudge-arena-bridge"
node server.js
```
Runs on port **3001**.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Grudge ID → MaNGOS account (creates if new) |
| GET | `/api/character/options` | Race/class combos for this patch |
| GET | `/api/character/class/:classId` | Premade specs & gear for a class |
| POST | `/api/character/create` | Create level 60 premade character |
| POST | `/api/queue/join` | Queue WSG (2v2/3v3/5v5) with battlebots |
| GET | `/api/queue/status/:matchId` | Check match status |
| GET | `/api/record/:accountId` | W/L history |
| POST | `/api/play/session` | Get Guacamole streaming URL |
| POST | `/api/admin/soap` | Raw SOAP GM command |
| POST | `/api/admin/cleanup` | Remove all battlebots |
| GET | `/api/health` | DB + SOAP connectivity check |

## .env Config (already correct for VPS)
```
MANGOS_DB_HOST=127.0.0.1
MANGOS_DB_PORT=3306
MANGOS_DB_USER=root
MANGOS_DB_PASS=root
SOAP_HOST=127.0.0.1
SOAP_PORT=7878
SOAP_USER=admin
SOAP_PASS=admin
PORT=3001
CORS_ORIGIN=https://wow.grudge-studio.com,http://localhost:3000
PUTER_APP_NAME=grudge-arena
GUAC_HOST=localhost
GUAC_PORT=8080
DOMAIN=wow.grudge-studio.com
```

## How It All Connects
```
Browser (wow.grudge-studio.com)
    │
    ▼
Grudge Arena Bridge (port 3001)
    │
    ├──► MySQL (port 3306) — realmd, mangos, characters DBs
    ├──► MaNGOS SOAP (port 7878) — account creation, battlebots, GM commands
    └──► Guacamole (port 8080) — browser-streamed WoW client sessions
             │
             ▼
         RDP → WoW.exe → MaNGOS (port 8085 world, 3724 realm)
```

## Game Streaming (Guacamole) — Not Yet Active
The `streaming/` folder has a Docker Compose setup for Apache Guacamole. This lets players play WoW directly in the browser with zero download.

### To activate:
1. Install Docker on the VPS
2. Install WoW 1.7.1 client at `C:\WoW\`
3. Set realmlist to `127.0.0.1`
4. Enable RDP on the VPS
5. `cd "C:\Vanilla bropack v23\MaNGOS\grudge-arena-bridge\streaming" && docker-compose up -d`
6. Each player gets a unique Guacamole session via the bridge API

### Scaling
- 1 player ≈ 512MB RAM + 1 CPU core
- 10 players ≈ 8GB RAM + 4-8 cores
- Windows Server needed for multiple concurrent RDP sessions

## Startup Order
1. MySQL (via bropack launcher or `mysql5\bin\mysqld.exe`)
2. `realmd.exe`
3. `mangosd.exe` (wait for "World initialized")
4. `node server.js` in `grudge-arena-bridge\`

## DNS / Firewall
- Point `wow.grudge-studio.com` → `74.208.174.62` (Cloudflare)
- Open ports: **3001** (bridge API), **8080** (Guacamole), **3724** (realmlist, if direct client connect)
- Keep **3306** (MySQL) and **7878** (SOAP) local only — do NOT expose

## Old Scattered Folders (cleanup candidates)
These are leftover from the file-by-file upload and can be removed once verified:
- `C:\grudge-arena-bridge`
- `C:\grudge-bridge`
- `C:\grudge-game-node`
- `C:\grudge-server`
- `C:\GrudgeAdmin`
- `C:\GrudgeServer`
- `C:\GrudgeStudio`
- `C:\MaNGOS`
- `C:\mangos-deploy`
- `C:\mangos-deploy.zip`

## Security Notes
- Change MySQL root password for production
- Change SOAP admin password
- Rotate VPS SSH credentials (they were shared in chat)
- Restrict CORS_ORIGIN to only your actual frontend domains
- Put the bridge behind HTTPS (Cloudflare proxy or nginx + Let's Encrypt)
