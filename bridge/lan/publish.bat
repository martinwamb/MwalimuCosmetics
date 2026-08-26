@echo off
:: ===========================================================
::  Mwalimu Cosmetics - publish a FumasV5 build to the shop.
::
::  Double-click this file, or from a prompt in this folder:
::
::      publish            check the build, then ask before sending
::      publish check      dry run - show what would happen, send nothing
::      publish now        send it without asking
::      publish "C:\some\other\FumasV5.exe"
::
::  It finds the build this laptop last compiled, hands it to
::  publish-update.ps1, and that puts it in the hub share. Every
::  till picks it up within 10 minutes and swaps it in the next
::  time the POS is opened, so nobody serving a customer is
::  interrupted.
::
::  Run it on the laptop, on the ethernet cable. The tills do
::  not need internet - the update travels over the LAN.
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal

set "HERE=%~dp0"
set "PS1=%HERE%publish-update.ps1"

:: The FumasV5 source repo sits beside this one under Documents, so the
:: build is found without anybody typing a path. Written relative to this
:: file rather than to C:\Users\Admin so it still works from another
:: account or a copied folder.
set "BUILD=%HERE%..\..\..\FumasV5\FumasV5\bin\Release\FumasV5.exe"

:: Where the older hand-copied builds used to live. Kept as a fallback so
:: this still works on a machine that has no source checkout.
set "FALLBACK=C:\Mwalimu\Debugv5\FumasV5-updated.exe"

set "MODE=ask"

if /i "%~1"=="check" set "MODE=check"
if /i "%~1"=="now"   set "MODE=now"
if /i "%~1"=="/?"    goto usage
if /i "%~1"=="-h"    goto usage
if /i "%~1"=="help"  goto usage

:: Anything else that was passed is treated as the build to send.
if not "%~1"=="" if /i not "%~1"=="check" if /i not "%~1"=="now" set "BUILD=%~1"

echo.
echo === Publish FumasV5 to the shop ===
echo.

if not exist "%PS1%" goto nops1

if not exist "%BUILD%" (
    if exist "%FALLBACK%" (
        set "BUILD=%FALLBACK%"
    ) else (
        goto nobuild
    )
)

:: Collapse the ..\..\.. into a real path before anyone reads it off
:: the screen to check they are sending the right build.
for %%F in ("%BUILD%") do set "BUILD=%%~fF"
for %%F in ("%BUILD%") do set "BUILT=%%~tF"

echo   Build:  %BUILD%
echo   Built:  %BUILT%
echo.

if /i "%MODE%"=="check" goto run
if /i "%MODE%"=="now"   goto run

echo   This sends that build to every till in the shop.
echo   Check the "Built" time above is the version you meant.
echo.
set "GO="
set /p "GO=Send it now? [y/N] "
if /i not "%GO%"=="y" goto cancelled
echo.

:run
if /i "%MODE%"=="check" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Source "%BUILD%" -WhatIf
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Source "%BUILD%"
)
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" goto failed

if /i "%MODE%"=="check" (
    echo   Dry run only - nothing was sent.
) else (
    echo   Sent. Every till picks it up within 10 minutes and swaps it
    echo   in the next time the POS is opened.
    echo.
    echo   To watch them come up to date:  fleet-status.ps1
)
goto done

:usage
echo.
echo   publish            check the build, then ask before sending
echo   publish check      dry run - show what would happen, send nothing
echo   publish now        send it without asking
echo   publish "C:\some\other\FumasV5.exe"
echo.
goto done

:nops1
echo   [STOP] publish-update.ps1 is not next to this file.
echo   Expected: %PS1%
set "RC=1"
goto done

:nobuild
echo   [STOP] No FumasV5 build found.
echo.
echo   Looked for:
echo     %BUILD%
echo     %FALLBACK%
echo.
echo   Build it first ^(Release^), or pass the path:
echo     publish "C:\path\to\FumasV5.exe"
set "RC=1"
goto done

:cancelled
echo   Cancelled - nothing was sent.
set "RC=0"
goto done

:failed
echo   [FAILED] publish-update.ps1 stopped with error %RC%.
echo   The tills have NOT been given this build.

:done
echo.
:: A double-clicked window closes the moment this exits, so wait for a
:: keypress. Anyone who typed an argument is already at a prompt and
:: does not need one.
::
:: Deliberately not the usual %CMDCMDLINE% test: that value can contain
:: quotes and a < from the caller's own redirection, and echoing it back
:: makes cmd act on them. It hung this script on the first run.
if "%~1"=="" pause
exit /b %RC%
