@echo off
:: ===========================================================
::  Mwalimu Cosmetics - the update check each till runs.
::
::  This file lives IN THE SHARE, not on the tills. The tills
::  only hold a five-line bootstrap that calls it. That is the
::  whole point: this logic can be corrected centrally, from
::  the laptop, without anyone walking to a machine again.
::
::  Every 10 minutes on each PC it:
::    1. finds FumasV5 wherever it is installed (the shop keeps
::       it in wildly different places, including a user's
::       Desktop - so a fixed list is not enough, and there is
::       a whole-disk fallback that remembers what it finds);
::    2. compares the build in the share with the installed one;
::    3. if they differ, copies the new build in and - if the
::       POS is not open at that moment - applies it there and
::       then. A running exe is never touched; it is applied on
::       a later run once staff have closed it.
::
::  Applying it here, rather than leaving it for launch-pos.bat,
::  matters because most tills open FumasV5.exe directly and
::  never go through that launcher.
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal enabledelayedexpansion

set "SHAREROOT=%~dp0.."
set "LOGDIR=C:\MwalimuSync"
set "LOG=%LOGDIR%\lan-update.log"
set "CACHE=%LOGDIR%\fumas-dir.txt"

:: Where to report status back to. By default it is the same
:: server this script runs from (\\<hub>\updates\agent\ -> pull the
:: server out of the path rather than hardcode it). But a one-line
:: agent\checkin-target.txt on the share can redirect it anywhere -
:: "server|user|pass" - which is how check-ins can be pointed at the
:: laptop while the hub itself has no check-in share. The account is
:: already required to reach this script, so carrying it exposes
:: nothing new; it gets write on the check-in share only, never the
:: builds.
set "CHKSRV="
set "CHKUSER=mwalimuupd"
set "CHKPASS=MwalimuUpd2026"
if exist "%~dp0checkin-target.txt" (
  for /f "usebackq tokens=1,2,3 delims=|" %%a in ("%~dp0checkin-target.txt") do (
    if not defined CHKSRV set "CHKSRV=%%a" & set "CHKUSER=%%b" & set "CHKPASS=%%c"
  )
)
if not defined CHKSRV (
  set "SR=%~dp0"
  if "!SR:~0,2!"=="\\" (
    set "T=!SR:~2!"
    for /f "tokens=1 delims=\" %%a in ("!T!") do set "CHKSRV=%%a"
  )
)

if not exist "%LOGDIR%" mkdir "%LOGDIR%" 2>nul

:: --- What does the share offer? -----------------------------
if not exist "%SHAREROOT%\FumasV5-version.txt" goto :nothing
if not exist "%SHAREROOT%\FumasV5-updated.exe" goto :nothing

set "WANT="
for /f "usebackq delims=" %%V in ("%SHAREROOT%\FumasV5-version.txt") do if not defined WANT set "WANT=%%V"
if not defined WANT goto :nothing

:: --- Where is FumasV5 on this machine? ----------------------
:: Not in the same place everywhere: C:\futuresoft\Debugv5 on one
:: PC, C:\Users\<name>\Desktop\Futuresoft\Debugv5 on another. So
:: try, in order: a path we found before, a list of usual spots,
:: every user's Desktop, then - only if we have never searched
:: this PC before - a full sweep of the drive, whose result is
:: remembered so the expensive sweep runs at most once.
set "FUMAS_DIR="
set "SEARCHED="

if exist "%CACHE%" (
  set "SEARCHED=1"
  for /f "usebackq delims=" %%D in ("%CACHE%") do if not defined FUMAS_DIR if exist "%%~D\FumasV5.exe" set "FUMAS_DIR=%%~D"
)

