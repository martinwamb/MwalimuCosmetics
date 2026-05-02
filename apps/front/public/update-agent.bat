@echo off
:: Mwalimu Cosmetics - One-click agent updater

:: Self-elevate to Administrator if not already elevated
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

:: Create install directory if it doesn't exist
if not exist "C:\MwalimuSync" mkdir "C:\MwalimuSync"

:: Find Node.js
set NODE=
if exist "C:\Program Files\nodejs\node.exe"       set NODE=C:\Program Files\nodejs\node.exe
if exist "C:\Program Files (x86)\nodejs\node.exe"  set NODE=C:\Program Files (x86)\nodejs\node.exe
if "%NODE%"=="" (
  for /f "delims=" %%i in ('where node 2^>nul') do set NODE=%%i
)
if "%NODE%"=="" (
  echo [ERROR] Node.js not found. Please install from nodejs.org then try again.
  pause
  exit /b 1
)
echo [OK] Node.js: %NODE%

echo Downloading latest agent files...

:: Download pusher.js (force TLS 1.2)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/pusher.js' -OutFile 'C:\MwalimuSync\pusher.js' -UseBasicParsing" >nul 2>&1
if %errorlevel% neq 0 (
  bitsadmin /transfer MW1 /download /priority normal "https://api.mwalimucosmetics.com/sync/agent/pusher.js" "C:\MwalimuSync\pusher.js" >nul 2>&1
)
if not exist "C:\MwalimuSync\pusher.js" (
  echo [ERROR] Could not download pusher.js. Check internet connection.
  pause
  exit /b 1
)
echo [OK] pusher.js downloaded.

:: Download loop.ps1 (the loop runner — also gets the node-finder fix)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/loop.ps1' -OutFile 'C:\MwalimuSync\loop.ps1' -UseBasicParsing" >nul 2>&1
if %errorlevel% neq 0 (
  bitsadmin /transfer MW2 /download /priority normal "https://api.mwalimucosmetics.com/sync/agent/loop.ps1" "C:\MwalimuSync\loop.ps1" >nul 2>&1
)
if exist "C:\MwalimuSync\loop.ps1" (
  echo [OK] loop.ps1 downloaded.
) else (
  echo [WARNING] Could not download loop.ps1. Using existing copy.
)

:: Install mysql npm package if node_modules is missing or incomplete
if not exist "C:\MwalimuSync\node_modules\mysql" (
  echo Installing mysql dependency ^(first time — may take a minute^)...
  cd /d "C:\MwalimuSync"
  npm install mysql --save
  if exist "C:\MwalimuSync\node_modules\mysql" (
    echo [OK] mysql package installed.
  ) else (
    echo [ERROR] npm install failed. Please run manually: cd C:\MwalimuSync ^&^& npm install mysql
    pause
    exit /b 1
  )
)

:: Delete stale checkpoint so agent pushes fresh data immediately
del /f /q "C:\MwalimuSync\checkpoint.json" >nul 2>&1
echo [OK] Checkpoint cleared.

:: Stop any running loops and tasks
taskkill /f /fi "IMAGENAME eq powershell.exe" /fi "WINDOWTITLE eq*MwalimuSync*" >nul 2>&1
schtasks /end    /tn "MwalimuSyncLoop" >nul 2>&1
timeout /t 1 /nobreak >nul

:: Re-register Task Scheduler task with the exact node path found above
schtasks /delete /tn "MwalimuSyncLoop" /f >nul 2>&1
schtasks /create /tn "MwalimuSyncLoop" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1" /sc ONSTART /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Task Scheduler: registered ^(starts at every boot^).
)

:: Start loop immediately
powershell -Command "Start-Process powershell -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1' -WindowStyle Hidden"
echo [OK] Sync loop started in background.

:: Run one sync immediately using the found node path
echo Running first sync now...
"%NODE%" "C:\MwalimuSync\pusher.js"
if %errorlevel% equ 0 (
  echo [OK] Sync complete — dashboard will update within 15 seconds.
) else (
  echo [OK] Loop is running — dashboard will update within 30 seconds.
)

echo.
echo  =========================================
echo   Update complete! You can close this.
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
