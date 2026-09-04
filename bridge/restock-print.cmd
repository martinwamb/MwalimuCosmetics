@echo off
REM Mwalimu Cosmetics - print whatever the restock job left for us.
REM
REM This machine has the Epson on USB and therefore has its driver. The PC that
REM works out the restock sheet has node, the database and the internet, but no
REM Epson driver - and connecting it to the shared printer makes Windows try to
REM fetch one over point-and-print, which hangs a scheduled task outright: there
REM is nobody logged in to answer the prompt.
REM
REM So it drops the PDF in here and this prints it, locally, where the driver
REM already is. Printed files are moved aside rather than deleted, so a morning
REM argument about whether a sheet came out can be settled.
REM
REM SumatraPDF is not in git - it is a 16MB binary. Portable build from
REM https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip
REM unzipped and renamed to SumatraPDF.exe. It is the only thing on Windows
REM that will print a PDF to a named printer with nobody logged in.
REM
REM Installed with:
REM   schtasks /Create /TN MwalimuRestockPrint /SC DAILY /ST 19:10
setlocal
set DROP=C:\Mwalimu\restock-in
set DONE=%DROP%\printed
set LOG=%DROP%\print.log
set SUMATRA=C:\Mwalimu\tools\SumatraPDF.exe
set PRINTER=EPSON L3250 Series

if not exist "%DONE%" mkdir "%DONE%"
echo ==== %date% %time% ==== >> "%LOG%"

if not exist "%SUMATRA%" (
  echo   no SumatraPDF at %SUMATRA% >> "%LOG%"
  exit /b 1
)

set FOUND=0
for %%f in ("%DROP%\*.pdf") do (
  set FOUND=1
  echo   printing %%~nxf >> "%LOG%"
  "%SUMATRA%" -print-to "%PRINTER%" -silent "%%f" >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo   FAILED, leaving it in place for tomorrow >> "%LOG%"
  ) else (
    move /y "%%f" "%DONE%\" >nul
    echo   printed and filed >> "%LOG%"
  )
)
if "%FOUND%"=="0" echo   nothing waiting >> "%LOG%"
endlocal
