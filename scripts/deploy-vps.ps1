# ═══════════════════════════════════════════════════════════════════════════════
# GRUDGE ARENA — VPS Deployment Script
# Run this on the VPS as Administrator to set up all services
# ═══════════════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Continue"
$BRIDGE_DIR = "C:\vanilla-bropack-full\MaNGOS\grudge-arena-bridge"
$MANGOS_DIR = "C:\vanilla-bropack-full\MaNGOS"
$CLOUDFLARED_DIR = "C:\cloudflared"
$TUNNEL_TOKEN = $env:CLOUDFLARE_TUNNEL_TOKEN

# Load tunnel token from .env if not in environment
if (-not $TUNNEL_TOKEN) {
    $envFile = Join-Path $BRIDGE_DIR ".env"
    if (Test-Path $envFile) {
        $TUNNEL_TOKEN = (Get-Content $envFile | Select-String "^CLOUDFLARE_TUNNEL_TOKEN=" | ForEach-Object { $_ -replace 'CLOUDFLARE_TUNNEL_TOKEN=', '' })
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  GRUDGE ARENA — VPS Deployment" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ─── Step 1: Install cloudflared ──────────────────────────────────────────────
Write-Host "[1/6] Installing cloudflared..." -ForegroundColor Yellow

if (-not (Test-Path "$CLOUDFLARED_DIR\cloudflared.exe")) {
    New-Item -ItemType Directory -Path $CLOUDFLARED_DIR -Force | Out-Null
    $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    Write-Host "  Downloading from $url"
    Invoke-WebRequest -Uri $url -OutFile "$CLOUDFLARED_DIR\cloudflared.exe" -UseBasicParsing
    Write-Host "  Downloaded cloudflared.exe" -ForegroundColor Green
} else {
    Write-Host "  cloudflared.exe already exists" -ForegroundColor Green
}

# ─── Step 2: Configure tunnel ingress via API ─────────────────────────────────
Write-Host "`n[2/6] Configuring Cloudflare Tunnel ingress..." -ForegroundColor Yellow

# The tunnel token is remotely managed — ingress is configured via the CF dashboard.
# We need to set it up via the API. Try multiple tokens.
$envFile = Join-Path $BRIDGE_DIR ".env"
$CF_DNS_TOKEN = (Get-Content $envFile | Select-String "^CF_DNS_API_TOKEN=" | ForEach-Object { $_ -replace 'CF_DNS_API_TOKEN=', '' })

# Decode tunnel ID from token
$decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TUNNEL_TOKEN))
$tunnelJson = $decoded | ConvertFrom-Json
$TUNNEL_ID = $tunnelJson.t
$ACCOUNT_ID = $tunnelJson.a

Write-Host "  Tunnel ID: $TUNNEL_ID"
Write-Host "  Account ID: $ACCOUNT_ID"

# Try to configure tunnel ingress
$ingressBody = @{
    config = @{
        ingress = @(
            @{ hostname = "wow.grudge-studio.com"; service = "http://localhost:3001"; originRequest = @{ noTLSVerify = $true } }
            @{ hostname = "guac.grudge-studio.com"; service = "http://localhost:8080"; originRequest = @{ noTLSVerify = $true } }
            @{ service = "http_status:404" }
        )
    }
} | ConvertTo-Json -Depth 5

$configured = $false
foreach ($token in @($CF_DNS_TOKEN)) {
    try {
        $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
        $resp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" -Method PUT -Headers $headers -Body $ingressBody -ErrorAction Stop
        if ($resp.success) {
            Write-Host "  Tunnel ingress configured via API" -ForegroundColor Green
            $configured = $true
            break
        }
    } catch {
        continue
    }
}

if (-not $configured) {
    Write-Host "  API token lacks tunnel permissions. Configure manually:" -ForegroundColor Red
    Write-Host "  1. Go to: https://one.dash.cloudflare.com/ -> Networks -> Tunnels" -ForegroundColor White
    Write-Host "  2. Click tunnel '$TUNNEL_ID' -> Public Hostname tab" -ForegroundColor White
    Write-Host "  3. Add: wow.grudge-studio.com -> http://localhost:3001" -ForegroundColor White
    Write-Host "  4. Add: guac.grudge-studio.com -> http://localhost:8080" -ForegroundColor White
    Write-Host ""
    $answer = Read-Host "  Press Enter after configuring (or 'skip' to continue)"
}

# ─── Step 3: Install cloudflared as Windows service ───────────────────────────
Write-Host "`n[3/6] Installing cloudflared as Windows service..." -ForegroundColor Yellow

# Remove old service if exists
$svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "  Stopping existing cloudflared service..."
    Stop-Service -Name "Cloudflared" -Force -ErrorAction SilentlyContinue
    & "$CLOUDFLARED_DIR\cloudflared.exe" service uninstall 2>$null
    Start-Sleep -Seconds 2
}

& "$CLOUDFLARED_DIR\cloudflared.exe" service install $TUNNEL_TOKEN
Start-Sleep -Seconds 3

