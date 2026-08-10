@echo off
:: ===========================================================
::  Mwalimu Cosmetics - LAN update hub. ONE-TIME SETUP.
::
::  Run this ONCE, on the always-on PC that will hold the
::  updates. Default is server-pc (10.10.10.4): it already
::  runs MySQL, so it is powered on whenever the shop trades.
::
::  It creates a read-only shared folder that every till polls
::  for new FumasV5 builds. The internet is not involved - the
::  laptop fills this share over the ethernet cable.
::
::  Right-click this file -> Run as administrator.
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal

set "SHAREDIR=C:\MwalimuUpdates"
set "SHARENAME=updates"

:: Two accounts, two jobs. The tills READ the share with the first one and
:: can do nothing else, so a compromised till cannot poison the update
:: everyone installs. The laptop WRITES new builds with the second one.
:: Sharing a single account would mean either the tills could tamper with
:: the share, or the laptop could not publish to it - this is the whole
:: reason there are two.
set "SHAREUSER=mwalimuupd"
set "SHAREPASS=MwalimuUpd2026"
set "PUBUSER=mwalimuadmin"
set "PUBPASS=MwalimuAdmin2026"

title Mwalimu Cosmetics - set up the LAN update hub

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
echo   Setting up the update hub on %COMPUTERNAME%
echo  ==========================================================
echo.

if not exist "%SHAREDIR%\agent" mkdir "%SHAREDIR%\agent" 2>nul
if not exist "%SHAREDIR%" (
  echo  [STOP] Could not create %SHAREDIR%
  echo.
  pause
  exit /b 1
)
echo  [OK] Folder %SHAREDIR%

:: A dedicated read-only account. The tills use it to read the
:: share. It is deliberately NOT an administrator and cannot
:: write anything, so a compromised till cannot poison the
:: update everyone else installs.
net user %SHAREUSER% >nul 2>&1
if errorlevel 1 (
  net user %SHAREUSER% %SHAREPASS% /add /comment:"Mwalimu read-only update account" /passwordchg:no >nul
  if errorlevel 1 (
    echo  [STOP] Could not create the %SHAREUSER% account.
    echo.
    pause
    exit /b 1
  )
  echo  [OK] Created read-only account %SHAREUSER%
) else (
  net user %SHAREUSER% %SHAREPASS% >nul
  echo  [OK] Account %SHAREUSER% already existed - password reset
)
wmic useraccount where "name='%SHAREUSER%'" set PasswordExpires=false >nul 2>&1

:: The publisher account the LAPTOP writes builds with. This is the same
:: mwalimuadmin used on the tills, so the whole shop needs only one admin
:: credential. Without a write-capable account here the laptop cannot
:: publish at all - which is exactly the wall the first version hit.
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
wmic useraccount where "name='%PUBUSER%'" set PasswordExpires=false >nul 2>&1
net localgroup Administrators %PUBUSER% /add >nul 2>&1

:: Share it. Recreate rather than assume the old definition is still what
:: we want. The tills get READ; the publisher gets CHANGE so the laptop
:: can drop new builds in. Both share-level and disk permissions have to
:: agree, or the more restrictive of the two wins and the write is denied.
net share %SHARENAME% >nul 2>&1
if not errorlevel 1 net share %SHARENAME% /delete >nul 2>&1
net share %SHARENAME%="%SHAREDIR%" /grant:%SHAREUSER%,READ /grant:%PUBUSER%,CHANGE /remark:"Mwalimu FumasV5 updates" >nul
if errorlevel 1 (
  echo  [STOP] Could not create the share.
  echo.
  pause
  exit /b 1
)
echo  [OK] Shared as \\%COMPUTERNAME%\%SHARENAME% (tills read, laptop writes)

icacls "%SHAREDIR%" /grant "%SHAREUSER%:(OI)(CI)RX" >nul 2>&1
icacls "%SHAREDIR%" /grant "%PUBUSER%:(OI)(CI)M" >nul 2>&1
echo  [OK] Disk permissions granted (read for tills, write for the laptop)

:: Let the laptop reach this machine with run-on-all too. Without the token
:: policy a LOCAL admin arriving over the network is stripped of its rights
:: and every remote command is denied - the same trap setup-pc.bat defuses.
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System" /v LocalAccountTokenFilterPolicy /t REG_DWORD /d 1 /f >nul 2>&1
netsh advfirewall firewall set rule group="File and Printer Sharing" new enable=Yes >nul 2>&1
netsh advfirewall firewall set rule group="Windows Management Instrumentation (WMI)" new enable=Yes >nul 2>&1
echo  [OK] File sharing allowed through the firewall
powershell -NoProfile -Command "try { Enable-PSRemoting -Force -SkipNetworkProfileCheck | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 echo  [OK] Remote PowerShell enabled

echo.
echo  ==========================================================
echo   Hub ready on %COMPUTERNAME%.
echo.
echo     Share:  \\%COMPUTERNAME%\%SHARENAME%
echo     Folder: %SHAREDIR%
echo.
echo   Next:
echo     1. On the laptop:  publish-update.ps1
echo        (fills the share with the current build)
echo     2. On every till:  setup-pc.bat   -- once each
echo  ==========================================================
echo.
pause
