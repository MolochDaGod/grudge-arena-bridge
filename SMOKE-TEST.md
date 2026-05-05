# Smoke Test Results — 2026-05-05

## Environment
- **URL:** https://wow.grudge-studio.com
- **VPS:** 74.208.174.62 (Windows Server 2022)
- **Bridge:** Node.js on port 80, served via Cloudflare proxy
- **MaNGOS:** Vanilla 1.7 (build 4695), MySQL root:root@localhost:3306
- **SOAP:** 127.0.0.1:7878 (admin gmlevel 3)

## Static Assets — 22/22 ✅
All returning HTTP 200 through Cloudflare:

| Asset | Status |
|-------|--------|
| `/` (index.html) | ✅ 200 |
| `/style.css` | ✅ 200 |
| `/app.js` | ✅ 200 |
| `/favicon.png` (7KB) | ✅ 200 |
| `/logo.png` (1024x1024) | ✅ 200 |
| `/bg.png` | ✅ 200 |
| `/splash.png` | ✅ 200 |
| `/intro.mp4` | ✅ 200 |
| `/privacy.html` | ✅ 200 |
| `/robots.txt` | ✅ 200 |
| `/img/races/*.jpg` (8 races) | ✅ 200 |
| `/img/factions/*.jpg` (2 factions) | ✅ 200 |

## API Endpoints

### Health — ✅
```
GET /api/health
→ {"status":"ok","database":true,"soap":true}
```

### Login (existing user) — ✅
```
POST /api/auth/login {"puterUuid":"smoke-test-001"}
→ {"accountId":6,"username":"GA_SMOKETEST0","isNew":false,"characters":[]}
```

### Login (new user creation) — ✅
```
POST /api/auth/login {"puterUuid":"smoke-test-new-user-123"}
→ {"accountId":7,"username":"GA_23570361","isNew":true,"password":"943a2b69..."}
```
- SOAP account creation with 500ms polling (up to 3s)
- Email field tagged with `grudge:<puterUuid>` for lookup
- Hash-based username: `GA_` + md5(puterUuid)[0:8]

### Re-login (idempotent) — ✅
```
POST /api/auth/login {"puterUuid":"smoke-test-new-user-123"}
→ {"accountId":7,"isNew":false}
```
No duplicate account created.

### Character Options — ✅
```
GET /api/character/options
→ 8 races, 9 classes, 40 valid combos
```

### Play Session (Guacamole not running) — ✅ 503
```
POST /api/play/session
→ {"error":"Game streaming is starting up — try again in a few minutes."}
```
Graceful degradation when Docker/Guacamole is unavailable.

## Frontend Features Verified
- ✅ Intro video + splash screen transition
- ✅ Header logo renders (logo.png)
- ✅ Server status indicator (Online/Offline)
- ✅ Puter username displays in header after login
- ✅ Puter SDK auth popup flow
- ✅ Character creation UI (faction → race → class → spec → name)
- ✅ CSP allows Cloudflare analytics + Puter SDK
- ✅ Race/class images load in character creator

## VPS Services
| Service | Port | Status |
|---------|------|--------|
| MySQL (bundled) | 3306 | ✅ Running |
| realmd | 3724 | ✅ Running |
| mangosd (4695) | 8085 + SOAP 7878 | ✅ Running |
| Bridge (node) | 80 | ✅ Running (scheduled task: GrudgeBridge) |
| Guacamole (Docker) | 8080 | ❌ Docker needs repair |

## Known Issues
1. **Docker broken on VPS** — Docker Desktop hangs on commands. Guacamole streaming blocked until fixed.
2. **WoW client not installed** — Need WoW 1.7.1 at `C:\WoW\` with realmlist→127.0.0.1 for streaming.
3. **http.sys on port 80** — Stopped manually; may reclaim port 80 on reboot. Bridge scheduled task starts on boot but may need http.sys stopped first.

## Fixes Applied This Session
1. Favicon shrunk 1.2MB → 7KB (was causing Cloudflare 521 timeouts)
2. SOAP timeout added (5s) to prevent health endpoint hanging
3. Health endpoint DB query timeout (5s race)
4. CSP updated to allow `static.cloudflareinsights.com`
5. ADMIN account gmlevel set to 3 for SOAP access
6. Account creation polls DB after SOAP (500ms × 6 retries)
7. Username generation switched to md5 hash for uniqueness
8. SOAP "already exist" error handled gracefully
9. Play endpoint returns 503 instead of 500 when Guacamole unavailable
