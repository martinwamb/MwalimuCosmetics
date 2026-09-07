<#
  Mwalimu Cosmetics - copy a file to a shop PC, over WinRM.

  Why this exists
  ---------------
  bridge/pusher.js does not run from the repo. It runs on DESKTOP-L68F10R
  (10.10.10.12) out of C:\MwalimuSync, from a copy somebody made by hand. So a
  change committed and deployed to the server changes nothing that runs, and
  the only sign is a PendingChange failing with "Unknown change type" long
  after the deploy said success. That is exactly how ticket_ready shipped
  broken on 2026-09-07.

  push-to-pc.ps1 already copies these files, but only over the C$ admin share
  and only if you can supply that machine's local Administrator password. The
  tills answer WinRM with the shop account instead - the same one run-on-all.ps1
  uses - so this goes the way that already works, and needs no password anybody
  has to remember.

  Usage:
      .\push-file.ps1 -Path ..\pusher.js
      .\push-file.ps1 -Path ..\pusher.js -Restart
      .\push-file.ps1 -Path ..\pusher.js -Target 10.10.10.12 -Destination C:\MwalimuSync
      .\push-file.ps1 -Path ..\pusher.js -WhatIf

  A dated .bak of whatever is being replaced is left beside it on the target,
  because the machine this writes to is the one carrying the shop's sync and
  getting it back should not need this laptop.
#>

# Same deliberate plain default as run-on-all.ps1 - a shop-LAN account, not a
# personal one, so unattended scripts have something to authenticate with.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '')]
[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][string]$Path,
  [string]$Target      = "10.10.10.12",
  [string]$Destination = "C:\MwalimuSync",
  # The scheduled task that runs the sync there. Restarting is opt-in: the
  # pusher holds a MySQL connection and is mid-cycle more often than not.
  [string]$TaskName    = "MwalimuBridge",
  [switch]$Restart,
  [string]$User        = "mwalimuadmin",
  [string]$Password    = "MwalimuAdmin2026"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $Path)) {
  Write-Host "[STOP] No such file: $Path" -ForegroundColor Red
  exit 1
}

$file = Get-Item $Path
$name = $file.Name

Write-Host ""
Write-Host "=== Push a file to a shop PC ===" -ForegroundColor Cyan
Write-Host ""
Write-Host ("  File   : {0}  ({1:N0} bytes, {2})" -f $file.FullName, $file.Length, $file.LastWriteTime)
Write-Host  "  Target : $Target$(if ($Restart) { "  (will restart $TaskName)" })"
Write-Host  "  Into   : $Destination"
Write-Host ""

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential($User, $secure)

$session = $null
try {
  $session = New-PSSession -ComputerName $Target -Credential $cred -ErrorAction Stop
  Write-Host "  [OK] Connected." -ForegroundColor Green
} catch {
  Write-Host "  [STOP] Could not open a session to $Target" -ForegroundColor Red
  Write-Host "         $($_.Exception.Message)" -ForegroundColor Yellow
  Write-Host "         If this is a trust error, run: .\run-on-all.ps1 -TrustHosts" -ForegroundColor Yellow
  Write-Host "         (needs an Administrator PowerShell, once per laptop)" -ForegroundColor Yellow
  exit 1
}

try {
  # What is there now, so the change is visible rather than assumed.
  $before = Invoke-Command -Session $session -ArgumentList $Destination, $name -ScriptBlock {
    param($dir, $n)
    $p = Join-Path $dir $n
    if (Test-Path $p) { $i = Get-Item $p; "$($i.Length) bytes, $($i.LastWriteTime)" } else { "not present" }
  }
  Write-Host "  Currently there: $before"

  if (-not $PSCmdlet.ShouldProcess("$Target $Destination\$name", "replace")) {
    Write-Host ""
    Write-Host "  WhatIf - nothing copied." -ForegroundColor Yellow
    Write-Host ""
    return
  }

  # Keep a way back that does not depend on this laptop being here.
  Invoke-Command -Session $session -ArgumentList $Destination, $name -ScriptBlock {
    param($dir, $n)
    $p = Join-Path $dir $n
    if (Test-Path $p) {
      Copy-Item $p ("$p.bak-" + (Get-Date -Format "yyyy-MM-dd-HHmm")) -Force
    } elseif (-not (Test-Path $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
  }

  Copy-Item -Path $file.FullName -Destination (Join-Path $Destination $name) -ToSession $session -Force
  Write-Host "  [OK] Copied." -ForegroundColor Green

  $after = Invoke-Command -Session $session -ArgumentList $Destination, $name -ScriptBlock {
    param($dir, $n)
    $i = Get-Item (Join-Path $dir $n)
    "$($i.Length) bytes, $($i.LastWriteTime)"
  }
  Write-Host "  Now there      : $after"

  if ($after -eq $before) {
    Write-Host "  [!] Unchanged - the target already had this exact file." -ForegroundColor Yellow
  }

  if ($Restart) {
    Write-Host ""
    Write-Host "  Restarting $TaskName ..."
    $r = Invoke-Command -Session $session -ArgumentList $TaskName -ScriptBlock {
      param($t)
      # end then run, rather than relying on a restart verb that older
      # Windows here does not have.
      schtasks /end /tn $t 2>&1 | Out-Null
      Start-Sleep -Seconds 2
      schtasks /run /tn $t 2>&1 | Out-String
    }
    Write-Host "  $($r.Trim())"
  }

  Write-Host ""
  Write-Host "=== Done ===" -ForegroundColor Cyan
  Write-Host ""
} finally {
  if ($session) { Remove-PSSession $session }
}
