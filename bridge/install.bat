@echo off
setlocal
title Mwalimu Cosmetics - Sync Agent Installer

echo.
echo  ============================================
echo   Mwalimu Cosmetics  --  Sync Agent Installer
echo  ============================================
echo.

:: Check for Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js is not installed. Downloading...
  powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'"
  echo Installing Node.js silently...
  msiexec /i "%TEMP%\node-installer.msi" /qn /norestart
  echo Node.js installed. Please close and re-run this installer.
  pause
  exit /b
)
echo [OK] Node.js found:
node --version

:: Check internet
echo.
echo Checking internet connection...
ping -n 1 api.mwalimucosmetics.com >nul 2>&1
if %errorlevel% neq 0 (
  echo [WARNING] Cannot reach api.mwalimucosmetics.com
  echo This PC needs internet access to push data to the dashboard.
  echo.
  pause
)

:: Create install directory
set INSTALL_DIR=C:\MwalimuSync
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Install mysql dependency
echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install mysql --save >nul 2>&1
echo [OK] Dependencies ready.

:: Copy all files
echo.
echo Copying files to %INSTALL_DIR%...
copy /y "%~dp0pusher.js" "%INSTALL_DIR%\pusher.js" >nul
copy /y "%~dp0loop.ps1"  "%INSTALL_DIR%\loop.ps1"  >nul
copy /y "%~dp0package.json" "%INSTALL_DIR%\package.json" >nul 2>nul
xcopy /e /q /y "%~dp0node_modules" "%INSTALL_DIR%\node_modules\" >nul 2>nul
echo [OK] Files copied.

:: Remove any old scheduled task if it exists
schtasks /delete /tn "MwalimuSync" /f >nul 2>&1
schtasks /delete /tn "MwalimuSyncLoop" /f >nul 2>&1

:: Add to Startup folder so the loop runs on every login
set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\MwalimuSync.vbs
echo Set objShell = CreateObject("WScript.Shell") > "%STARTUP%"
echo objShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1", 0, False >> "%STARTUP%"
echo [OK] Auto-start on login configured.

:: Run a first sync now (visible, to confirm it works)
echo.
echo Running first sync to test (this is the only time you will see output)...
node "%INSTALL_DIR%\pusher.js"
if %errorlevel% equ 0 (
  echo [OK] First sync successful!
) else (
  echo [WARNING] First sync failed - check that ethernet and internet are both connected.
)

:: Start the background loop immediately (no window from now on)
echo.
echo Starting background sync loop...
powershell -Command "Start-Process powershell -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1' -WindowStyle Hidden"
echo [OK] Sync loop running silently in background.

echo.
echo  ============================================
echo   Installation complete!
echo   - Syncs every 10 minutes, no popup windows
echo   - Starts automatically on every login
echo   - Log: C:\MwalimuSync\sync.log
echo  ============================================
echo.
pause
