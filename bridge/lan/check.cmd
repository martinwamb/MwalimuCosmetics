@echo off
:: ===========================================================
::  Mwalimu Cosmetics - the update check each till runs.
::
::  This file lives IN THE SHARE, not on the tills. The tills
::  only hold a five-line bootstrap that calls it. That is the
::  whole point: this logic can be corrected centrally, from
::  the laptop, without anyone walking to a machine again.
::
::  What it does, every 10 minutes on each PC:
::    - compares the build in the share with the one installed
::    - if they differ, copies the new one in as FumasV5_new.exe
::
::  It never overwrites a running FumasV5.exe. launch-pos.bat
::  swaps the staged file in the next time the POS is opened,
::  when the exe is definitely not in use.
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal enabledelayedexpansion

set "SHAREROOT=%~dp0.."
set "LOGDIR=C:\MwalimuSync"
set "LOG=%LOGDIR%\lan-update.log"

if not exist "%LOGDIR%" mkdir "%LOGDIR%" 2>nul

:: --- What does the share offer? -----------------------------
if not exist "%SHAREROOT%\FumasV5-version.txt" goto :nothing
if not exist "%SHAREROOT%\FumasV5-updated.exe" goto :nothing

set "WANT="
for /f "usebackq delims=" %%V in ("%SHAREROOT%\FumasV5-version.txt") do if not defined WANT set "WANT=%%V"
if not defined WANT goto :nothing

:: --- Where is FumasV5 on this machine? ----------------------
:: It is not in the same place everywhere: C:\mwalimu\Debugv5 on
:: one PC, C:\futuresoft\Debugv5 on another. Hardcoding one path
:: has already made a script refuse to run on a good machine.
set "FUMAS_DIR="
for %%P in (
  "C:\futuresoft\Debugv5"
  "C:\mwalimu\Debugv5"
  "C:\fumasv5\Debugv5"
  "C:\Debugv5"
  "C:\FumasV5"
  "C:\Program Files (x86)\FumasV5"
  "C:\Program Files\FumasV5"
) do if not defined FUMAS_DIR if exist "%%~P\FumasV5.exe" set "FUMAS_DIR=%%~P"

if not defined FUMAS_DIR (
  for /d %%R in ("C:\futuresoft\*" "C:\mwalimu\*") do (
    if not defined FUMAS_DIR if exist "%%~R\FumasV5.exe" set "FUMAS_DIR=%%~R"
  )
)

if not defined FUMAS_DIR (
  call :say "[SKIP] FumasV5.exe not found on this PC."
  exit /b 0
)

:: --- Already up to date? ------------------------------------
set "HAVE="
if exist "%FUMAS_DIR%\FumasV5-version.txt" (
  for /f "usebackq delims=" %%V in ("%FUMAS_DIR%\FumasV5-version.txt") do if not defined HAVE set "HAVE=%%V"
)
if "!HAVE!"=="!WANT!" exit /b 0

call :say "New build !WANT! in the share (this PC has !HAVE!). Copying..."

:: --- Copy, then verify before believing it ------------------
:: A half-copied exe that gets marked as installed would leave
:: the till broken and looking up to date, which is worse than
:: never having tried.
copy /y "%SHAREROOT%\FumasV5-updated.exe" "%FUMAS_DIR%\FumasV5_new.exe.part" >nul 2>&1
if errorlevel 1 (
  call :say "[FAIL] Could not copy from the share. Will retry in 10 minutes."
  exit /b 0
)

set "SRCSIZE=0"
set "DSTSIZE=0"
for %%A in ("%SHAREROOT%\FumasV5-updated.exe") do set "SRCSIZE=%%~zA"
for %%A in ("%FUMAS_DIR%\FumasV5_new.exe.part") do set "DSTSIZE=%%~zA"

if not "!SRCSIZE!"=="!DSTSIZE!" (
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

:: Only now is it true that this PC has this version. Writing
:: this earlier would make a failed copy look like a success.
> "%FUMAS_DIR%\FumasV5-version.txt" echo !WANT!

call :say "[OK] Build !WANT! staged in %FUMAS_DIR%. Applies next time the POS is opened."
exit /b 0

:nothing
exit /b 0

:say
echo [%DATE% %TIME%] %COMPUTERNAME%: %~1 >> "%LOG%"
echo %~1
exit /b 0
