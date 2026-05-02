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

:: Force TLS 1.2 (older Windows defaults to TLS 1.0 which server rejects)
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://api.mwalimucosmetics.com/sync/agent/pusher.js' -OutFile 'C:\MwalimuSync\pusher.js' -UseBasicParsing" >nul 2>&1

if %errorlevel% equ 0 goto downloaded

:: Fallback: bitsadmin (works on all Windows, no TLS issue)
echo Trying alternate download method...
bitsadmin /transfer MwalimuUpdate /download /priority normal "https://api.mwalimucosmetics.com/sync/agent/pusher.js" "C:\MwalimuSync\pusher.js" >nul 2>&1

if %errorlevel% equ 0 goto downloaded

echo [ERROR] Both download methods failed.
echo         Confirm this PC can reach: api.mwalimucosmetics.com
pause
exit /b 1

:downloaded
echo [OK] Agent downloaded.

:: Kill any existing loop processes to avoid running two at once
taskkill /f /im powershell.exe /fi "WINDOWTITLE eq MwalimuSyncLoop*" >nul 2>&1

:: Stop Task Scheduler task if registered
schtasks /end /tn "MwalimuSyncLoop" >nul 2>&1
timeout /t 1 /nobreak >nul

:: Delete stale checkpoint so agent pushes immediately regardless of saved state
del /f /q "C:\MwalimuSync\checkpoint.json" >nul 2>&1
echo [OK] Checkpoint cleared — will push fresh data immediately.

:: Re-register Task Scheduler task (works whether or not it existed before)
schtasks /delete /tn "MwalimuSyncLoop" /f >nul 2>&1
schtasks /create /tn "MwalimuSyncLoop" /tr "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1" /sc ONSTART /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Task Scheduler task registered.
) else (
  echo [OK] Task registration skipped ^(non-fatal^).
)

:: Always start the loop immediately as a hidden background process
powershell -Command "Start-Process powershell -ArgumentList '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\MwalimuSync\loop.ps1' -WindowStyle Hidden"
echo [OK] Sync loop started in background.

:: Run one sync right now so data appears within seconds
echo Running first sync now...
"C:\Program Files\nodejs\node.exe" "C:\MwalimuSync\pusher.js"
if %errorlevel% equ 0 (
  echo [OK] First sync complete — dashboard will update within 15 seconds.
) else (
  echo [OK] Loop is running — dashboard will update within 30 seconds.
)

echo.
echo  =========================================
echo   Update complete! You can close this.
echo  =========================================
echo.
timeout /t 5 /nobreak >nul
