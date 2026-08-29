<#
  Mwalimu Cosmetics - run one command on every shop PC.

  Run this on the laptop, on the ethernet. Once setup-pc.bat has
  been run on each machine, this reaches all of them at once, so
  routine fixes and checks no longer need a walk round the shop.

  Usage:
      .\run-on-all.ps1 -Status
      .\run-on-all.ps1 -Command "schtasks /run /tn MwalimuLanUpdate"
      .\run-on-all.ps1 -Command "ipconfig /all" -Targets 10.10.10.12
      .\run-on-all.ps1 -Script .\something.ps1

  First run only, in an ADMIN PowerShell on this laptop:
      .\run-on-all.ps1 -TrustHosts
  That tells Windows it may authenticate to these machines by IP.
#>

# The shop credential is deliberately a plain default: these scripts run
# unattended from a scheduled task, where there is nobody to type a
# password. It is a shop-LAN account, not a personal one. See README.md
# for how to change it.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingPlainTextForPassword', '')]
[CmdletBinding(DefaultParameterSetName = "Run")]
param(
  [Parameter(ParameterSetName = "Run")][string]$Command,
  [Parameter(ParameterSetName = "Script")][string]$Script,
  [Parameter(ParameterSetName = "Status")][switch]$Status,
  [Parameter(ParameterSetName = "Trust")][switch]$TrustHosts,

  # The shop PCs, by address. Names verified 2026-08-29 by asking each machine
  # its own COMPUTERNAME over WinRM, not inferred from an ARP sweep - the
  # earlier list was a sweep from 2026-08-10 and had already gone stale twice.
  #
  #   .4   SERVER-PC        the hub. No agent and no POS - it is the file
  #                         share, so it will always report [FAIL] here.
  #   .6   powered off      one of DESKTOP-HP7C23J / DESKTOP-NOUIVGU
  #   .12  DESKTOP-L68F10R
  #   .16  DESKTOP-2TI5LOI
  #   .44  DESKTOP-CG9G8HP
  #   .56  powered off      the other of HP7C23J / NOUIVGU
  #   .63  DESKTOP-5KG879C  MISSING until 2026-08-29. It checks in and updates
  #                         itself, so nothing looked wrong - but no command
  #                         sent from this script had ever reached it.
  #   .71  MWALIMU-PC
  #   .156 CASHER1-PC
  #   .157 DESKTOP-4PTT33I
  #   .158 MWALIMU-OFFICE
  #   .180 SERVEROLD-PC
  #
  # DESKTOP-2HRTQOP is deliberately absent: it has never had setup-pc.bat run
  # on it, so there is nothing here to talk to. bridge/lan/find-unmanaged.js
  # is what finds machines in that state.
  #
  # Excluded: .86 is a network printer.
  [string[]]$Targets  = @("10.10.10.4",  "10.10.10.6",  "10.10.10.12",
                          "10.10.10.16", "10.10.10.44", "10.10.10.56",
                          "10.10.10.63", "10.10.10.71", "10.10.10.156",
                          "10.10.10.157","10.10.10.158","10.10.10.180"),
[string]$User       = "mwalimuadmin",
  [string]$Password   = "MwalimuAdmin2026"
)

$ErrorActionPreference = "Continue"

# Launched as "powershell.exe -File ... -Targets a,b" the whole list
# arrives as ONE string, and every address is then treated as a single
# unreachable host. Splitting here makes both invocation styles behave.
$Targets = $Targets -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }

if ($TrustHosts) {
  # WinRM will not authenticate to a bare IP with a local account
  # unless that host is trusted. Without this every call below
  # fails with an unhelpful "cannot determine content type".
  $list = ($Targets -join ",")
  Write-Host ""
  Write-Host "Setting WinRM TrustedHosts to: $list" -ForegroundColor Cyan
  try {
    # WinRM ships Stopped/Manual on a workstation, and the WSMan: drive
    # cannot be written while it is stopped - the failure this produces
    # says nothing about the service, so start it explicitly first.
    if ((Get-Service WinRM).Status -ne 'Running') {
      Write-Host "Starting the WinRM service (it ships stopped)..." -ForegroundColor Gray
      Start-Service WinRM -ErrorAction Stop
    }
    Set-Service WinRM -StartupType Automatic -ErrorAction SilentlyContinue
    Set-Item WSMan:\localhost\Client\TrustedHosts -Value $list -Force
    Write-Host "[OK] Done. You can now use -Command and -Status." -ForegroundColor Green
  } catch {
    Write-Host "[STOP] Needs an Administrator PowerShell." -ForegroundColor Red
    Write-Host "       $($_.Exception.Message)" -ForegroundColor Yellow
  }
  Write-Host ""
  exit 0
}

