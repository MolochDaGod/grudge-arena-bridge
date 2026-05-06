param(
    [string]$DeployRoot = "F:\GrudgeArenaWeb",
    [string]$WoWExe = "D:\Vanilla bropack v23\MaNGOS\patches\wow 1.7.1\WoW.exe"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This script must be run as Administrator."
}

$deployEnv = Join-Path $DeployRoot ".env"
if (-not (Test-Path $deployEnv)) {
    throw "Deployment .env not found at $deployEnv"
}

$rdpPassword = (Get-Content $deployEnv | Select-String "^RDP_PASS=" | ForEach-Object { $_ -replace 'RDP_PASS=', '' })
if (-not $rdpPassword) {
    throw "RDP_PASS was not found in $deployEnv"
}

$localAdminScript = Join-Path $DeployRoot "scripts\local-admin-prereqs.ps1"
if (-not (Test-Path $localAdminScript)) {
    throw "local-admin-prereqs.ps1 not found in deployment root."
}

Write-Host "[admin] Running local RDP prerequisites..."
& powershell -ExecutionPolicy Bypass -File $localAdminScript -RdpUser arena -RdpPassword $rdpPassword -WoWPath $WoWExe

Write-Host "[admin] Restarting Docker Desktop service..."
Get-Process 'Docker Desktop','com.docker.backend','com.docker.proxy' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Restart-Service com.docker.service -Force
Start-Sleep -Seconds 5

$dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerExe) {
    Start-Process $dockerExe
}

Write-Host "[admin] Repair complete."
