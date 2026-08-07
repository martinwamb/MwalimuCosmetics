@echo off
:: ===========================================================
::  Mwalimu Cosmetics - prepare an offline install kit.
::
::  Only two PCs in the shop have internet. Run this on one of
::  them, pointing at a USB stick or a shared folder, and it
::  puts everything the other machines need in one place:
::
::      FumasV5-updated.exe          the new build
::      install-updated-fumas.bat    the installer
::      INSTALL.txt                  what to do with them
::
::  Then on every other PC, open that folder and double-click
::  install-updated-fumas.bat. It finds the exe sitting beside
::  it and never touches the internet.
::
::  Usage:
::      prepare-offline-install.bat E:\fumas-update
::      prepare-offline-install.bat \\SERVER-PC\shared\fumas-update
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal

set "DEST=%~1"
if "%DEST%"=="" (
  echo.
  echo  Where should the kit go?
  echo.
  echo    %~nx0 E:\fumas-update
  echo    %~nx0 \\SERVER-PC\shared\fumas-update
  echo.
  pause
  exit /b 1
)

set "BASE=https://api.mwalimucosmetics.com/sync/agent"

title Prepare offline install kit for the other PCs
echo.
echo  ==========================================================
echo   Building an offline install kit
echo  ==========================================================
echo   From: %COMPUTERNAME%
echo   To:   %DEST%
echo.

if not exist "%DEST%" mkdir "%DEST%" 2>nul
if not exist "%DEST%" (
  echo  [STOP] Could not create %DEST%
  echo         Check the drive letter, or that the share is reachable
  echo         and you can write to it.
  echo.
  pause
  exit /b 1
)

echo  Downloading the updated FumasV5 ^(about 33 MB^)...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%BASE%/FumasV5-updated.exe' -OutFile '%DEST%\FumasV5-updated.exe.part' -UseBasicParsing; exit 0 } catch { exit 1 }"
if errorlevel 1 goto :failed

:: A truncated download must never be handed round the shop as if it worked.
for %%A in ("%DEST%\FumasV5-updated.exe.part") do set SIZE=%%~zA
if %SIZE% LSS 20000000 (
  echo  [STOP] The download looks incomplete ^(%SIZE% bytes^).
  del /q "%DEST%\FumasV5-updated.exe.part" 2>nul
  echo.
  pause
  exit /b 1
)
move /y "%DEST%\FumasV5-updated.exe.part" "%DEST%\FumasV5-updated.exe" >nul
echo  [OK] FumasV5-updated.exe

echo  Downloading the installer...
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri '%BASE%/install-updated-fumas.bat' -OutFile '%DEST%\install-updated-fumas.bat' -UseBasicParsing; exit 0 } catch { exit 1 }"
if errorlevel 1 goto :failed
echo  [OK] install-updated-fumas.bat

> "%DEST%\INSTALL.txt" echo Mwalimu Cosmetics - updated FumasV5
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo On each PC:
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo   1. Open this folder.
>>"%DEST%\INSTALL.txt" echo   2. Double-click install-updated-fumas.bat
>>"%DEST%\INSTALL.txt" echo   3. Wait for "Done", then close the window.
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo No internet is needed. The installer uses the copy of
>>"%DEST%\INSTALL.txt" echo FumasV5-updated.exe sitting next to it in this folder.
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo Nothing is removed. The desktop ends up with BOTH:
>>"%DEST%\INSTALL.txt" echo   FumasV5             - the version you have always used
>>"%DEST%\INSTALL.txt" echo   FumasV5 ^(Updated^)   - the new one
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo If the updated one misbehaves, just use the old shortcut.
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo If it says it cannot find FumasV5, run it like this
>>"%DEST%\INSTALL.txt" echo instead, with the folder that holds FumasV5.exe:
>>"%DEST%\INSTALL.txt" echo.
>>"%DEST%\INSTALL.txt" echo   install-updated-fumas.bat /dir "C:\futuresoft\Debugv5"
echo  [OK] INSTALL.txt

echo.
echo  ==========================================================
echo   Kit ready in %DEST%
echo.
echo   Take it to each PC, open the folder, and double-click
echo   install-updated-fumas.bat. No internet needed there.
echo  ==========================================================
echo.
pause
exit /b 0

:failed
echo.
echo  [STOP] Download failed. This PC needs internet to build the kit.
echo         Run it on one of the two connected machines.
echo.
del /q "%DEST%\FumasV5-updated.exe.part" 2>nul
pause
exit /b 1
