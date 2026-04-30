# Mwalimu Cosmetics - Sync Loop
# Runs every 10 minutes silently in the background
$NODE = "C:\Program Files\nodejs\node.exe"
$PUSHER = "C:\MwalimuSync\pusher.js"
$LOG = "C:\MwalimuSync\sync.log"

while ($true) {
    try {
        $output = & $NODE $PUSHER 2>&1
        $output | Add-Content $LOG
    } catch {
        "$(Get-Date -Format 'u') ERROR: $_" | Add-Content $LOG
    }
    Start-Sleep -Seconds 600
}
