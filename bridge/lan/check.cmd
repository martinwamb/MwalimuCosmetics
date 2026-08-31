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

:: --- Keep the receipt layouts in step ------------------------
:: The updater has always shipped one exe and nothing else, so a
:: Reports folder could quietly drift. A till missing a layout does
:: not fail - Modreports checks File.Exists and falls back to the
:: built-in one - which is exactly why a reprinted receipt came out
:: identical to an original on the one till that had lost
:: rptPosiflex_reprint.rpt. Nothing anywhere said so.
::
:: Only the receipt family travels. The other thirty-odd reports are
:: left alone: they are not implicated, and a smaller blast radius is
:: worth more here than completeness.
::
:: This runs BEFORE the up-to-date check below, because a till can be
:: on the current build and still be missing a layout - which is the
:: case that started all this.
set "RPTSRC=%SHAREROOT%\reports"
if exist "%RPTSRC%\" (
  if not exist "%FUMAS_DIR%\Reports\" mkdir "%FUMAS_DIR%\Reports" >nul 2>&1
  for %%R in ("%RPTSRC%\*.rpt") do call :syncrpt "%%~fR" "%%~nxR"
)

:: What this till actually holds, reported on every check-in. Four PCs
:: here have no remote access at all, so this line is the only way to
:: know what is on them.
set "RPTSTATE=REPRINT-MISSING"
if exist "%FUMAS_DIR%\Reports\rptPosiflex_reprint.rpt" (
  :: Not merely "a file is there" - the first eight characters of its
  :: hash, so a till holding a DIFFERENT reprint layout shows up in the
  :: fleet listing instead of reporting itself healthy. Every till should
  :: print the same eight characters; one that does not is the odd one.
  call :hash "%FUMAS_DIR%\Reports\rptPosiflex_reprint.rpt" RH
  if defined RH (set "RPTSTATE=reprint-!RH:~0,8!") else (set "RPTSTATE=reprint-ok")
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
  if exist "%FUMAS_DIR%\FumasV5_new.version.txt" del /f /q "%FUMAS_DIR%\FumasV5_new.version.txt" >nul 2>&1
  call :checkin CURRENT "!HAVE!"
  exit /b 0
)

:: --- Stage the new build (only if not already staged) -------
:: A half-copied exe that got applied would leave the till broken,
:: so the copy is size-verified before it is trusted.
set "SRCSIZE=0"
for %%A in ("%SHAREROOT%\FumasV5-updated.exe") do set "SRCSIZE=%%~zA"

:: Which version the staged file actually IS, recorded when it was
:: staged. Size alone cannot answer this: two builds of the same
:: source tree are routinely byte-for-byte the same length while
:: differing in content, and that is not a rare case - it happened
:: on the very first day this ran, when two builds published an hour
:: apart were both 34,280,960 bytes. Every till kept the first one,
:: skipped the copy, and reported the second as staged. Left alone
:: they would have applied the older build, written the newer
:: version number beside it and gone quiet, permanently one build
:: behind with nothing on the machine to show it.
set "STGVER="
if exist "%FUMAS_DIR%\FumasV5_new.version.txt" (
  for /f "usebackq delims=" %%V in ("%FUMAS_DIR%\FumasV5_new.version.txt") do if not defined STGVER set "STGVER=%%V"
)

