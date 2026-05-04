# Grudge Arena - Game Streaming Setup

## How It Works
```
Player Browser  →  Guacamole (HTML5)  →  RDP  →  Windows Host  →  WoW.exe  →  MaNGOS Server
```
The player opens a URL, Guacamole streams a remote desktop session running the WoW client directly to their browser. Full WoW experience, zero download.

## Prerequisites
- Docker + Docker Compose on the server
- Windows host with RDP enabled (for WoW client)
- WoW 1.7.1 client installed on the host
- MaNGOS server running

## Quick Start (Local Testing)

### 1. Enable RDP on your Windows machine
- Settings → System → Remote Desktop → Enable
- Create a Windows user for arena sessions:
  ```
  net user arena arena /add
  ```

### 2. Install WoW client at a known path
Put the 1.7.1 client at `C:\WoW\` (or update the path in user-mapping.xml)

### 3. Set realmlist in the client
Edit `C:\WoW\realmlist.wtf`:
```
set realmlist 127.0.0.1
```

### 4. Start Guacamole
```bash
cd streaming
docker-compose up -d
```

### 5. Test in browser
Open: http://localhost:8080/guacamole
Login: arena / arena
WoW should launch automatically.

## Production Deployment (VPS)

### Option A: Windows VPS (easiest)
1. Get a Windows VPS (Azure, AWS, Hetzner) with GPU or good CPU
2. Install WoW 1.7.1 client + MaNGOS on the VPS
3. Run Guacamole via Docker on the same VPS
4. Point arena.grudge-studio.com → VPS IP
5. Players open the URL and play

### Option B: Linux VPS + Wine (cheaper)
1. Get a Linux VPS
2. Install Wine + WoW client
3. Use Xvfb (virtual framebuffer) + x11vnc to create a virtual display
4. Guacamole connects via VNC instead of RDP
5. Lower cost but slightly more setup

### Multi-Player Sessions
For multiple simultaneous players, each needs their own WoW client instance:

**Windows approach:**
- Use multiple RDP sessions (Windows Server supports this)
- Each Guacamole connection maps to a different RDP session
- Each session runs its own WoW.exe

**Scaling:**
- 1 player ≈ 512MB RAM + 1 CPU core for the WoW client
- 10 players ≈ 8GB RAM + 4-8 cores
- Use Windows Server for unlimited RDP sessions

## Configuration

### Update user-mapping.xml
Edit `guacamole-config/user-mapping.xml`:
- Change `hostname` to your server IP
- Change `username`/`password` to Windows credentials
- Change `initial-program` to your WoW.exe path

### For dynamic sessions (production)
Replace the XML user mapping with the Guacamole REST API:
- Bridge server creates connections on-the-fly via Guacamole API
- Each Grudge ID gets their own session
- Sessions auto-terminate when player logs out

## Troubleshooting

### "Connection refused" 
- Ensure RDP is enabled on host
- Check firewall allows port 3389
- Verify Docker can reach host: `host.docker.internal`

### Black screen
- WoW needs a GPU or software renderer
- Try adding to WoW's Config.wtf: `SET gxApi "opengl"`
- Or use `SET gxWindow "1"` for windowed mode

### Input lag
- Reduce resolution in user-mapping.xml (try 1024x768)
- Set color-depth to 16
- Ensure low latency network between player and server
