# Mwalimu Cosmetics — Remote Agent Push
#
# Copies updated agent files to a shop PC over the local network
# using Windows Admin Shares (\\IP\C$). Run from this laptop as
# Administrator. The target PC must have File and Printer Sharing
# enabled and a known local Administrator password.
#
# Usage:
#   .\push-to-pc.ps1 -TargetIP 10.10.10.12 -Password "PCpassword"
#   .\push-to-pc.ps1 -TargetIP 10.10.10.16 -Password "PCpassword"
#
# To push to ALL known shop PCs in one go:
#   @("10.10.10.12","10.10.10.16") | % { .\push-to-pc.ps1 -TargetIP $_ -Password "PCpassword" }

param(
  [Parameter(Mandatory)][string]$TargetIP,
  [Parameter(Mandatory)][string]$Password,
  [string]$Username = "Administrator"
)

$Source = "C:\MwalimuSync"
$Remote = "\\$TargetIP\C$\MwalimuSync"

Write-Host ""
Write-Host "=== Mwalimu Sync Agent — Remote Push ===" -ForegroundColor Cyan
Write-Host "Target: $TargetIP" -ForegroundColor Cyan
Write-Host ""

# Connect to admin share
Write-Host "Connecting to \\$TargetIP\C$..."
$null = net use "\\$TargetIP\C$" /user:"$TargetIP\$Username" "$Password" 2>&1
if ($LASTEXITCODE -ne 0) {
  # Try domain-style login as fallback
  $null = net use "\\$TargetIP\C$" /user:"$Username" "$Password" 2>&1
}
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ERROR] Could not connect to \\$TargetIP\C$" -ForegroundColor Red
  Write-Host "  Check: File and Printer Sharing is enabled on $TargetIP" -ForegroundColor Yellow
  Write-Host "  Check: Administrator password is correct" -ForegroundColor Yellow
  Write-Host "  Check: Windows Firewall allows File Sharing on $TargetIP" -ForegroundColor Yellow
  exit 1
}
Write-Host "[OK] Connected." -ForegroundColor Green

# Ensure remote directory exists
if (-not (Test-Path $Remote)) {
  New-Item -Path $Remote -ItemType Directory -Force | Out-Null
  Write-Host "[OK] Created $Remote"
}

# Copy agent files
$files = @("pusher.js", "loop.ps1", "daily-backup.js", "package.json")
foreach ($f in $files) {
  $src = Join-Path $Source $f
  $dst = Join-Path $Remote $f
  if (Test-Path $src) {
    Copy-Item $src $dst -Force
    Write-Host "[OK] Copied $f"
  }
}

# Copy node_modules if they don't exist on the target
$remoteModules = Join-Path $Remote "node_modules"
if (-not (Test-Path $remoteModules)) {
  Write-Host "Copying node_modules (first time — may take a moment)..."
  Copy-Item (Join-Path $Source "node_modules") $remoteModules -Recurse -Force
  Write-Host "[OK] node_modules copied."
}

# Restart the sync task on the remote PC
Write-Host ""
Write-Host "Restarting MwalimuSyncLoop task on $TargetIP..."
$kill = schtasks /end /s $TargetIP /u "$TargetIP\$Username" /p "$Password" /tn "MwalimuSyncLoop" 2>&1
$run  = schtasks /run  /s $TargetIP /u "$TargetIP\$Username" /p "$Password" /tn "MwalimuSyncLoop" 2>&1

if ($LASTEXITCODE -eq 0) {
  Write-Host "[OK] Task restarted — agent is now running the updated version." -ForegroundColor Green
} else {
  Write-Host "[WARNING] Could not restart task remotely." -ForegroundColor Yellow
  Write-Host "  The updated files are in place. The agent will self-update on its next cycle," -ForegroundColor Yellow
  Write-Host "  or restart the PC to pick up the change immediately." -ForegroundColor Yellow
}

# Disconnect
net use "\\$TargetIP\C$" /delete >$null 2>&1

Write-Host ""
Write-Host "=== Done: $TargetIP updated ===" -ForegroundColor Cyan
Write-Host ""
