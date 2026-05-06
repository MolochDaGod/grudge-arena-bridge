param(
    [string]$RdpUser = "arena",
    [string]$RdpPassword = "",
    [string]$WoWPath = "D:\Vanilla bropack v23\MaNGOS\patches\wow 1.7.1\WoW.exe"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This script must be run as Administrator."
}

if (-not $RdpPassword) {
    throw "RdpPassword is required."
}

Write-Host "[admin] Enabling local Remote Desktop..."
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections' -Value 0
Enable-NetFirewallRule -DisplayGroup "Remote Desktop" | Out-Null

Write-Host "[admin] Ensuring local RDP user exists..."
$userExists = $null -ne (Get-LocalUser -Name $RdpUser -ErrorAction SilentlyContinue)

if (-not $userExists) {
    net user $RdpUser $RdpPassword /add | Out-Null
}

cmd /c "net localgroup `"Remote Desktop Users`" $RdpUser /add" | Out-Null

$WoWDir = Split-Path -Parent $WoWPath
$realmlistPath = Join-Path $WoWDir "realmlist.wtf"
if (Test-Path $realmlistPath) {
    Write-Host "[admin] Setting local WoW realmlist..."
    Set-Content -Path $realmlistPath -Value "set realmlist 127.0.0.1`r`nset patchlist 127.0.0.1`r`n"
}

Write-Host "[admin] Local prerequisites complete."
