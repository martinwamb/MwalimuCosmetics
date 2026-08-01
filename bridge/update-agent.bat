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

:: db-config.js resolves MySQL credentials from db-config.json instead of
:: source. Download it before the scripts that use it.
call :download "https://api.mwalimucosmetics.com/sync/agent/db-config.js"    "%DIR%\db-config.js"
if exist "%DIR%\db-config.js" ( echo [OK] db-config.js ) else echo [WARN] db-config.js not downloaded - scripts will use built-in fallback credentials.

call :download "https://api.mwalimucosmetics.com/sync/agent/schema-probe.js" "%DIR%\schema-probe.js"
if exist "%DIR%\schema-probe.js" ( echo [OK] schema-probe.js ) else echo [WARN] schema-probe.js not downloaded.

call :download "https://api.mwalimucosmetics.com/sync/agent/provision-db-user.js" "%DIR%\provision-db-user.js"
if exist "%DIR%\provision-db-user.js" ( echo [OK] provision-db-user.js ) else echo [WARN] provision-db-user.js not downloaded.

call :download "https://api.mwalimucosmetics.com/sync/agent/daily-backup.js" "%DIR%\daily-backup.js"
if exist "%DIR%\daily-backup.js" ( echo [OK] daily-backup.js ) else echo [WARN] daily-backup.js not downloaded.

call :download "https://api.mwalimucosmetics.com/sync/agent/daily-mirror.js" "%DIR%\daily-mirror.js"
if exist "%DIR%\daily-mirror.js" ( echo [OK] daily-mirror.js ) else echo [WARN] daily-mirror.js not downloaded.

call :download "https://api.mwalimucosmetics.com/sync/agent/launch-pos.bat" "%DIR%\launch-pos.bat"
if exist "%DIR%\launch-pos.bat" ( echo [OK] launch-pos.bat ) else echo [WARN] launch-pos.bat not downloaded.

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

:: ── FumasV5 POS update (download new version if available) ──────────────────
set FUMAS_DIR=C:\mwalimu\Debugv5
echo.
echo Checking for FumasV5 POS update...

:: Get version the server has
set SERVER_FUMAS_VER=
for /f "usebackq tokens=*" %%V in (`powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { ($([System.Text.Encoding]::UTF8.GetString((Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/FumasV5-version' -UseBasicParsing).Content)) | ConvertFrom-Json).version } catch { '' }" 2^>nul`) do set SERVER_FUMAS_VER=%%V

:: Get version we have locally
set LOCAL_FUMAS_VER=
if exist "%FUMAS_DIR%\FumasV5-version.txt" (
  set /p LOCAL_FUMAS_VER=<"%FUMAS_DIR%\FumasV5-version.txt"
)

if "%SERVER_FUMAS_VER%"=="" (
  echo [INFO] No FumasV5 build on server yet.
) else if "%SERVER_FUMAS_VER%"=="%LOCAL_FUMAS_VER%" (
  echo [OK] FumasV5 is up to date ^(%LOCAL_FUMAS_VER%^).
) else (
  echo Downloading FumasV5 update ^(%SERVER_FUMAS_VER%^) - please wait, this is a large file...
  if not exist "%FUMAS_DIR%" mkdir "%FUMAS_DIR%"
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/FumasV5.exe' -OutFile '%FUMAS_DIR%\FumasV5_new.exe' -UseBasicParsing" 2>nul
  if exist "%FUMAS_DIR%\FumasV5_new.exe" (
    echo %SERVER_FUMAS_VER%>"%FUMAS_DIR%\FumasV5-version.txt"
    echo [OK] FumasV5 update ready. Will apply on next POS start via launch-pos.bat.
  ) else (
    echo [WARN] FumasV5 download failed - check internet connection.
  )
)

:: Auto-detect FumasV5 installation folder on this PC
set FUMAS_DIR=
for %%P in (
  "C:\futuresoft\Debugv5"
  "C:\mwalimu\Debugv5"
  "C:\fumasv5\Debugv5"
  "C:\FumasV5"
) do (
  if exist "%%~P\FumasV5.exe" (
    if not defined FUMAS_DIR set FUMAS_DIR=%%~P
  )
)
if defined FUMAS_DIR (
  echo [OK] FumasV5 found at: %FUMAS_DIR%
  :: Download launch-pos.bat into the FumasV5 folder
  powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/launch-pos.bat' -OutFile '%FUMAS_DIR%\launch-pos.bat' -UseBasicParsing" 2>nul
  if exist "%FUMAS_DIR%\launch-pos.bat" (
    echo [OK] launch-pos.bat installed to %FUMAS_DIR%
    :: Create desktop shortcut pointing to correct FumasV5 folder
    powershell -NoProfile -Command "$s=(New-Object -COM WScript.Shell).CreateShortcut([Environment]::GetFolderPath('CommonDesktopDirectory')+'\Mwalimu POS.lnk'); $s.TargetPath='%FUMAS_DIR%\launch-pos.bat'; $s.WorkingDirectory='%FUMAS_DIR%'; $s.IconLocation='%FUMAS_DIR%\FumasV5.exe,0'; $s.Description='Mwalimu Cosmetics POS'; $s.Save()" 2>nul
    echo [OK] Desktop shortcut 'Mwalimu POS' created at %FUMAS_DIR%.
  )
) else (
  echo [WARN] FumasV5.exe not found in common locations. Shortcut not created.
)

:: ── Make default printer visible to SYSTEM account for background printing ──
:: The receipt printer is usually installed per-user. This command adds it to
:: the system-wide printer list so the sync agent (running as SYSTEM) can print.
echo.
echo Configuring printer for background printing...
for /f "tokens=2 delims==" %%P in ('wmic printer where "Default=True" get Name /format:list 2^>nul') do (
  if not "%%P"=="" (
    set SYS_PRINTER=%%P
  )
)
if defined SYS_PRINTER (
  rundll32 printui.dll,PrintUIEntry /ga /n "%SYS_PRINTER%" >nul 2>&1
  echo [OK] Printer "%SYS_PRINTER%" added to system-wide list.
  echo       The sync agent can now print receipts automatically.
) else (
  echo [INFO] No default printer found - set one in Windows Settings ^> Printers.
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
echo   POS: use 'Mwalimu POS' desktop shortcut
echo   FumasV5 updates apply on next POS start
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
