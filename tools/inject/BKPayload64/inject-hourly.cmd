@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PROCESS_NAME=BidKing"
set "INTERVAL_SECONDS=3600"

if not "%~1"=="" set "PROCESS_NAME=%~1"
if not "%~2"=="" set "INTERVAL_SECONDS=%~2"

set "INJECT_PS1=%SCRIPT_DIR%inject.ps1"
set "PAYLOAD_DLL=%SCRIPT_DIR%BKPayload64.dll"

echo [inject-hourly] process=%PROCESS_NAME% interval=%INTERVAL_SECONDS%s
echo [inject-hourly] script=%INJECT_PS1%
echo [inject-hourly] dll=%PAYLOAD_DLL%

:loop
echo.
echo [inject-hourly] %date% %time% starting injection
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INJECT_PS1%" -ProcessName "%PROCESS_NAME%" -DllPath "%PAYLOAD_DLL%"
echo [inject-hourly] %date% %time% injection exited with code %ERRORLEVEL%
echo [inject-hourly] waiting %INTERVAL_SECONDS% seconds
timeout /t %INTERVAL_SECONDS% /nobreak >nul
goto loop
