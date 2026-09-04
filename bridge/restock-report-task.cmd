@echo off
REM Mwalimu Cosmetics - the evening restock sheet.
REM
REM Runs on the PC that has node, the shop database and the internet. It works
REM out what is running low, sends the full list to Telegram as a PDF, and drops
REM the short sheet on the PC the Epson is plugged into, which prints it.
REM
REM Secrets are NOT in this file, because this file is in git. restock-secrets.cmd
REM sits beside it, is ignored by git, and exists only on the machine that runs
REM this. Without it the job still runs and still prints; it just says that
REM Telegram was skipped, which is the right way round.
REM
REM Installed with (note: New-ScheduledTaskAction, not schtasks /TR - a path with
REM a space in it gets split into a program and its arguments, and the task then
REM fails with 0x80070002 and no log at all):
REM   schtasks /Create /TN MwalimuRestock /SC DAILY /ST 19:00
setlocal
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

set "MWALIMU_DB_HOST=10.10.10.4"
set "MWALIMU_DB_USER=root"
set "MWALIMU_DB_PASSWORD=allowme"

if exist "%~dp0restock-secrets.cmd" call "%~dp0restock-secrets.cmd"

echo. >> "%~dp0restock-report.log"
echo ==== %date% %time% ==== >> "%~dp0restock-report.log"
"%NODE%" "%~dp0restock-report.js" --apply >> "%~dp0restock-report.log" 2>&1
endlocal
