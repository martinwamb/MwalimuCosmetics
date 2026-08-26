# Mwalimu Cosmetics — keep the ticket announcer running.
#
# The announcer is the only piece of the ticket system that has to stay up, and
# it is the piece most exposed to things outside our control: a WiFi drop, the
# database server rebooting, Telegram being unreachable. It is written to
# survive all three, but a process that dies for a reason nobody predicted
# should come straight back rather than wait for somebody to notice the shop
# has gone quiet.
#
# Modelled on bridge/loop.ps1, which does the same job for pusher.js.
#
# Install as a scheduled task that runs at logon:
#
#   schtasks /create /tn "MwalimuTicketAnnouncer" /sc onlogon /rl highest ^
#     /tr "powershell -NoProfile -WindowStyle Hidden -File \"C:\Users\Admin\Documents\Mwalimu Cosmetics\bridge\tickets\run-announcer.ps1\""
#
# Run it by hand first and watch the output before installing the task.

param(
    [string]$Database = "mwalimuinvest",
    [switch]$NoTelegram
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here "announcer.js"
$logDir = Join-Path $here "logs"

if (-not (Test-Path $script)) {
    Write-Host "announcer.js not found beside this script at $script"
    exit 1
}
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Host "node is not on PATH."
    exit 1
}

$env:MWALIMU_DB_NAME = $Database

$nodeArgs = @($script)
if ($NoTelegram) { $nodeArgs += "--no-telegram" }

Write-Host "Ticket announcer supervisor"
Write-Host "  database : $Database"
Write-Host "  script   : $script"
Write-Host "  logs     : $logDir"
Write-Host ""

# Restarts are backed off so that a fault which recurs immediately — a bad
# token, a database that refuses the credentials — does not spin thousands of
# times an hour and fill the disk with identical log lines. It climbs to a
# minute and stays there.
$delay = 5
$maxDelay = 60

while ($true) {
    $started = Get-Date
    $log = Join-Path $logDir ("announcer-" + $started.ToString("yyyy-MM-dd") + ".log")

    "=== started $($started.ToString('HH:mm:ss')) ===" | Out-File -FilePath $log -Append -Encoding utf8
    & $node @nodeArgs 2>&1 | Tee-Object -FilePath $log -Append

    $ranFor = (Get-Date) - $started
    if ($ranFor.TotalMinutes -ge 5) {
        # It stayed up long enough to have been working. Whatever killed it was
        # a one-off, so come back promptly.
        $delay = 5
    } else {
        $delay = [Math]::Min($delay * 2, $maxDelay)
    }

    $msg = "exited after $([int]$ranFor.TotalSeconds)s; restarting in ${delay}s"
    Write-Host $msg
    $msg | Out-File -FilePath $log -Append -Encoding utf8
    Start-Sleep -Seconds $delay
}
