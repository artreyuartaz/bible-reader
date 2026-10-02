@echo off
cd /d "%~dp0"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden"
timeout /t 2 /nobreak >nul
start "" http://localhost:3000
exit
