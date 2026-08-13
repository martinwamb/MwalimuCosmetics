@echo off
:: ===========================================================
::  Mwalimu Cosmetics - add a check-in drop to the hub.
::
::  Run this ONCE on SERVER-PC (10.10.10.4), the same machine
::  that holds the update share. It adds a second, small share
::  the tills can WRITE a one-line status into every 10 minutes
::  - name, installed version, timestamp - so the laptop can
::  see the whole shop at a glance without reaching into any
::  till (which the tills' security settings block anyway).
::
::  The build share stays read-only; this is a separate folder,
::  and the worst a rogue till could do here is write junk into
::  its own status file. No build can be poisoned through it.
::
::  Right-click this file -> Run as administrator.
::
::  Plain ASCII, no multi-line continuations.
:: ===========================================================

setlocal

set "DIR=C:\MwalimuCheckins"
set "SHARENAME=checkins"
:: The tills already authenticate to this server with this
:: read-only account; here it is given write on THIS folder only.
set "USER=mwalimuupd"

title Mwalimu Cosmetics - add the check-in drop

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [STOP] This needs administrator rights.
  echo         Right-click %~nx0 and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   Adding the check-in drop on %COMPUTERNAME%
echo  ==========================================================
echo.

if not exist "%DIR%" mkdir "%DIR%" 2>nul
if not exist "%DIR%" (
  echo  [STOP] Could not create %DIR%
  echo.
  pause
  exit /b 1
)
echo  [OK] Folder %DIR%

net user %USER% >nul 2>&1
if errorlevel 1 (
  echo  [STOP] The %USER% account does not exist.
  echo         Run setup-hub.bat first - this builds on it.
  echo.
  pause
  exit /b 1
)

net share %SHARENAME% >nul 2>&1
if not errorlevel 1 net share %SHARENAME% /delete >nul 2>&1
net share %SHARENAME%="%DIR%" /grant:%USER%,CHANGE /remark:"Mwalimu till check-ins" >nul
if errorlevel 1 (
  echo  [STOP] Could not create the share.
  echo.
  pause
  exit /b 1
)
echo  [OK] Shared as \\%COMPUTERNAME%\%SHARENAME% (tills may write)

icacls "%DIR%" /grant "%USER%:(OI)(CI)M" >nul 2>&1
echo  [OK] Write permission granted on disk

echo.
echo  ==========================================================
echo   Done. Within about 10 minutes every till that has been
echo   set up will start reporting in. On the laptop, run:
echo.
echo       fleet-status.ps1
echo  ==========================================================
echo.
pause
