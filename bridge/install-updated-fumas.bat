@echo off
:: ===========================================================
::  Mwalimu Cosmetics - install the updated FumasV5 ALONGSIDE
::  the existing one.
::
::  The current FumasV5.exe is NOT touched, replaced or renamed.
::  This adds a second executable next to it and puts a separate
::  shortcut on the desktop, so both versions can be opened at
::  any time and staff can fall back instantly by using the old
::  shortcut.
::
::  What the updated version changes: the stock check reads the
::  cached quantity instead of re-adding every movement an item
::  has ever had. On the busiest items that was measured at over
::  two seconds per scanned line.
::
::  Deliberately plain ASCII and no multi-line command
::  continuations: both have already broken this script once.
:: ===========================================================

setlocal

set "FUMAS_DIR=C:\mwalimu\Debugv5"
set "SOURCE=https://api.mwalimucosmetics.com/sync/agent/FumasV5-updated.exe"
set "NEW_EXE=%FUMAS_DIR%\FumasV5-updated.exe"
set "PS1=%TEMP%\mwalimu-shortcut.ps1"

title Install updated FumasV5 (alongside the current one)
echo.
echo  ==========================================================
echo   Installing the updated FumasV5 NEXT TO the current one
echo  ==========================================================
echo.

:: --- The existing installation must be there to sit beside ----
if not exist "%FUMAS_DIR%\FumasV5.exe" (
  echo  [STOP] No FumasV5 found at %FUMAS_DIR%
  echo         This PC does not appear to have FumasV5 installed,
  echo         so there is nothing to install alongside.
  echo.
  pause
  exit /b 1
)
echo  [OK] Found the current FumasV5 at %FUMAS_DIR%

:: --- Download beside, never over ------------------------------
echo.
echo  Downloading the updated version (about 33 MB)...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%SOURCE%' -OutFile '%NEW_EXE%.part' -UseBasicParsing; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo  [STOP] Download failed. Check the internet connection and try again.
  echo         Nothing has been changed on this PC.
  del /q "%NEW_EXE%.part" 2>nul
  echo.
  pause
  exit /b 1
)

:: A truncated download must never be left in place as if it worked.
for %%A in ("%NEW_EXE%.part") do set SIZE=%%~zA
if %SIZE% LSS 20000000 (
  echo  [STOP] The download looks incomplete ^(%SIZE% bytes^). Nothing changed.
  del /q "%NEW_EXE%.part" 2>nul
  echo.
  pause
  exit /b 1
)

move /y "%NEW_EXE%.part" "%NEW_EXE%" >nul
echo  [OK] Updated version saved as FumasV5-updated.exe

:: --- Its own settings file ------------------------------------
:: .NET reads settings from a file named after the executable, so
:: the updated copy needs its own alongside. Copied from the one
:: already working on this PC, so it points at the same server.
if exist "%FUMAS_DIR%\FumasV5.exe.config" (
  copy /y "%FUMAS_DIR%\FumasV5.exe.config" "%FUMAS_DIR%\FumasV5-updated.exe.config" >nul
  echo  [OK] Settings copied from the current installation
) else (
  echo  [WARN] No FumasV5.exe.config found - the updated version may
  echo         ask for connection details on first run.
)

:: --- A separate shortcut, leaving the existing one alone -------
:: Written to a script file rather than passed inline: quoting a
:: multi-line PowerShell command through cmd is what corrupted an
:: earlier version of this installer.
> "%PS1%" echo $ErrorActionPreference = 'SilentlyContinue'
>>"%PS1%" echo $exe = '%NEW_EXE%'
>>"%PS1%" echo $dir = '%FUMAS_DIR%'
>>"%PS1%" echo $made = $null
>>"%PS1%" echo foreach ($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('Desktop'))) {
>>"%PS1%" echo   if (-not $d -or -not (Test-Path $d)) { continue }
>>"%PS1%" echo   $p = Join-Path $d 'FumasV5 (Updated).lnk'
>>"%PS1%" echo   try {
>>"%PS1%" echo     $w = New-Object -ComObject WScript.Shell
>>"%PS1%" echo     $s = $w.CreateShortcut($p)
>>"%PS1%" echo     $s.TargetPath = $exe
>>"%PS1%" echo     $s.WorkingDirectory = $dir
>>"%PS1%" echo     $s.IconLocation = "$exe,0"
>>"%PS1%" echo     $s.Description = 'FumasV5 with the faster stock check'
>>"%PS1%" echo     $s.Save^(^)
>>"%PS1%" echo   } catch { continue }
>>"%PS1%" echo   if (Test-Path $p) { $made = $p; break }
>>"%PS1%" echo }
>>"%PS1%" echo if ($made) { Write-Host ("  [OK] Shortcut created: " + $made); exit 0 }
>>"%PS1%" echo Write-Host '  [FAILED] Could not create a desktop shortcut.'
>>"%PS1%" echo exit 1

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set SHORTCUT_RESULT=%errorlevel%
del /q "%PS1%" 2>nul

if %SHORTCUT_RESULT% NEQ 0 (
  echo.
  echo  [WARN] The updated version IS installed, but no shortcut could be
  echo         created. Open it directly at:
  echo           %NEW_EXE%
  echo         Or run this installer again as Administrator.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   Done.
echo.
echo   Desktop now has BOTH:
echo     FumasV5             - the version you have always used
echo     FumasV5 (Updated)   - the one with the faster stock check
echo.
echo   Nothing was removed. If the updated one misbehaves, simply
echo   use the original shortcut; it is untouched.
echo  ==========================================================
echo.
pause
