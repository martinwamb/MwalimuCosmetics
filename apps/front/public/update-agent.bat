@echo off
:: Mwalimu Cosmetics - One-click agent updater
:: Send this file via WhatsApp/email to staff on any shop PC.
:: They double-click it, click Yes on the UAC prompt, and it's done.
:: After this runs, all future updates are fully automatic.

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
echo Downloading latest agent from server...

powershell -Command "Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/pusher.js' -OutFile 'C:\MwalimuSync\pusher.js' -UseBasicParsing" >nul 2>&1

if %errorlevel% neq 0 (
  echo [ERROR] Download failed. Check internet connection.
  pause
  exit /b 1
)
echo [OK] Agent downloaded.

:: Restart the sync task so the new version runs immediately
schtasks /end /tn "MwalimuSyncLoop" >nul 2>&1
timeout /t 2 /nobreak >nul
schtasks /run /tn "MwalimuSyncLoop" >nul 2>&1

if %errorlevel% equ 0 (
  echo [OK] Sync task restarted with the new version.
) else (
  echo [OK] File updated. It will take effect on the next sync cycle.
)

echo.
echo  =========================================
echo   Update complete! You can close this.
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
