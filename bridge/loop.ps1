# Mwalimu Cosmetics - Sync Loop
# Runs every 30 seconds. A checkpoint file prevents redundant pushes
# when no new transactions have occurred.
$NODE   = "C:\Program Files\nodejs\node.exe"
$PUSHER = "C:\MwalimuSync\pusher.js"
$LOG    = "C:\MwalimuSync\sync.log"

function Trim-Log {
  if (Test-Path $LOG) {
    if ((Get-Item $LOG).Length -gt 10MB) {
      $lines = Get-Content $LOG
      $lines | Select-Object -Last 2000 | Set-Content $LOG
    }
  }
}

while ($true) {
  try {
    $output = & $NODE $PUSHER 2>&1
    $output | Add-Content $LOG
  } catch {
    "$(Get-Date -Format 'u') ERROR: $_" | Add-Content $LOG
  }
  Trim-Log
  Start-Sleep -Seconds 30
}
