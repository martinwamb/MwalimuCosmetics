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

echo Downloading latest agent...

:: Force TLS 1.2 (required — older Windows defaults to TLS 1.0 which server rejects)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/pusher.js' -OutFile 'C:\MwalimuSync\pusher.js' -UseBasicParsing" >nul 2>&1

if %errorlevel% equ 0 goto downloaded

:: Fallback: try bitsadmin (works on all Windows versions, no TLS issue)
echo Trying alternate download method...
bitsadmin /transfer MwalimuUpdate /download /priority normal "https://api.mwalimucosmetics.com/sync/agent/pusher.js" "C:\MwalimuSync\pusher.js" >nul 2>&1

if %errorlevel% equ 0 goto downloaded

echo [ERROR] Both download methods failed.
echo         Confirm this PC can reach: api.mwalimucosmetics.com
echo         Try opening that address in a browser.
pause
exit /b 1

:downloaded
echo [OK] Agent downloaded.

:: Restart the sync task so the new version runs immediately
schtasks /end /tn "MwalimuSyncLoop" >nul 2>&1
timeout /t 2 /nobreak >nul
schtasks /run /tn "MwalimuSyncLoop" >nul 2>&1

if %errorlevel% equ 0 (
  echo [OK] Sync task restarted with the new version.
) else (
  echo [OK] File updated. It will take effect on the next sync cycle ^(within 30 seconds^).
)

echo.
echo  =========================================
echo   Update complete! You can close this.
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
