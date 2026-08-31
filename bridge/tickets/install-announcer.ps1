# Make the ticket announcer start by itself, and stay started.
#
# ── Why this exists ───────────────────────────────────────────────────
#
# run-announcer.ps1 already supervises the announcer and brings it back if it
# dies. What was missing is anything to start the supervisor in the first
# place. Its header suggested a scheduled task and nobody ever ran the command,
# so from 26 August the announcer was simply never running:
#
#   * a customer who scanned the QR on their slip got the bot's first reply —
#     that comes from the webhook on the server, which was fine — and then
#     nothing ever again, because the scan sat unclaimed in TicketLink and the
#     chat was never tied to the ticket;
#   * and no number was ever called over the shop speakers.
#
# From the shop floor that looks like a broken bot. It was a process nobody had
# started.
#
# ── Why the Startup folder and not a scheduled task ───────────────────
#
# A task with /rl highest needs an elevated prompt to install, and the one
# thing that must not stand between this and running is a UAC prompt somebody
# has to be present for. The sync loop is already started exactly this way, by
# MwalimuSync.vbs in the same folder, so this matches what is known to work
# here rather than introducing a second mechanism.
#
# wscript with a hidden window, because a PowerShell console left open on the
# shop laptop is a console somebody will eventually close.
#
#   powershell -ExecutionPolicy Bypass -File install-announcer.ps1
#
# Run it once. It is safe to run again — it overwrites its own shim.

$ErrorActionPreference = "Stop"

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner  = Join-Path $here "run-announcer.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$shim    = Join-Path $startup "MwalimuAnnouncer.vbs"

if (-not (Test-Path $runner)) {
    Write-Host "run-announcer.ps1 not found beside this script." -ForegroundColor Red
    exit 1
}

# Written as a here-string so the quoting is visible. VBScript needs doubled
# quotes inside a string, and the path contains spaces, so both matter.
$vbs = @"
' Starts the Mwalimu ticket announcer, hidden, at logon.
' Written by bridge/tickets/install-announcer.ps1 — edit that, not this.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""$runner""", 0, False
"@

Set-Content -Path $shim -Value $vbs -Encoding ascii
Write-Host "[OK] Startup shim written to $shim"

# Do not leave a second supervisor behind if this is a re-run.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like "*run-announcer.ps1*" } |
    ForEach-Object {
        Write-Host "     stopping existing supervisor (pid $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*announcer.js*" } |
    ForEach-Object {
        Write-Host "     stopping existing announcer (pid $($_.ProcessId))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Start-Process -FilePath "wscript.exe" -ArgumentList "`"$shim`"" -WindowStyle Hidden
Write-Host "[OK] Announcer started."

Start-Sleep -Seconds 6

$live = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like "*announcer.js*" }

if ($live) {
    Write-Host "[OK] Running as pid $($live.ProcessId)."
    Write-Host ""
    Write-Host "It now starts on every logon. Logs: $(Join-Path $here 'logs')"
} else {
    Write-Host "[WARN] Not running yet. The supervisor backs off and retries;" -ForegroundColor Yellow
    Write-Host "       check the newest file in $(Join-Path $here 'logs')" -ForegroundColor Yellow
}
