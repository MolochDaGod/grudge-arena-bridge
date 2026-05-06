# Smoke Test Results

## Latest: 2026-05-06

### Environment
- **URL:** https://wow.grudge-studio.com
- **VPS:** 74.208.155.229 (Windows Server 2022)
- **Bridge:** Node.js on port 3001, served via Cloudflare Tunnel
- **MaNGOS:** Vanilla 1.7 (build 4695), MySQL root:root@localhost:3307
- **SOAP:** 127.0.0.1:7878 (admin gmlevel 3)
- **VNC:** TightVNC on port 5900 → noVNC websocket at /vnc

### DNS — ✅ Verified
```
wow.grudge-studio.com → Cloudflare Proxy
  172.67.132.73 / 104.21.4.170
  CF-RAY headers present, Server: cloudflare
```

### Cloudflare Tunnel — ⚠️ Active but backend offline
Tunnel is routing traffic (no 502/Bad Gateway), but bridge server on VPS is not running.
All routes return `404 Not Found` with empty body via CF.

### Static Assets — 0/10 ❌
All returning 404 — bridge is the static file server and it's offline.

| Asset | Status |
|-------|--------|
| `/` (index.html) | ❌ 404 |
| `/style.css` | ❌ 404 |
| `/app.js` | ❌ 404 |
| `/favicon.png` | ❌ 404 |
| `/logo.png` | ❌ 404 |
| `/bg.png` | ❌ 404 |
| `/splash.png` | ❌ 404 |
| `/intro.mp4` | ❌ 404 |
| `/privacy.html` | ❌ 404 |
| `/robots.txt` | ❌ 404 |

### API Endpoints — 0/2 ❌
| Endpoint | Status |
|----------|--------|
| `GET /api/health` | ❌ 404 |
| `GET /api/character/options` | ❌ 404 |

### VPS Direct — ❌ Unreachable
Ports not exposed externally (by design — all traffic via CF Tunnel).

### VNC / Game Streaming — ❌ Cannot test
Depends on bridge being up. VNC websocket proxy at `/vnc` is part of server.js.

### System Status Summary
| System | Status | Verified |
|--------|--------|----------|
| DNS (wow.grudge-studio.com) | ✅ CF Proxy | Yes |
| Cloudflare Tunnel | ✅ Active | Yes |
| Bridge API (Node.js :3001) | ❌ Not running | No |
| Static frontend | ❌ Offline (served by bridge) | No |
| MaNGOS (realmd + mangosd) | ❓ Unknown | No |
| MySQL (bundled :3307) | ❓ Unknown | No |
| SOAP (:7878) | ❓ Unknown | No |
| TightVNC (:5900) | ❓ Unknown | No |
| VNC WebSocket (/vnc) | ❌ Bridge offline | No |
| Puter Auth | ❓ Frontend offline | No |

### Action Required
1. SSH into VPS → start bridge: `node server.js` in the bridge directory
2. Or run full deploy: `scripts\deploy-vps.ps1`
3. Verify MaNGOS (MySQL, realmd, mangosd) running
4. Verify TightVNC running on :5900
5. Re-run smoke test

---

## Previous: 2026-05-05 (Last Known Good)

### Static Assets — 22/22 ✅
All HTTP 200 through Cloudflare.

### API Endpoints — All ✅
- Health: `{"status":"ok","database":true,"soap":true}`
- Login (existing): `{"accountId":6,"username":"GA_SMOKETEST0","isNew":false}`
- Login (new): `{"accountId":7,"username":"GA_23570361","isNew":true}` — SOAP account creation working
- Re-login: idempotent, no duplicate accounts
- Character options: 8 races, 9 classes, 40 combos
- Play session: 503 graceful (Guacamole not yet replaced with VNC)

### Frontend — All ✅
- Intro video + splash screen
- Puter SDK auth popup
- Character creation UI (faction → race → class → spec → name)
- Server status indicator

### VPS Services
| Service | Port | Status |
|---------|------|--------|
| MySQL | 3306 | ✅ |
| realmd | 3724 | ✅ |
| mangosd | 8085 + SOAP 7878 | ✅ |
| Bridge | 80 | ✅ |
| Guacamole | 8080 | ❌ Docker broken |

### Fixes Applied That Session
1. Favicon 1.2MB → 7KB (was causing CF 521 timeouts)
2. SOAP timeout (5s)
3. Health endpoint DB query timeout (5s race)
4. CSP for `static.cloudflareinsights.com`
5. ADMIN gmlevel 3 for SOAP
6. Account creation polls DB after SOAP (500ms × 6)
7. md5 hash usernames for uniqueness
8. SOAP "already exist" handled gracefully
9. Play endpoint → 503 instead of 500 when streaming unavailable
