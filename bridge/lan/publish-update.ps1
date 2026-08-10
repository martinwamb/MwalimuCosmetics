<#
  Mwalimu Cosmetics - publish a FumasV5 build to the whole shop.

  Run this on the laptop, on the ethernet. It puts one build in
  the hub share; every till picks it up within 10 minutes and
  applies it the next time the POS is opened. No USB stick, no
  walking, and no internet on the receiving machines.

  Usage:
      .\publish-update.ps1
      .\publish-update.ps1 -Source "C:\Mwalimu\Debugv5\FumasV5-updated.exe"
      .\publish-update.ps1 -WhatIf        # show what would happen

  The version stamp is a hash of the exe, not a date. Two
  publishes of an unchanged build therefore do nothing, and a
  changed build always propagates even if it was rebuilt in the
  same minute.
#>

# Plain-text default credential is intentional - see run-on-all.ps1 and README.md.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '')]
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Source   = "C:\Mwalimu\Debugv5\FumasV5-updated.exe",
  [string]$Hub      = "10.10.10.4",
  [string]$Share    = "updates",
  # The PUBLISHER account, not the read-only one the tills use. Publishing
  # writes to the share, so it must be the account setup-hub.bat granted
  # CHANGE to. Connecting as the read-only mwalimuupd cannot write and the
  # copy is denied.
  [string]$User     = "mwalimuadmin",
  [string]$Password = "MwalimuAdmin2026"
)

$ErrorActionPreference = "Stop"

function Say($msg, $colour = "Gray") { Write-Host "  $msg" -ForegroundColor $colour }

Write-Host ""
Write-Host "=== Publish a FumasV5 build to the shop ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $Source)) {
  Say "[STOP] No build at $Source" "Red"
  Say "Pass the right path with -Source" "Yellow"
  exit 1
}

$src = Get-Item $Source
Say ("Build:   {0}" -f $src.FullName)
Say ("Size:    {0} MB" -f [math]::Round($src.Length / 1MB, 1))
Say ("Built:   {0}" -f $src.LastWriteTime)

if ($src.Length -lt 20MB) {
  Say "[STOP] That file is too small to be a FumasV5 build." "Red"
  Say "Refusing to hand a truncated exe to every till." "Yellow"
  exit 1
}

$version = (Get-FileHash $src.FullName -Algorithm SHA256).Hash.Substring(0, 12).ToLower()
Say ("Version: {0}" -f $version) "White"

# Connect to the hub share.
$unc = "\\$Hub\$Share"
Say ""
Say "Connecting to $unc ..."
# Windows permits only one credential per server at a time. A leftover
# session to this hub as the read-only account (e.g. from an earlier run)
# makes the connect below fail with error 1219, so clear it first.
cmd /c "net use `"$unc`" /delete /y >nul 2>nul"
cmd /c "net use `"\\$Hub`" /delete /y >nul 2>nul"

# The redirection belongs INSIDE cmd. Doing it PowerShell-side as
# "2>&1" wraps net use's stderr in a NativeCommandError which, under
# ErrorActionPreference = Stop, terminates the script before the
# friendly message below can explain what actually went wrong.
cmd /c "net use `"$unc`" /user:$User $Password >nul 2>nul"
if (-not (Test-Path $unc)) {
  Say "[STOP] Cannot reach $unc" "Red"
  # ${Hub}, not $Hub: PowerShell swallows the "?" into the variable name.
  Say "Has setup-hub.bat been run on ${Hub}? Is the cable in?" "Yellow"
  exit 1
}
Say "[OK] Connected." "Green"

try {
  # What is already published? Nothing to do if it matches.
  $remoteVersionFile = Join-Path $unc "FumasV5-version.txt"
  if (Test-Path $remoteVersionFile) {
    $current = (Get-Content $remoteVersionFile -First 1).Trim()
    if ($current -eq $version) {
      Say ""
      Say "This exact build is already published ($version). Nothing to do." "Yellow"
      exit 0
    }
    Say ("Replacing published build {0}" -f $current)
  }

  if (-not $PSCmdlet.ShouldProcess($unc, "publish build $version")) { exit 0 }

  # Copy to .part first. A till polling mid-copy must never see a
  # half-written exe sitting under the final name.
  $part  = Join-Path $unc "FumasV5-updated.exe.part"
  $final = Join-Path $unc "FumasV5-updated.exe"

  Say ""
  Say "Copying the build across ..."
  Copy-Item $src.FullName $part -Force

  $copied = (Get-Item $part).Length
  if ($copied -ne $src.Length) {
    Remove-Item $part -Force -ErrorAction SilentlyContinue
    Say ("[STOP] Copy is incomplete ({0} of {1} bytes)." -f $copied, $src.Length) "Red"
    exit 1
  }
  Move-Item $part $final -Force
  Say "[OK] FumasV5-updated.exe" "Green"

  # Refresh the central check script while we are here, so its
  # logic can be corrected without revisiting any till.
  $agentDir = Join-Path $unc "agent"
  if (-not (Test-Path $agentDir)) { New-Item $agentDir -ItemType Directory -Force | Out-Null }
  $checkSrc = Join-Path $PSScriptRoot "check.cmd"
  if (Test-Path $checkSrc) {
    Copy-Item $checkSrc (Join-Path $agentDir "check.cmd") -Force
    Say "[OK] agent\check.cmd refreshed" "Green"
  }

  # The version file goes LAST. It is the signal that says
  # "a complete build is waiting" - writing it before the exe
  # has landed would send every till after a file that is not
  # there yet.
  Set-Content -Path $remoteVersionFile -Value $version -Encoding ascii
  Say "[OK] FumasV5-version.txt" "Green"

  Write-Host ""
  Write-Host "=== Published: $version ===" -ForegroundColor Cyan
  Write-Host ""
  Say "Every till picks this up within 10 minutes and applies it"
  Say "the next time the POS is opened. To push it out now:"
  Say ""
  Say "    .\run-on-all.ps1 -Command 'schtasks /run /tn MwalimuLanUpdate'" "White"
  Write-Host ""
}
finally {
  cmd /c "net use `"$unc`" /delete >nul 2>nul"
}