$svc = Get-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
if ($svc) {
    Start-Service -Name "Cloudflared" -ErrorAction SilentlyContinue
    Write-Host "  cloudflared service installed and started" -ForegroundColor Green
} else {
    Write-Host "  WARNING: cloudflared service not found. Starting manually..." -ForegroundColor Red
    Start-Process -FilePath "$CLOUDFLARED_DIR\cloudflared.exe" -ArgumentList "tunnel","run","--token",$TUNNEL_TOKEN -WindowStyle Hidden
    Write-Host "  cloudflared running in background" -ForegroundColor Yellow
}

# ─── Step 4: Start WSL2 Guacamole services ────────────────────────────────────
Write-Host "`n[4/6] Starting WSL2 Guacamole services..." -ForegroundColor Yellow

# Start MySQL in WSL2
wsl -d Ubuntu -u root -- bash -c "service mysql start 2>/dev/null || true"
Write-Host "  MySQL started in WSL2" -ForegroundColor Green

# Start guacd
wsl -d Ubuntu -u root -- bash -c "pkill guacd 2>/dev/null; /usr/local/sbin/guacd -b 0.0.0.0 -l 4822 &"
Write-Host "  guacd started on port 4822" -ForegroundColor Green

# Start Tomcat
wsl -d Ubuntu -u root -- bash -c "export CATALINA_HOME=/opt/tomcat; export GUACAMOLE_HOME=/etc/guacamole; pkill -f catalina 2>/dev/null; sleep 1; /opt/tomcat/bin/startup.sh 2>/dev/null"
Write-Host "  Tomcat/Guacamole started on port 8080" -ForegroundColor Green

# ─── Step 5: Start MaNGOS services ───────────────────────────────────────────
Write-Host "`n[5/6] Starting MaNGOS services..." -ForegroundColor Yellow

$mysqlProc = Get-Process -Name "mysqld" -ErrorAction SilentlyContinue
if (-not $mysqlProc) {
    $mysqlExe = Get-ChildItem -Path $MANGOS_DIR -Recurse -Filter "mysqld.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($mysqlExe) {
        Start-Process -FilePath $mysqlExe.FullName -ArgumentList "--defaults-file=`"$($mysqlExe.Directory.FullName)\my.ini`"" -WindowStyle Hidden
        Write-Host "  MySQL (MaNGOS) started" -ForegroundColor Green
    } else {
        Write-Host "  MySQL (MaNGOS) not found — start manually" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MySQL (MaNGOS) already running" -ForegroundColor Green
}

$realmdExe = Get-ChildItem -Path $MANGOS_DIR -Recurse -Filter "realmd.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($realmdExe) {
    $realmdProc = Get-Process -Name "realmd" -ErrorAction SilentlyContinue
    if (-not $realmdProc) {
        Start-Process -FilePath $realmdExe.FullName -WorkingDirectory $realmdExe.Directory.FullName -WindowStyle Hidden
        Write-Host "  realmd started" -ForegroundColor Green
    } else {
        Write-Host "  realmd already running" -ForegroundColor Green
    }
}

$mangosdExe = Get-ChildItem -Path $MANGOS_DIR -Recurse -Filter "mangosd.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($mangosdExe) {
    $mangosdProc = Get-Process -Name "mangosd" -ErrorAction SilentlyContinue
    if (-not $mangosdProc) {
        Start-Process -FilePath $mangosdExe.FullName -WorkingDirectory $mangosdExe.Directory.FullName -WindowStyle Minimized
        Write-Host "  mangosd started" -ForegroundColor Green
    } else {
        Write-Host "  mangosd already running" -ForegroundColor Green
    }
}

# ─── Step 6: Start Bridge API ────────────────────────────────────────────────
Write-Host "`n[6/6] Starting Bridge API server..." -ForegroundColor Yellow

# Kill existing bridge
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like "*server.js*"
} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Push-Location $BRIDGE_DIR
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $BRIDGE_DIR -WindowStyle Hidden
Pop-Location
Write-Host "  Bridge API started on port 3001" -ForegroundColor Green

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Bridge API:  https://wow.grudge-studio.com/api/health" -ForegroundColor White
Write-Host "  Guacamole:   https://guac.grudge-studio.com/guacamole/" -ForegroundColor White
Write-Host "  Frontend:    https://wow.grudge-studio.com/" -ForegroundColor White
Write-Host ""
Write-Host "  Cloudflare Tunnel routes traffic securely — no ports exposed." -ForegroundColor Gray
Write-Host ""

# Quick health check
Write-Host "Testing connectivity..." -ForegroundColor Yellow
Start-Sleep -Seconds 5
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -TimeoutSec 5
    Write-Host "  Bridge health: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "  Bridge not responding yet (may need a few seconds)" -ForegroundColor Yellow
}
try {
    $guac = Invoke-WebRequest -Uri "http://localhost:8080/guacamole/" -TimeoutSec 5 -UseBasicParsing
    Write-Host "  Guacamole: HTTP $($guac.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "  Guacamole not responding yet (WSL2 may need a moment)" -ForegroundColor Yellow
}
