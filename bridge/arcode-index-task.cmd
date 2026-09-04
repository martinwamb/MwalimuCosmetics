@echo off
REM Mwalimu Cosmetics - keep the overnight arcode-index job armed.
REM
REM MySQL's event_scheduler is a global that does NOT survive a restart, and
REM this server restarts. So every half hour this arms it again, and puts the
REM event back if a restart took it with it. That means the index gets built on
REM the first night the laptop has been on the shop LAN at some point during
REM that day - not only on a night the laptop happens to be here.
REM
REM Once the index exists the script drops the event, deletes this task and
REM stops. Nothing to remember and nothing to clean up.
REM
REM Installed with:
REM   schtasks /Create /TN MwalimuArcodeIndex /SC MINUTE /MO 30 /F ^
REM            /TR "<this file>"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
REM Logged in full rather than quietly. An empty log cannot tell "ran and
REM found nothing to do" from "never ran at all", and this task is meant to
REM be left alone for a week.
echo. >> "%~dp0arcode-index.log"
echo ==== %date% %time% ==== >> "%~dp0arcode-index.log"
"%NODE%" "%~dp0schedule-arcode-index.js" --apply >> "%~dp0arcode-index.log" 2>&1
