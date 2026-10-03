@echo off
rem Launch the Bible Reader desktop app (no web server needed). First run: npm install
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Installing dependencies...
  call npm install || pause
)
start "" /b node_modules\electron\dist\electron.exe .