$secure = ConvertTo-SecureString $Password -AsPlainText -Force
$cred   = New-Object System.Management.Automation.PSCredential($User, $secure)

# What to actually run on each machine.
if ($Status) {
  $block = {
    $dir = @(
      "C:\futuresoft\Debugv5", "C:\mwalimu\Debugv5", "C:\fumasv5\Debugv5",
      "C:\Debugv5", "C:\FumasV5"
    ) | Where-Object { Test-Path (Join-Path $_ "FumasV5.exe") } | Select-Object -First 1

    $version = "unknown"
    $staged  = $false
    if ($dir) {
      $vf = Join-Path $dir "FumasV5-version.txt"
      if (Test-Path $vf) { $version = (Get-Content $vf -First 1).Trim() }
      $staged = Test-Path (Join-Path $dir "FumasV5_new.exe")
    }

    # Redirect inside cmd, not PowerShell-side: schtasks writes to
    # stderr when the task is absent, and "2>$null" would turn that
    # into a NativeCommandError record instead of a plain "missing".
    $task = cmd /c "schtasks /query /tn MwalimuLanUpdate >nul 2>nul && echo installed || echo missing"

    [PSCustomObject]@{
      FumasDir = if ($dir) { $dir } else { "not found" }
      Version  = $version
      Staged   = $staged
      Task     = $task
    }
  }
}
elseif ($Script) {
  if (-not (Test-Path $Script)) { Write-Host "[STOP] No script at $Script" -ForegroundColor Red; exit 1 }
  $body  = Get-Content $Script -Raw
  $block = [scriptblock]::Create($body)
}
elseif ($Command) {
  $block = [scriptblock]::Create("cmd /c `"$Command`"")
}
else {
  Write-Host "Nothing to do. Use -Status, -Command, -Script or -TrustHosts." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "=== Running on $($Targets.Count) PCs ===" -ForegroundColor Cyan

foreach ($ip in $Targets) {
  Write-Host ""
  Write-Host "--- $ip ---" -ForegroundColor White

  if (-not (Test-Connection -ComputerName $ip -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
    Write-Host "  [SKIP] Not responding - switched off, or unplugged." -ForegroundColor DarkYellow
    continue
  }

  try {
    $out = Invoke-Command -ComputerName $ip -Credential $cred -ScriptBlock $block -ErrorAction Stop
    if ($null -ne $out) { $out | Format-List | Out-String | Write-Host }
    Write-Host "  [OK]" -ForegroundColor Green
  }
  catch {
    $msg = $_.Exception.Message
    # WinRM's own wording is a paragraph long and buries the one useful
    # fact. Say the short version; keep the full text for -Verbose.
    if ($msg -match "TrustedHosts") {
      Write-Host "  [FAIL] This laptop is not allowed to authenticate to $ip yet." -ForegroundColor Red
      Write-Host "         Run once, in an Administrator PowerShell:" -ForegroundColor Yellow
      Write-Host "             .\run-on-all.ps1 -TrustHosts" -ForegroundColor White
    }
    elseif ($msg -match "Access is denied") {
      Write-Host "  [FAIL] Credentials rejected by $ip." -ForegroundColor Red
      Write-Host "         Has setup-pc.bat been run on that machine?" -ForegroundColor Yellow
    }
    elseif ($msg -match "WinRM|cannot be resolved|winrm") {
      Write-Host "  [FAIL] No remote PowerShell on $ip." -ForegroundColor Red
      Write-Host "         Has setup-pc.bat been run on that machine?" -ForegroundColor Yellow
    }
    else {
      Write-Host "  [FAIL] $msg" -ForegroundColor Red
    }
    Write-Verbose $msg
  }
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host ""
