param(
    [string]$DeployRoot = "F:\GrudgeArenaWeb",
    [string]$SourceRoot = "D:\Vanilla bropack v23\MaNGOS\grudge-arena-bridge",
    [string]$MangosRoot = "D:\Vanilla bropack v23\MaNGOS",
    [string]$WoWExe = "D:\Vanilla bropack v23\MaNGOS\patches\wow 1.7.1\WoW.exe"
)

$ErrorActionPreference = "Stop"

function Set-EnvValue {
    param(
        [string]$Path,
        [string]$Key,
        [string]$Value
    )

    $content = ""
    if (Test-Path $Path) {
        $content = Get-Content $Path -Raw
    }

    $pattern = "(?m)^" + [regex]::Escape($Key) + "=.*$"
    $line = "$Key=$Value"

    if ($content -match $pattern) {
        $content = [regex]::Replace($content, $pattern, $line)
    } else {
        if ($content -and -not $content.EndsWith("`r`n")) {
            $content += "`r`n"
        }
        $content += $line + "`r`n"
    }

    Set-Content -Path $Path -Value $content -NoNewline
}

function Wait-Port {
    param(
        [int]$Port,
        [int]$Seconds = 20
    )

    for ($i = 0; $i -lt $Seconds; $i++) {
        $ok = (Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded
        if ($ok) {
            return $true
        }
        Start-Sleep -Seconds 1
    }

    return $false
}

function Stop-ProcessByCommandLike {
    param([string]$Like)
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like $Like } |
        ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  GRUDGE ARENA - LOCAL WEB BOOTSTRAP" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $WoWExe)) {
    throw "WoW.exe not found at $WoWExe"
}
if (-not (Test-Path (Join-Path $MangosRoot "mangosd.exe"))) {
    throw "mangosd.exe not found under $MangosRoot"
}

Write-Host "[1/7] Creating F-drive deployment..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $DeployRoot -Force | Out-Null
$null = robocopy $SourceRoot $DeployRoot /E /XD ".git" "node_modules"
if ($LASTEXITCODE -gt 7) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}

$sourceEnv = Join-Path $SourceRoot ".env"
$deployEnv = Join-Path $DeployRoot ".env"
if (Test-Path $sourceEnv) {
    Copy-Item $sourceEnv $deployEnv -Force
} elseif (-not (Test-Path $deployEnv)) {
    New-Item -ItemType File -Path $deployEnv -Force | Out-Null
}

$vncPassword = "GrudgeArena2026"
$launcherPath = Join-Path $DeployRoot "wow-launcher.ps1"

Write-Host "[2/7] Writing local deployment environment..." -ForegroundColor Yellow
Set-EnvValue $deployEnv "PORT" "3001"
Set-EnvValue $deployEnv "CORS_ORIGIN" "https://wow.grudge-studio.com,http://localhost:3000"
Set-EnvValue $deployEnv "VNC_HOST" "127.0.0.1"
Set-EnvValue $deployEnv "VNC_PORT" "5900"
Set-EnvValue $deployEnv "VNC_PASSWORD" $vncPassword
Set-EnvValue $deployEnv "WOW_PATH" $WoWExe
Set-EnvValue $deployEnv "WOW_LAUNCHER_PATH" $launcherPath
Set-EnvValue $deployEnv "DOMAIN" "wow.grudge-studio.com"
Set-EnvValue $deployEnv "SOAP_HOST" "127.0.0.1"
Set-EnvValue $deployEnv "MANGOS_DB_HOST" "127.0.0.1"
Set-EnvValue $deployEnv "MANGOS_DB_PORT" "3307"
Set-EnvValue $deployEnv "MAX_SESSIONS" "1"

Write-Host "[3/7] Installing TightVNC through one UAC prompt..." -ForegroundColor Yellow
$vncScript = Join-Path $DeployRoot "scripts\install-tightvnc.ps1"
$vncArgs = @(
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    $vncScript,
    "-VncPassword",
    $vncPassword
)
Start-Process -FilePath "powershell" -Verb RunAs -ArgumentList $vncArgs -Wait

if (-not (Wait-Port -Port 5900 -Seconds 10)) {
    Write-Host "  WARNING: TightVNC port 5900 is still not responding." -ForegroundColor Yellow
}

Write-Host "[4/7] Installing Node dependencies..." -ForegroundColor Yellow
Push-Location $DeployRoot
npm install
Pop-Location

Write-Host "[5/7] Starting local MaNGOS services from D: ..." -ForegroundColor Yellow
if (-not (Wait-Port -Port 3307 -Seconds 1)) {
    Start-Process -FilePath (Join-Path $MangosRoot "mysql5\bin\mysqld.exe") -ArgumentList "--console","--max_allowed_packet=128M","--port=3307" -WorkingDirectory $MangosRoot -WindowStyle Hidden
    [void](Wait-Port -Port 3307 -Seconds 20)
}
if (-not (Wait-Port -Port 3724 -Seconds 1)) {
    Start-Process -FilePath (Join-Path $MangosRoot "realmd.exe") -WorkingDirectory $MangosRoot -WindowStyle Minimized
    [void](Wait-Port -Port 3724 -Seconds 15)
}
if (-not (Wait-Port -Port 8085 -Seconds 1)) {
    Start-Process -FilePath (Join-Path $MangosRoot "mangosd.exe") -WorkingDirectory $MangosRoot -WindowStyle Minimized
    [void](Wait-Port -Port 8085 -Seconds 20)
}

Write-Host "[6/7] Verifying TightVNC is running..." -ForegroundColor Yellow
if (-not (Wait-Port -Port 5900 -Seconds 5)) {
    Write-Host "  WARNING: TightVNC port 5900 is not responding." -ForegroundColor Yellow
} else {
    Write-Host "  TightVNC OK on port 5900." -ForegroundColor Green
}

Write-Host "[7/7] Starting local bridge and tunnel..." -ForegroundColor Yellow
Stop-ProcessByCommandLike "*server.js*"
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $DeployRoot -WindowStyle Hidden

$token = (Get-Content $deployEnv | Select-String "^CLOUDFLARE_TUNNEL_TOKEN=" | ForEach-Object { $_ -replace 'CLOUDFLARE_TUNNEL_TOKEN=', '' })
if ($token) {
    $cfRunning = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*tunnel run*" }
    if (-not $cfRunning) {
        Start-Process -FilePath "cloudflared" -ArgumentList @("tunnel","run","--token",$token) -WindowStyle Hidden
    }
}

Start-Sleep -Seconds 5

Write-Host ""
Write-Host "Local checks:" -ForegroundColor Cyan
foreach ($port in 3307,3724,8085,7878,5900,3001) {
    $ok = (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
    Write-Host ("  " + $port + " -> " + $ok)
}

Write-Host ""
Write-Host "Next web step if wow.grudge-studio.com still shows 404:" -ForegroundColor Yellow
Write-Host "  In Cloudflare Tunnel, set public hostname wow.grudge-studio.com -> http://localhost:3001"
Write-Host ""
Write-Host "Deployment root: $DeployRoot" -ForegroundColor Green
Write-Host "Bridge local health: http://localhost:3001/api/health" -ForegroundColor Green
Write-Host "VNC local:          port 5900 (TightVNC)" -ForegroundColor Green
