@echo off
:: ===========================================================
::  Mwalimu Cosmetics - what is actually on THIS PC.
::
::  For when one machine behaves differently from the rest and
::  nobody can say why. It changes nothing; it only looks.
::
::  Run it on the till in question:
::
::      net use \10.10.10.4\updates /user:mwalimuupd MwalimuUpd2026 && \10.10.10.4\updates\agent\diagnose.cmd
::
::  The thing it is really looking for is a SECOND install.
::  check.cmd remembers the first FumasV5.exe it finds and
::  updates only that one, so a PC with two copies can report
::  itself up to date while the icon on the desktop launches a
::  stale one - which looks exactly like "the fix did not work".
::
::  Plain ASCII and no multi-line continuations: both have
::  already broken a script in this folder once.
:: ===========================================================

setlocal enabledelayedexpansion

set "HUB=10.10.10.4"
set "ROOT=\%HUB%\updates"
set "OUT=%TEMP%\fumas-diagnose.txt"

net use "%ROOT%" /user:mwalimuupd MwalimuUpd2026 >nul 2>&1

call :both ""
call :both "=== FumasV5 on %COMPUTERNAME% ==="
call :both ""

set "WANT="
if exist "%ROOT%\FumasV5-version.txt" for /f "usebackq delims=" %%V in ("%ROOT%\FumasV5-version.txt") do if not defined WANT set "WANT=%%V"
call :both "  published build : !WANT!"

set "CACHED="
if exist "C:\MwalimuSync\fumas-dir.txt" for /f "usebackq delims=" %%D in ("C:\MwalimuSync\fumas-dir.txt") do if not defined CACHED set "CACHED=%%~D"
call :both "  updater updates : !CACHED!"
call :both ""

:: --- Every install on this machine, not just the first ------
call :both "  -- every FumasV5.exe on this PC --"
set "N=0"
for %%D in (C D E F G) do if exist "%%D:\" (
  for /f "delims=" %%F in ('dir /b /s "%%D:\FumasV5.exe" 2^>nul') do (
    set /a N+=1
    set "DIR=%%~dpF"
    if "!DIR:~-1!"=="\" set "DIR=!DIR:~0,-1!"
    set "VER=(none)"
    if exist "!DIR!\FumasV5-version.txt" for /f "usebackq delims=" %%V in ("!DIR!\FumasV5-version.txt") do set "VER=%%V"
    set "RPT=MISSING"
    if exist "!DIR!\Reports\rptPosiflex_reprint.rpt" set "RPT=present"
    set "STAGED=no"
    if exist "!DIR!\FumasV5_new.exe" set "STAGED=YES"
    call :both "   !N!. !DIR!"
    call :both "      build=!VER!  reprint-layout=!RPT!  staged-update=!STAGED!  exe=%%~tF"
  )
)
if "!N!"=="0" call :both "   none found"
call :both ""
if not "!N!"=="1" call :both "  [!] More than one install - the updater only maintains the cached one above."

:: --- What the icons actually launch ------------------------
call :both ""
call :both "  -- shortcuts that launch FumasV5 --"
set "VBS=%TEMP%\fumas-lnk.vbs"
> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>>"%VBS%" echo Set fso = CreateObject("Scripting.FileSystemObject")
>>"%VBS%" echo For Each d In Split(WScript.Arguments(0), "^|")
>>"%VBS%" echo   If fso.FolderExists(d) Then
>>"%VBS%" echo     For Each f In fso.GetFolder(d).Files
>>"%VBS%" echo       If LCase(fso.GetExtensionName(f.Name)) = "lnk" Then
>>"%VBS%" echo         Set lnk = sh.CreateShortcut(f.Path)
>>"%VBS%" echo         If InStr(LCase(lnk.TargetPath), "fumas") ^> 0 Then
>>"%VBS%" echo           WScript.Echo "   " ^& f.Name ^& " -^> " ^& lnk.TargetPath
>>"%VBS%" echo           WScript.Echo "      starts in: [" ^& lnk.WorkingDirectory ^& "]"
>>"%VBS%" echo         End If
>>"%VBS%" echo       End If
>>"%VBS%" echo     Next
>>"%VBS%" echo   End If
>>"%VBS%" echo Next
for /f "delims=" %%L in ('cscript //nologo "%VBS%" "%PUBLIC%\Desktop^|%USERPROFILE%\Desktop" 2^>nul') do call :both "%%L"
del /f /q "%VBS%" >nul 2>&1
call :both ""
call :both "  A shortcut whose target is not the folder above is the answer:"
call :both "  the updater is maintaining one install and staff are opening another."
call :both ""
call :both "  Saved to %OUT%"
call :both ""

net use "%ROOT%" /delete >nul 2>&1
echo.
pause
endlocal
goto :eof

:both
echo %~1
>> "%OUT%" echo %~1
goto :eof
