<#
  Mwalimu Cosmetics - shop-wide FumasV5 status, at a glance.

  Run this on the laptop. Every till that has been set up reports
  its name, installed build and the time it last checked in to a
  small share on the hub; this reads them all and shows one table.

  It works even though the laptop cannot reach into the tills: the
  tills push their status OUT to the hub (which they can do), and
  the laptop only ever reads the hub.

  Usage:
      .\fleet-status.ps1
      .\fleet-status.ps1 -Stale 30     # flag tills silent > 30 min
#>

param(
  [string]$Hub      = "10.10.10.4",
  [string]$Share    = "checkins",
  [string]$User     = "mwalimuupd",
  [string]$Password = "MwalimuUpd2026",
  # The build the shop should be on. Defaults to whatever is
  # currently published, so "up to date" always means "matches
  # what the laptop last published".
  [string]$Expected = "",
  [int]$Stale       = 20
)

$ErrorActionPreference = "Stop"

function Say($m, $c = "Gray") { Write-Host $m -ForegroundColor $c }

$unc = "\\$Hub\$Share"
cmd /c "net use `"$unc`" /delete /y >nul 2>nul"
cmd /c "net use `"$unc`" /user:$User $Password >nul 2>nul"
if (-not (Test-Path $unc)) {
  Say "[STOP] Cannot reach $unc" "Red"
  Say "Has setup-checkin.bat been run on ${Hub}? Until it has, no till can report in." "Yellow"
  exit 1
}

try {
  # Default "expected" to the currently published build.
  if (-not $Expected) {
    $pub = "\\$Hub\updates\FumasV5-version.txt"
    if (Test-Path $pub) { $Expected = (Get-Content $pub -First 1).Trim() }
  }

  $files = Get-ChildItem $unc -Filter *.txt -ErrorAction SilentlyContinue
  if (-not $files) {
    Say ""
    Say "No check-ins yet. Tills report in on their 10-minute cycle;" "Yellow"
    Say "give it up to 10 minutes after setup-checkin.bat was run." "Yellow"
    exit 0
  }

  $now  = Get-Date
  $rows = foreach ($f in $files) {
    $line  = (Get-Content $f.FullName -First 1 -ErrorAction SilentlyContinue)
    $parts = $line -split '\|' | ForEach-Object { $_.Trim() }
    # NAME | date time | STATE | version | dir
    $name    = if ($parts.Count -ge 1) { $parts[0] } else { $f.BaseName }
    $state   = if ($parts.Count -ge 3) { $parts[2] } else { "?" }
    $version = if ($parts.Count -ge 4) { $parts[3] } else { "" }
    $dir     = if ($parts.Count -ge 5) { $parts[4] } else { "" }

    # Liveness comes from the file's own modified time - it is
    # rewritten every check-in, and needs no clocks to agree.
    $ageMin = [int]([math]::Round(($now - $f.LastWriteTime).TotalMinutes))
    $silent = $ageMin -gt $Stale

    $ok = ($state -eq 'APPLIED' -or $state -eq 'CURRENT') -and ($version -eq $Expected)
    $mark = if ($silent) { 'SILENT' } elseif ($ok) { 'up-to-date' } elseif ($state -eq 'STAGED') { 'staged (POS open)' } elseif ($state -eq 'NOFUMAS') { 'no FumasV5' } else { 'BEHIND' }

    [PSCustomObject]@{
      Till      = $name
      Status    = $mark
      Build     = $version
      LastSeen  = "$ageMin min ago"
      State     = $state
      Where     = $dir
    }
  }

  Write-Host ""
  Write-Host "=== Shop FumasV5 status ===" -ForegroundColor Cyan
  Write-Host "Expected build: $Expected" -ForegroundColor Cyan
  Write-Host ""
  $rows | Sort-Object Till | Format-Table Till, Status, Build, LastSeen, Where -AutoSize | Out-String | Write-Host

  $good   = @($rows | Where-Object { $_.Status -eq 'up-to-date' }).Count
  $total  = $rows.Count
  $behind = @($rows | Where-Object { $_.Status -eq 'BEHIND' -or $_.Status -eq 'SILENT' }).Count
  Write-Host "$good of $total checked-in tills are on the expected build." -ForegroundColor $(if ($good -eq $total) { 'Green' } else { 'Yellow' })
  if ($behind) { Write-Host "$behind need a look (behind, or gone silent)." -ForegroundColor Yellow }
  Write-Host ""
  Say "Note: this lists only tills that have reported in at least once." "DarkGray"
  Say "A till you set up but do not see here has not run its check yet." "DarkGray"
  Write-Host ""
}
finally {
  cmd /c "net use `"$unc`" /delete /y >nul 2>nul"
}
