@echo off
:: Mwalimu Cosmetics - One-click agent updater
:: Downloads all scripts and registers all scheduled tasks.
:: Run as Administrator when you want to update the sync agent.

net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

title Mwalimu Sync Agent - Update
echo.
echo  =========================================
echo   Mwalimu Cosmetics -- Agent Update
echo  =========================================
echo.

:: ── Find Node.js ──────────────────────────────────────────────
set NODE=
if exist "C:\Program Files\nodejs\node.exe"       set NODE=C:\Program Files\nodejs\node.exe
if exist "C:\Program Files (x86)\nodejs\node.exe" set NODE=C:\Program Files (x86)\nodejs\node.exe
if "%NODE%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do if "%NODE%"=="" set NODE=%%i
)
if "%NODE%"=="" (
  echo [ERROR] Node.js not found. Install from nodejs.org then run this again.
  pause
  exit /b 1
)
echo [OK] Node.js found: %NODE%

:: ── Create install directory ───────────────────────────────────
set DIR=C:\MwalimuSync
if not exist "%DIR%" mkdir "%DIR%"

:: ── Helper: download a file ────────────────────────────────────
:: Usage: call :download <url> <dest>
goto :skip_download
:download
  powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%~1' -OutFile '%~2' -UseBasicParsing" >nul 2>&1
  if exist "%~2" exit /b 0
  bitsadmin /transfer MWDl /download /priority normal "%~1" "%~2" >nul 2>&1
  if exist "%~2" exit /b 0
  exit /b 1
:skip_download

:: ── Download all agent scripts ─────────────────────────────────
echo Downloading agent files from server...

call :download "https://api.mwalimucosmetics.com/sync/agent/pusher.js"       "%DIR%\pusher.js"
if not exist "%DIR%\pusher.js" ( echo [ERROR] pusher.js download failed. Check internet. & pause & exit /b 1 )
echo [OK] pusher.js

call :download "https://api.mwalimucosmetics.com/sync/agent/loop.ps1"        "%DIR%\loop.ps1"
if exist "%DIR%\loop.ps1" ( echo [OK] loop.ps1 ) else echo [WARN] loop.ps1 download failed - using existing copy.

call :download "https://api.mwalimucosmetics.com/sync/agent/daily-backup.js" "%DIR%\daily-backup.js"
if exist "%DIR%\daily-backup.js" ( echo [OK] daily-backup.js ) else echo [WARN] daily-backup.js not downloaded.

call :download "https://api.mwalimucosmetics.com/sync/agent/daily-mirror.js" "%DIR%\daily-mirror.js"
if exist "%DIR%\daily-mirror.js" ( echo [OK] daily-mirror.js ) else echo [WARN] daily-mirror.js not downloaded.

:: ── Install mysql npm package ──────────────────────────────────
if not exist "%DIR%\node_modules\mysql" (
  echo Installing mysql dependency...
  cd /d "%DIR%"
  npm install mysql --save
  if exist "%DIR%\node_modules\mysql" (
    echo [OK] mysql package installed.
  ) else (
    echo [ERROR] npm install failed. Run manually: cd %DIR% ^&^& npm install mysql
    pause
    exit /b 1
  )
)

:: ── Stop existing sync processes ───────────────────────────────
echo Stopping old processes...
schtasks /end /tn "MwalimuSyncLoop"    >nul 2>&1
schtasks /end /tn "MwalimuDailyBackup" >nul 2>&1
schtasks /end /tn "MwalimuDailyMirror" >nul 2>&1
timeout /t 2 /nobreak >nul

:: ── Clear checkpoint so first sync pushes fresh data ──────────
del /f /q "%DIR%\checkpoint.json" >nul 2>&1
echo [OK] Checkpoint cleared.

:: ── Register Task Scheduler tasks ─────────────────────────────
echo Registering scheduled tasks...

:: Sync loop — runs at every boot under SYSTEM (persistent, not killed on user logoff)
schtasks /delete /tn "MwalimuSyncLoop" /f >nul 2>&1
schtasks /create /tn "MwalimuSyncLoop" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File %DIR%\loop.ps1" /sc ONSTART /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] MwalimuSyncLoop: registered (starts at every boot, runs as SYSTEM).
) else (
  echo [WARN] MwalimuSyncLoop task registration failed.
)

:: Daily backup — 5:00 PM
schtasks /delete /tn "MwalimuDailyBackup" /f >nul 2>&1
schtasks /create /tn "MwalimuDailyBackup" /tr "\"%NODE%\" %DIR%\daily-backup.js" /sc DAILY /st 17:00 /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] MwalimuDailyBackup: registered (runs at 5:00 PM daily).
) else (
  echo [WARN] MwalimuDailyBackup task registration failed.
)

:: Nightly mirror — 9:00 PM (full MySQL → Hetzner PostgreSQL)
schtasks /delete /tn "MwalimuDailyMirror" /f >nul 2>&1
schtasks /create /tn "MwalimuDailyMirror" /tr "\"%NODE%\" %DIR%\daily-mirror.js" /sc DAILY /st 21:00 /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] MwalimuDailyMirror: registered (runs at 9:00 PM daily).
) else (
  echo [WARN] MwalimuDailyMirror task registration failed.
)

:: ── Start the sync loop NOW (under SYSTEM — survives user logoff) ──
echo.
echo Starting sync loop under SYSTEM account...
schtasks /run /tn "MwalimuSyncLoop" >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] MwalimuSyncLoop started - running as SYSTEM in background.
) else (
  :: Fallback: start in current session
  powershell -Command "Start-Process powershell -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File %DIR%\loop.ps1' -WindowStyle Hidden"
  echo [OK] Sync loop started in current session (will restart at next boot).
)

:: ── Run one sync now to confirm everything works ───────────────
echo.
echo Running first sync...
"%NODE%" "%DIR%\pusher.js"
if %errorlevel% equ 0 (
  echo [OK] Sync complete.
) else (
  echo [WARN] Sync returned an error - loop will keep retrying.
)

echo.
echo  =========================================
echo   Update complete!
echo   Syncs live data when Refresh is clicked
echo   Daily backup: 5:00 PM
echo   Nightly mirror: 9:00 PM
echo   Loop runs as SYSTEM - no window needed
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
