@echo off
:: Mwalimu Cosmetics — FumasV5 POS Launcher
:: Use this instead of launching FumasV5.exe directly.
:: It automatically applies any staged update before opening the POS.

set DIR=C:\mwalimu\Debugv5

:: ── Apply staged update if one is waiting ─────────────────────
if exist "%DIR%\FumasV5_new.exe" (
    echo Applying FumasV5 update...
    taskkill /f /im FumasV5.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
    copy /y "%DIR%\FumasV5_new.exe" "%DIR%\FumasV5.exe" >nul
    del  /f /q "%DIR%\FumasV5_new.exe" >nul
    echo Update applied. Starting POS...
)

:: ── Launch FumasV5 ─────────────────────────────────────────────
start "" "%DIR%\FumasV5.exe"
