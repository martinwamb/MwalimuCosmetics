# Mwalimu Cosmetics - Sync Loop
# Runs every 30 seconds.
$PUSHER = "C:\MwalimuSync\pusher.js"
$LOG    = "C:\MwalimuSync\sync.log"

# Find node.exe — tries common install locations then falls back to PATH
function Find-Node {
  $candidates = @(
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe",
    "$env:APPDATA\nvm\current\node.exe",
    "$env:ProgramFiles\nvm\node.exe"
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  # Try PATH as last resort
  $fromPath = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($fromPath) { return $fromPath }
  return $null
}

$NODE = Find-Node
if (-not $NODE) {
  "$(Get-Date -Format 'u') FATAL: node.exe not found. Install Node.js from nodejs.org." | Add-Content $LOG
  exit 1
}

"$(Get-Date -Format 'u') Sync loop started. Using node: $NODE" | Add-Content $LOG

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
