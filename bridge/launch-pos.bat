@echo off
:: Mwalimu Cosmetics — FumasV5 POS Launcher
:: Use this instead of launching FumasV5.exe directly.
:: It automatically applies any staged update before opening the POS.

:: ── Find FumasV5 installation ─────────────────────────────────
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
if not defined FUMAS_DIR (
  echo [ERROR] FumasV5.exe not found. Check installation path.
  pause
  exit /b 1
)

:: ── Apply staged update if one is waiting ─────────────────────
if exist "%FUMAS_DIR%\FumasV5_new.exe" (
  echo Applying FumasV5 update from %FUMAS_DIR%...
  taskkill /f /im FumasV5.exe >nul 2>&1
  timeout /t 2 /nobreak >nul
  copy /y "%FUMAS_DIR%\FumasV5_new.exe" "%FUMAS_DIR%\FumasV5.exe" >nul
  del  /f /q "%FUMAS_DIR%\FumasV5_new.exe" >nul
  echo Update applied.
)

:: ── Launch FumasV5 ─────────────────────────────────────────────
start "" "%FUMAS_DIR%\FumasV5.exe"
