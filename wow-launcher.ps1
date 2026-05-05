# ═══════════════════════════════════════════════════
# Grudge Arena — WoW Auto-Login Launcher
# Called by Guacamole as the RDP initial-program
# Launches WoW.exe and auto-fills login credentials
# ═══════════════════════════════════════════════════

param(
    [string]$Username = "",
    [string]$Password = ""
)

$LogFile = "C:\WoW\launcher.log"
$WoWPath = "C:\WoW\WoW.exe"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts | $msg" | Out-File -Append $LogFile
    Write-Host $msg
}

Log "=== Grudge Arena Launcher ==="
Log "Username: $Username"
Log "WoW Path: $WoWPath"

# Step 1: Verify WoW client exists
if (-not (Test-Path $WoWPath)) {
    Log "ERROR: WoW.exe not found at $WoWPath"
    exit 1
}

# Step 2: Verify realmlist
$realmlist = Get-Content "C:\WoW\realmlist.wtf" -ErrorAction SilentlyContinue
Log "Realmlist: $realmlist"

# Step 3: Launch WoW
Log "Launching WoW.exe..."
$wowProcess = Start-Process -FilePath $WoWPath -WorkingDirectory "C:\WoW" -PassThru
Log "WoW PID: $($wowProcess.Id)"

# Step 4: Wait for WoW window to appear
Log "Waiting for WoW window..."
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 1
    $waited++
    $wowWindow = Get-Process -Id $wowProcess.Id -ErrorAction SilentlyContinue
    if ($wowWindow -and $wowWindow.MainWindowHandle -ne 0) {
        Log "WoW window found after ${waited}s"
        break
    }
}

if ($waited -ge $maxWait) {
    Log "WARNING: WoW window not detected after ${maxWait}s, proceeding anyway"
}

# Step 5: Auto-fill credentials using SendKeys
if ($Username -and $Password) {
    Log "Auto-filling credentials..."
    Start-Sleep -Seconds 3  # Let WoW fully render login screen
    
    Add-Type -AssemblyName System.Windows.Forms
    
    # Focus WoW window
    $sig = '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);'
    $type = Add-Type -MemberDefinition $sig -Name WinAPI -Namespace AutoLogin -PassThru
    $type::SetForegroundWindow($wowProcess.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    
    # Tab to username field (should be focused by default)
    # Type username
    [System.Windows.Forms.SendKeys]::SendWait($Username)
    Start-Sleep -Milliseconds 200
    
    # Tab to password field
    [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
    Start-Sleep -Milliseconds 200
    
    # Type password
    [System.Windows.Forms.SendKeys]::SendWait($Password)
    Start-Sleep -Milliseconds 200
    
    # Press Enter to login
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    
    Log "Credentials sent, login initiated"
} else {
    Log "No credentials provided, manual login required"
}

# Step 6: Keep session alive — wait for WoW to exit
Log "Session active, monitoring WoW process..."
try {
    $wowProcess.WaitForExit()
    Log "WoW process exited with code: $($wowProcess.ExitCode)"
} catch {
    Log "WoW process monitoring error: $_"
}

Log "=== Session ended ==="
