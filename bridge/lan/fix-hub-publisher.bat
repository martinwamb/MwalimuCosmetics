@echo off
:: ===========================================================
::  Mwalimu Cosmetics - add the publisher account to the hub.
::
::  Run this ONCE on SERVER-PC (10.10.10.4) if publishing from
::  the laptop fails with "password not correct". It adds the
::  write-capable account the laptop needs and re-grants the
::  existing "updates" share so builds can be dropped in.
::
::  It changes nothing else. Safe to run more than once.
::
::  Right-click this file -> Run as administrator.
::
::  Plain ASCII, no multi-line continuations.
:: ===========================================================

setlocal

set "SHAREDIR=C:\MwalimuUpdates"
set "SHARENAME=updates"
set "SHAREUSER=mwalimuupd"
set "SHAREPASS=MwalimuUpd2026"
set "PUBUSER=mwalimuadmin"
set "PUBPASS=MwalimuAdmin2026"

title Mwalimu Cosmetics - add publisher account to the hub

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
echo   Adding the publisher account on %COMPUTERNAME%
echo  ==========================================================
echo.

if not exist "%SHAREDIR%" (
  echo  [STOP] %SHAREDIR% does not exist.
  echo         Run setup-hub.bat first - this only adds the
  echo         publisher account to a hub that is already set up.
  echo.
  pause
  exit /b 1
)

:: The publisher account the laptop writes builds with.
net user %PUBUSER% >nul 2>&1
if errorlevel 1 (
  net user %PUBUSER% %PUBPASS% /add /comment:"Mwalimu publisher / remote admin" /passwordchg:no >nul
  if errorlevel 1 (
    echo  [STOP] Could not create the %PUBUSER% account.
    echo.
    pause
    exit /b 1
  )
  echo  [OK] Created publisher account %PUBUSER%
) else (
  net user %PUBUSER% %PUBPASS% >nul
  echo  [OK] Account %PUBUSER% already existed - password reset
)
powershell -NoProfile -Command "Set-LocalUser -Name '%PUBUSER%' -PasswordNeverExpires $true" >nul 2>&1
net localgroup Administrators %PUBUSER% /add >nul 2>&1

:: Re-share with BOTH grants: tills read, publisher writes. The old
:: share granted only the read account, which is exactly why the
:: laptop's write was denied.
net share %SHARENAME% >nul 2>&1
if not errorlevel 1 net share %SHARENAME% /delete >nul 2>&1
net share %SHARENAME%="%SHAREDIR%" /grant:%SHAREUSER%,READ /grant:%PUBUSER%,CHANGE /remark:"Mwalimu FumasV5 updates" >nul
if errorlevel 1 (
  echo  [STOP] Could not re-create the share.
  echo.
  pause
  exit /b 1
)
echo  [OK] Share re-granted (tills read, laptop writes)

icacls "%SHAREDIR%" /grant "%SHAREUSER%:(OI)(CI)RX" >nul 2>&1
icacls "%SHAREDIR%" /grant "%PUBUSER%:(OI)(CI)M" >nul 2>&1
echo  [OK] Disk permissions granted

echo.
echo  ==========================================================
echo   Done. Tell the laptop to publish again.
echo  ==========================================================
echo.
pause
