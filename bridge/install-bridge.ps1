# Put the sync bridge on a shop PC, from this laptop, with nobody at the machine.
#
# ── What the bridge is ────────────────────────────────────────────────
#
# One PC that can see BOTH the shop's MySQL and the internet. It pushes the
# collection queue to the server every twenty seconds — which is what the shop
# screen and the web ticket board are drawn from — and brings write-backs the
# other way, so "handed over" pressed on the web reaches the till database.
#
# ── Why it moved off the laptop ───────────────────────────────────────
#
# It ran on the laptop because that is where it was first written, not because
# that is where it belongs. A laptop sleeps, gets carried home, and needs
# somebody logged in. Every one of those stops the shop screen.
#
# ── Choosing the host ─────────────────────────────────────────────────
#
# It needs internet, and most of these PCs do not have it. Checked on
# 2026-08-31 by running the test on each machine rather than assuming:
#
#   DESKTOP-L68F10R   internet YES     <- the only one
#   MWALIMU-OFFICE    internet no
#   MWALIMU-PC        internet no
#   CASHER1-PC        internet no
#
# ── Node ──────────────────────────────────────────────────────────────
#
# No shop PC has Node installed and none should need an installer run on it by
# hand. node.exe is a single self-contained binary, so the bridge carries its
# own copy at C:\MwalimuSync\node\node.exe. loop.js looks there first.
#
# ── Starting, and staying started ─────────────────────────────────────
#
# A scheduled task as SYSTEM every five minutes, NOT at logon: the sync needs
# no audio and no desktop, and tying it to a logon means a PC that rebooted
# overnight does nothing until somebody signs in.
#
# Running it every five minutes would normally stack up copies. loop.js holds a
# checked pid file, so a second copy exits immediately while one is alive — the
# repeat is a no-op when things are healthy and a restart when they are not.
#
#   .\install-bridge.ps1 -Target 10.10.10.12
#   .\install-bridge.ps1 -Target 10.10.10.12 -WhatIf
#
# The announcer is deliberately NOT installed by this. It speaks ticket numbers
# through whatever speakers it is plugged into, so it belongs on the machine
# wired to the shop's amplifier — see bridge/tickets/install-announcer.ps1.

[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '')]
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string]$User     = "mwalimuadmin",
    [string]$Password = "MwalimuAdmin2026",
    [string]$Source   = "C:\MwalimuSync",
    [string]$NodeExe  = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($m, $c = "Gray") { Write-Host "  $m" -ForegroundColor $c }

Write-Host ""
Write-Host "=== Install the Mwalimu sync bridge on $Target ===" -ForegroundColor Cyan
Write-Host ""

cmd /c "net use \\$Target\C`$ /user:$User $Password >nul 2>nul"
$dst = "\\$Target\C`$\MwalimuSync"

if (-not (Test-Path "\\$Target\C`$")) {
    Say "[STOP] No admin share on $Target. Has setup-pc.bat been run there?" "Red"
    exit 1
}
if (-not (Test-Path $NodeExe)) {
    Say "[STOP] node.exe not found at $NodeExe" "Red"
    exit 1
}

if ($PSCmdlet.ShouldProcess($Target, "copy the agent and register MwalimuBridge")) {
    New-Item -ItemType Directory -Force -Path "$dst\node" | Out-Null
    Copy-Item $NodeExe "$dst\node\node.exe" -Force
    Say "[OK] node.exe"

    # loop.js and pusher.js come from the repo so what runs is what is committed.
    foreach ($f in @("pusher.js", "db-config.js", "ar-payment.js", "loop.js")) {
        if (Test-Path "$here\$f") { Copy-Item "$here\$f" "$dst\$f" -Force; Say "[OK] $f (from the repo)" }
    }
    # The bot token is machine-local and is never committed, so it can only come
    # from a machine that already has one.
    if (Test-Path "$Source\ticket-config.json") {
        Copy-Item "$Source\ticket-config.json" "$dst\ticket-config.json" -Force
        Say "[OK] ticket-config.json"
    }
    if (Test-Path "$Source\node_modules") {
        Copy-Item "$Source\node_modules" "$dst\node_modules" -Recurse -Force
        Say "[OK] node_modules"
    }

    $tr = "`"C:\MwalimuSync\node\node.exe`" C:\MwalimuSync\loop.js"
    cmd /c "schtasks /delete /s $Target /u $User /p $Password /tn MwalimuBridge /f >nul 2>nul"
    cmd /c "schtasks /create /s $Target /u $User /p $Password /tn MwalimuBridge /sc minute /mo 5 /ru SYSTEM /rl HIGHEST /tr ""$tr"" /f >nul 2>nul"
    cmd /c "schtasks /run /s $Target /u $User /p $Password /tn MwalimuBridge >nul 2>nul"
    Say "[OK] MwalimuBridge registered (SYSTEM, every 5 min, self-healing)"

    Write-Host ""
    Say "Now retire the old host so two bridges do not run at once:" "Yellow"
    Say "  stop its loop.js and move MwalimuSync.vbs out of that user's Startup folder." "Yellow"
}

Write-Host ""
Say "Check it with:"
Say "  schtasks /query /s $Target /u $User /p $Password /tn MwalimuBridge"
Say "  and C:\MwalimuSync\sync.log on that machine (failures only)."
Write-Host ""