set "NEEDSTAGE=1"
if exist "%FUMAS_DIR%\FumasV5_new.exe" (
  set "STGSIZE=0"
  for %%A in ("%FUMAS_DIR%\FumasV5_new.exe") do set "STGSIZE=%%~zA"
  :: Both must agree: the right version, and a complete copy of it.
  :: A staged file with no version marker beside it is from before
  :: this check existed, so it is re-fetched rather than trusted.
  if "!STGSIZE!"=="!SRCSIZE!" if "!STGVER!"=="!WANT!" set "NEEDSTAGE="
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
  :: Written only after the exe is safely in place, so a marker can
  :: never claim a version the file beside it is not.
  > "%FUMAS_DIR%\FumasV5_new.version.txt" echo !WANT!
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
del /f /q "%FUMAS_DIR%\FumasV5_new.version.txt" >nul 2>&1

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

:syncrpt
:: Put one report layout on this till if what is here is not what the
:: share holds. %~1 = source path, %~2 = file name.
::
:: Compares CONTENT, not size. Size was the first attempt and it is not
:: good enough: the exe block below already records two different builds
:: arriving byte-for-byte the same length, and a report layout edited in
:: place is far likelier to keep its size than an exe is. A till holding a
:: stale layout of the right length would never have been corrected, and
:: would have gone on reporting itself perfectly fine.
set "DEST=%FUMAS_DIR%\Reports\%~2"
if not exist "!DEST!" goto :syncrpt_copy
call :hash "%~1" SRCH
call :hash "!DEST!" DSTH
if not defined SRCH goto :syncrpt_size
if not defined DSTH goto :syncrpt_size
if /i "!SRCH!"=="!DSTH!" goto :eof
goto :syncrpt_copy

:syncrpt_size
:: certutil missing or refused. Fall back to the old size test rather
:: than skipping the file: weaker, but it still catches a layout that is
:: absent or truncated, which is the case that started all this.
set "WANTSZ=0"
for %%A in ("%~1") do set "WANTSZ=%%~zA"
set "HAVESZ=0"
for %%A in ("!DEST!") do set "HAVESZ=%%~zA"
if "!WANTSZ!"=="!HAVESZ!" goto :eof

:syncrpt_copy
copy /y "%~1" "!DEST!" >nul 2>&1
if not errorlevel 1 call :say "Report %~2 refreshed."
goto :eof

:hash
:: MD5 of %~1 into the variable named by %~2, left empty if it cannot be
:: had. certutil ships with every Windows since 7, so this needs nothing
:: installed. It prints a header line, the hash, then a trailing line;
:: only the first line after the header is taken. Older builds group the
:: hash in byte pairs, hence the space strip.
set "%~2="
set "_H="
for /f "usebackq skip=1 delims=" %%H in (`certutil -hashfile "%~1" MD5 2^>nul`) do (
  if not defined _H set "_H=%%H"
)
if not defined _H goto :eof
set "_H=!_H: =!"
:: certutil writes its FAILURES to stdout as well, so skip=1 will happily
:: hand back "CertUtil:Thesystemcannotfindthefilespecified." as though it
:: were a hash. Two of those compare equal - which would make a broken or
:: absent certutil look like "the files already match" and quietly stop
:: refreshing layouts for good, the exact silent drift this routine exists
:: to end. So the answer must look like an MD5 before it is believed:
:: exactly 32 characters, hex only. Anything else returns empty and lets
:: the caller fall back to comparing size.
if "!_H:~31,1!"=="" goto :eof
if not "!_H:~32,1!"=="" goto :eof
echo(!_H!| findstr /i /r /c:"^[0-9a-f][0-9a-f]*$" >nul 2>&1
if errorlevel 1 goto :eof
set "%~2=!_H!"
goto :eof

:checkin
:: Report state to the check-in server. %~1 = state, %~2 = version.
:: Strictly best-effort: a server that is down, or a check-in share
:: not created yet, must never disturb the update itself - hence the
:: existence guard before the write, so nothing is printed.
if not defined CHKSRV goto :eof
net use "\\%CHKSRV%\checkins" /user:%CHKUSER% %CHKPASS% >nul 2>&1
if not exist "\\%CHKSRV%\checkins\" goto :eof
:: The RUNNING build is reported as well as the published one, and that
:: distinction is not pedantry. A till reports "STAGED <new version>", which
:: reads like it HAS the new build - and it does, sitting on disk, unapplied,
:: while the POS goes on running whatever it started with.
::
:: On 2026-08-31 that hid a till running a build from 19 August. Twelve days
:: old, and older than the collection ticket system entirely, so the cashier on
:: it issued no tickets at all - while the fleet listing showed her machine
:: carrying the same version as everybody else's.
::
:: Appended as a new field so anything already reading this line by position
:: keeps working.
set "RUNNING=!HAVE!"
if not defined RUNNING set "RUNNING=none"
> "\\%CHKSRV%\checkins\%COMPUTERNAME%.txt" echo %COMPUTERNAME% ^| %DATE% %TIME% ^| %~1 ^| %~2 ^| !FUMAS_DIR! ^| !RPTSTATE! ^| running=!RUNNING!
goto :eof