:: Known shapes, on EVERY drive that exists - FumasV5 is not always
:: on C: (one till keeps it on E:\futuresoft\Debugv5), so a C:-only
:: list silently misses those machines.
if not defined FUMAS_DIR (
  for %%D in (C D E F G) do if not defined FUMAS_DIR if exist "%%D:\" (
    for %%P in (
      "futuresoft\Debugv5"
      "mwalimu\Debugv5"
      "fumas\Debugv5"
      "fumasv5\Debugv5"
      "Debugv5"
      "FumasV5"
    ) do if not defined FUMAS_DIR if exist "%%D:\%%~P\FumasV5.exe" set "FUMAS_DIR=%%D:\%%~P"
  )
)

if not defined FUMAS_DIR (
  for %%P in ("C:\Program Files (x86)\FumasV5" "C:\Program Files\FumasV5") do if not defined FUMAS_DIR if exist "%%~P\FumasV5.exe" set "FUMAS_DIR=%%~P"
)

:: One level under the usual roots, on each drive.
if not defined FUMAS_DIR (
  for %%D in (C D E F G) do if not defined FUMAS_DIR if exist "%%D:\" (
    for /d %%R in ("%%D:\futuresoft\*" "%%D:\mwalimu\*" "%%D:\fumas\*") do (
      if not defined FUMAS_DIR if exist "%%~R\FumasV5.exe" set "FUMAS_DIR=%%~R"
    )
  )
)

:: Every user's Desktop, one folder deep, with or without a
:: Debugv5 under it - which is where this shop's tills keep it.
if not defined FUMAS_DIR (
  for /d %%U in ("C:\Users\*") do (
    for /d %%S in ("%%~U\Desktop\*") do (
      if not defined FUMAS_DIR if exist "%%~S\Debugv5\FumasV5.exe" set "FUMAS_DIR=%%~S\Debugv5"
      if not defined FUMAS_DIR if exist "%%~S\FumasV5.exe"          set "FUMAS_DIR=%%~S"
    )
  )
)

:: Last resort, once per PC: sweep every drive. dir /s here is a fast
:: metadata search, and gating it on SEARCHED means a PC that simply
:: has no FumasV5 does not re-sweep every 10 minutes.
if not defined FUMAS_DIR if not defined SEARCHED (
  for %%D in (C D E F G) do if not defined FUMAS_DIR if exist "%%D:\" (
    for /f "delims=" %%F in ('dir /b /s "%%D:\FumasV5.exe" 2^>nul') do if not defined FUMAS_DIR set "FUMAS_DIR=%%~dpF"
  )
)

:: Normalise a trailing backslash left by %%~dp, then record the
:: outcome so the sweep never runs again: a path if found, an
:: empty marker if not. Only written on the first search.
if defined FUMAS_DIR if "!FUMAS_DIR:~-1!"=="\" set "FUMAS_DIR=!FUMAS_DIR:~0,-1!"
if not defined SEARCHED (
  if defined FUMAS_DIR (> "%CACHE%" echo !FUMAS_DIR!) else (type nul > "%CACHE%")
)

if not defined FUMAS_DIR (
  call :say "[SKIP] FumasV5.exe not found on this PC."
  call :checkin NOFUMAS "-"
  exit /b 0
)

:: --- Already up to date? ------------------------------------
:: HAVE is the version actually APPLIED (written only after a
:: successful swap below), so a build that is staged but not yet
:: applied still counts as an update still to do.
set "HAVE="
if exist "%FUMAS_DIR%\FumasV5-version.txt" (
  for /f "usebackq delims=" %%V in ("%FUMAS_DIR%\FumasV5-version.txt") do if not defined HAVE set "HAVE=%%V"
)
if "!HAVE!"=="!WANT!" (
  :: Applied and current. Tidy any stale staged copy and stop.
  if exist "%FUMAS_DIR%\FumasV5_new.exe" del /f /q "%FUMAS_DIR%\FumasV5_new.exe" >nul 2>&1
  call :checkin CURRENT "!HAVE!"
  exit /b 0
)

:: --- Stage the new build (only if not already staged) -------
:: A half-copied exe that got applied would leave the till broken,
:: so the copy is size-verified before it is trusted.
set "SRCSIZE=0"
for %%A in ("%SHAREROOT%\FumasV5-updated.exe") do set "SRCSIZE=%%~zA"

