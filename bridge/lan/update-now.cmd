@echo off
:: ===========================================================
::  Mwalimu Cosmetics - update THIS PC right now.
::
::  The scheduled task already does this every 10 minutes, and
::  swaps the build in the next time the POS is opened. This is
::  for when that is too slow: previewing a new build on one
::  machine, or checking a fix has landed.
::
::  Run it from a command prompt on the till:
::
::      \\10.10.10.4\updates\agent\update-now.cmd
::
::  Close FumasV5 first. Windows will not overwrite a running
::  exe, so with the POS open this stages the build and stops -
::  exactly what the scheduled task does - and says so.
::
::  It also copies the collection-ticket QR images, which the
::  normal update does not carry: that ships one exe, and these
::  are 900 small files that only change if the bot is renamed.
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal enabledelayedexpansion

set "HUB=10.10.10.4"
set "SHARE=updates"
set "SHAREUSER=mwalimuupd"
set "SHAREPASS=MwalimuUpd2026"
set "ROOT=\\%HUB%\%SHARE%"

echo.
echo === Updating this PC now ===
echo.

:: Is the POS open? Worth saying before anything else happens,
:: because it decides whether this ends in "applied" or "staged".
tasklist /fi "imagename eq FumasV5.exe" 2>nul | find /i "FumasV5.exe" >nul
if not errorlevel 1 (
  echo   [!] FumasV5 is OPEN on this PC.
  echo       The new build will be copied but cannot replace a running
  echo       program. Close the POS, then run this again.
  echo.
)

net use "%ROOT%" /user:%SHAREUSER% %SHAREPASS% >nul 2>&1
if not exist "%ROOT%\FumasV5-version.txt" (
  echo   [STOP] Cannot reach %ROOT%
  echo          Check the network cable and that SERVER-PC is on.
  goto :done
)

for /f "usebackq delims=" %%V in ("%ROOT%\FumasV5-version.txt") do set "WANT=%%V"
echo   Published build: !WANT!
echo.

:: All the real logic lives in check.cmd on the share, so this
:: cannot drift from what the scheduled task does.
if not exist "%ROOT%\agent\check.cmd" (
  echo   [STOP] agent\check.cmd is missing from the share.
  goto :done
)
call "%ROOT%\agent\check.cmd"

:: check.cmd remembers where FumasV5 lives on this machine, which
:: saves searching five drives for it a second time.
set "FUMAS_DIR="
if exist "C:\MwalimuSync\fumas-dir.txt" (
  for /f "usebackq delims=" %%D in ("C:\MwalimuSync\fumas-dir.txt") do if not defined FUMAS_DIR set "FUMAS_DIR=%%~D"
)

echo.
if not defined FUMAS_DIR (
  echo   [!] Could not tell where FumasV5 is installed, so the QR
  echo       images were not copied. Slips will still print - the
  echo       Telegram link appears as text instead of a code.
  goto :report
)

if exist "%ROOT%\tickets-qr" (
  echo   Copying collection-ticket QR images...
  xcopy "%ROOT%\tickets-qr\*.png" "!FUMAS_DIR!\Tickets\qr\" /i /y /q >nul 2>&1
  if errorlevel 1 (
    echo   [!] QR images did not copy. Slips still print, with the
    echo       Telegram link as text instead of a code.
  ) else (
    echo   [OK] QR images are in !FUMAS_DIR!\Tickets\qr
  )
)

:report
echo.
set "HAVE="
if defined FUMAS_DIR if exist "!FUMAS_DIR!\FumasV5-version.txt" (
  for /f "usebackq delims=" %%V in ("!FUMAS_DIR!\FumasV5-version.txt") do set "HAVE=%%V"
)
if "!HAVE!"=="!WANT!" (
  echo   === This PC is now running !WANT! - open the POS ===
) else (
  if defined FUMAS_DIR if exist "!FUMAS_DIR!\FumasV5_new.exe" (
    echo   === Build !WANT! is staged. Close the POS and run this again. ===
  ) else (
    echo   === This PC has !HAVE!, the share has !WANT!. See the log: ===
    echo       C:\MwalimuSync\lan-update.log
  )
)

:done
net use "%ROOT%" /delete >nul 2>&1
echo.
pause
endlocal
