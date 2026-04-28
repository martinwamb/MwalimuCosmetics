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
  echo Node.js is not installed. Downloading installer...
  powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.19.0/node-v20.19.0-x64.msi' -OutFile '%TEMP%\node-installer.msi'"
  echo Installing Node.js silently...
  msiexec /i "%TEMP%\node-installer.msi" /qn /norestart
  echo Node.js installed. Please re-run this installer.
  pause
  exit /b
)
echo [OK] Node.js found:
node --version

:: Install mysql npm package
echo.
echo Installing dependencies...
cd /d "%~dp0"
call npm install mysql --save 2>nul
echo [OK] Dependencies installed.

:: Check internet connectivity
echo.
echo Checking internet connection...
ping -n 1 api.mwalimucosmetics.com >nul 2>&1
if %errorlevel% neq 0 (
  echo [WARNING] Cannot reach api.mwalimucosmetics.com
  echo This PC may not have internet. The sync agent needs internet to push data.
  echo.
  echo If this PC has internet, check firewall settings.
  echo Install will continue but sync may not work from this PC.
  pause
)

:: Create install directory
set INSTALL_DIR=C:\MwalimuSync
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: Copy files
echo.
echo Copying files to %INSTALL_DIR%...
copy /y "%~dp0pusher.js" "%INSTALL_DIR%\pusher.js" >nul
copy /y "%~dp0package.json" "%INSTALL_DIR%\package.json" >nul 2>nul
xcopy /e /q /y "%~dp0node_modules" "%INSTALL_DIR%\node_modules\" >nul 2>nul
echo [OK] Files copied.

:: Create scheduled task - runs every 10 minutes
echo.
echo Creating scheduled task...
schtasks /delete /tn "MwalimuSync" /f >nul 2>&1
schtasks /create /tn "MwalimuSync" ^
  /tr "node \"%INSTALL_DIR%\pusher.js\"" ^
  /sc MINUTE /mo 10 ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f
if %errorlevel% equ 0 (
  echo [OK] Scheduled task created - runs every 10 minutes.
) else (
  echo [ERROR] Could not create scheduled task. Try running as Administrator.
  pause
  exit /b 1
)

:: Run once immediately to test
echo.
echo Running first sync now to test...
node "%INSTALL_DIR%\pusher.js"
if %errorlevel% equ 0 (
  echo.
  echo  ============================================
  echo   Installation complete!
  echo   Metrics will sync every 10 minutes.
  echo  ============================================
) else (
  echo.
  echo  [WARNING] First sync failed.
  echo  This may mean this PC cannot reach MySQL or the internet.
  echo  If another PC on the network has both connections, install there.
)

echo.
pause
