@echo off
setlocal
title Mwalimu Cosmetics - Sync Agent Installer

echo.
echo  ============================================
echo   Mwalimu Cosmetics  --  Sync Agent Installer
echo  ============================================
echo.

:: Must run as Administrator for Task Scheduler registration
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Please right-click this file and choose "Run as administrator".
  pause
  exit /b 1
)

:: Check for Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js not found. Downloading Node.js v20...
  powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'"
  echo Installing silently — this may take a minute...
  msiexec /i "%TEMP%\node-installer.msi" /qn /norestart
  echo.
  echo Node.js installed. Please close this window and run the installer again.
  pause
  exit /b
)
echo [OK] Node.js:
node --version

:: Check internet connectivity
echo.
echo Checking internet connection...
ping -n 1 api.mwalimucosmetics.com >nul 2>&1
if %errorlevel% neq 0 (
  echo [WARNING] Cannot reach api.mwalimucosmetics.com
  echo           This PC needs an internet connection to sync to the dashboard.
  echo.
)

:: Create install directory
set INSTALL_DIR=C:\MwalimuSync
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Install npm dependency (mysql package)
echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install mysql --save >nul 2>&1
echo [OK] Dependencies ready.

:: Copy files to install directory
echo.
echo Copying files to %INSTALL_DIR%...
copy /y "%~dp0pusher.js"    "%INSTALL_DIR%\pusher.js"    >nul
copy /y "%~dp0loop.ps1"     "%INSTALL_DIR%\loop.ps1"     >nul
copy /y "%~dp0daily-backup.js" "%INSTALL_DIR%\daily-backup.js" >nul 2>nul
copy /y "%~dp0package.json" "%INSTALL_DIR%\package.json" >nul 2>nul
xcopy /e /q /y "%~dp0node_modules" "%INSTALL_DIR%\node_modules\" >nul 2>nul
echo [OK] Files copied.

:: Remove any old startup VBS entry (previous install method)
set OLD_VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MwalimuSync.vbs
if exist "%OLD_VBS%" (
  del /f /q "%OLD_VBS%" >nul
  echo [OK] Removed old startup VBS entry.
)

:: Remove any old scheduled tasks
schtasks /delete /tn "MwalimuSync"     /f >nul 2>&1
schtasks /delete /tn "MwalimuSyncLoop" /f >nul 2>&1

:: Register Task Scheduler task — runs as SYSTEM at boot, restarts on failure.
:: This survives log-offs, user switches, and doesn't depend on who is logged in.
echo.
echo Registering Windows Task Scheduler task...
schtasks /create /tn "MwalimuSyncLoop" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1" /sc ONSTART /ru SYSTEM /rl HIGHEST /f >nul
if %errorlevel% equ 0 (
  echo [OK] Task registered: runs at every boot under SYSTEM account.
) else (
  echo [WARNING] Task Scheduler registration failed. Falling back to startup folder.
  set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MwalimuSync.vbs
  echo Set objShell = CreateObject("WScript.Shell") > "%STARTUP%"
  echo objShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1", 0, False >> "%STARTUP%"
  echo [OK] Auto-start on login configured via Startup folder.
)

:: Run a first sync now so we can confirm connectivity
echo.
echo Running first sync (output visible this one time only)...
node "%INSTALL_DIR%\pusher.js"
if %errorlevel% equ 0 (
  echo [OK] First sync successful!
) else (
  echo [WARNING] First sync failed.
  echo           Check: ethernet cable connected, and internet access available.
)

:: Start the loop immediately without waiting for a reboot
echo.
echo Starting background sync loop now...
powershell -Command "Start-Process powershell -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1' -WindowStyle Hidden"
echo [OK] Sync loop running silently in background.

echo.
echo  ============================================
echo   Installation complete!
echo   - Syncs every 30 seconds (live data)
echo   - Starts automatically at boot (Task Scheduler)
echo   - No popup windows — fully silent
echo   - Log: C:\MwalimuSync\sync.log
echo  ============================================
echo.
pause