set "NEEDSTAGE=1"
if exist "%FUMAS_DIR%\FumasV5_new.exe" (
  set "STGSIZE=0"
  for %%A in ("%FUMAS_DIR%\FumasV5_new.exe") do set "STGSIZE=%%~zA"
  if "!STGSIZE!"=="!SRCSIZE!" set "NEEDSTAGE="
)

if defined NEEDSTAGE (
  call :say "New build !WANT! in the share (this PC has !HAVE!). Copying..."
  copy /y "%SHAREROOT%\FumasV5-updated.exe" "%FUMAS_DIR%\FumasV5_new.exe.part" >nul 2>&1
  if errorlevel 1 (
    call :say "[FAIL] Could not copy from the share. Will retry in 10 minutes."
    exit /b 0
  )
  set "DSTSIZE=0"
  for %%A in ("%FUMAS_DIR%\FumasV5_new.exe.part") do set "DSTSIZE=%%~zA"
  if not "!DSTSIZE!"=="!SRCSIZE!" (
    call :say "[FAIL] Copy is incomplete (!DSTSIZE! of !SRCSIZE! bytes). Discarded."
    del /f /q "%FUMAS_DIR%\FumasV5_new.exe.part" >nul 2>&1
    exit /b 0
  )
  move /y "%FUMAS_DIR%\FumasV5_new.exe.part" "%FUMAS_DIR%\FumasV5_new.exe" >nul 2>&1
  if errorlevel 1 (
    call :say "[FAIL] Could not stage the new build."
    del /f /q "%FUMAS_DIR%\FumasV5_new.exe.part" >nul 2>&1
    exit /b 0
  )
)

:: --- Apply it, but never over a running POS -----------------
set "RUNNING="
tasklist /fi "imagename eq FumasV5.exe" 2>nul | find /i "FumasV5.exe" >nul && set "RUNNING=1"
if defined RUNNING (
  call :say "Build !WANT! staged in %FUMAS_DIR%; POS is open, will apply once it is closed."
  call :checkin STAGED "!WANT!"
  exit /b 0
)

copy /y "%FUMAS_DIR%\FumasV5_new.exe" "%FUMAS_DIR%\FumasV5.exe" >nul 2>&1
if errorlevel 1 (
  call :say "[FAIL] Could not apply the staged build. Left staged for the next run."
  exit /b 0
)

:: Confirm the applied exe matches the staged one before trusting it.
set "APPSIZE=0"
for %%A in ("%FUMAS_DIR%\FumasV5.exe") do set "APPSIZE=%%~zA"
if not "!APPSIZE!"=="!SRCSIZE!" (
  call :say "[FAIL] Applied exe is the wrong size (!APPSIZE! of !SRCSIZE!). Left staged."
  exit /b 0
)

del /f /q "%FUMAS_DIR%\FumasV5_new.exe" >nul 2>&1

:: Only now is it true that this PC is running this version.
> "%FUMAS_DIR%\FumasV5-version.txt" echo !WANT!
call :say "[OK] Applied build !WANT! on this PC (%FUMAS_DIR%)."
call :checkin APPLIED "!WANT!"
exit /b 0

:nothing
exit /b 0

:say
echo [%DATE% %TIME%] %COMPUTERNAME%: %~1 >> "%LOG%"
echo %~1
exit /b 0

:checkin
:: Report state to the check-in server. %~1 = state, %~2 = version.
:: Strictly best-effort: a server that is down, or a check-in share
:: not created yet, must never disturb the update itself - hence the
:: existence guard before the write, so nothing is printed.
if not defined CHKSRV goto :eof
net use "\\%CHKSRV%\checkins" /user:%CHKUSER% %CHKPASS% >nul 2>&1
if not exist "\\%CHKSRV%\checkins\" goto :eof
> "\\%CHKSRV%\checkins\%COMPUTERNAME%.txt" echo %COMPUTERNAME% ^| %DATE% %TIME% ^| %~1 ^| %~2 ^| !FUMAS_DIR!
goto :eof
