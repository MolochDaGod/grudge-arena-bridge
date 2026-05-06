param(
    [string]$VncPassword = ""
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    throw "This script must be run as Administrator."
}

if (-not $VncPassword) {
    throw "VncPassword is required. Pass -VncPassword <password>"
}

$installerUrl = "https://www.tightvnc.com/download/2.8.85/tightvnc-2.8.85-gpl-setup-64bit.msi"
$installerPath = "$env:TEMP\tightvnc-setup.msi"
$installDir = "C:\Program Files\TightVNC"

# Check if already installed
if (Test-Path (Join-Path $installDir "tvnserver.exe")) {
    Write-Host "[vnc] TightVNC already installed at $installDir" -ForegroundColor Green

    # Make sure the service is running
    $svc = Get-Service -Name "tvnserver" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne "Running") {
        Start-Service -Name "tvnserver"
        Write-Host "[vnc] TightVNC service started." -ForegroundColor Green
    }
    exit 0
}

Write-Host "[vnc] Downloading TightVNC installer..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing

Write-Host "[vnc] Installing TightVNC silently..." -ForegroundColor Yellow

# Silent MSI install — server only, set password via properties
# SET_USEVNCAUTHENTICATION=1 enables VNC password auth
# VALUE_OF_PASSWORD sets the VNC password
$msiArgs = @(
    "/i", $installerPath,
    "/quiet", "/norestart",
    "ADDLOCAL=Server",
    "SERVER_REGISTER_AS_SERVICE=1",
    "SERVER_ADD_FIREWALL_EXCEPTION=1",
    "SET_USEVNCAUTHENTICATION=1",
    "VALUE_OF_PASSWORD=$VncPassword",
    "SET_ALLOWLOOPBACK=1",
    "SET_REMOVEWALLPAPER=0",
    "SET_RUNCONTROLINTERFACE=0"
)

$proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "TightVNC MSI install failed with exit code $($proc.ExitCode)"
}

# Verify install
if (-not (Test-Path (Join-Path $installDir "tvnserver.exe"))) {
    throw "TightVNC install completed but tvnserver.exe not found"
}

# Ensure firewall rule exists (MSI should handle this, but be safe)
$rule = Get-NetFirewallRule -DisplayName "TightVNC Server" -ErrorAction SilentlyContinue
if (-not $rule) {
    Write-Host "[vnc] Adding firewall rule for port 5900..." -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "TightVNC Server" -Direction Inbound -Protocol TCP -LocalPort 5900 -Action Allow | Out-Null
}

# Make sure service is running
$svc = Get-Service -Name "tvnserver" -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -ne "Running") {
        Start-Service -Name "tvnserver"
    }
    Write-Host "[vnc] TightVNC service is running on port 5900." -ForegroundColor Green
} else {
    Write-Host "[vnc] WARNING: tvnserver service not found after install." -ForegroundColor Yellow
}

# Cleanup
Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

Write-Host "[vnc] TightVNC installation complete." -ForegroundColor Green
