@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.15 or newer.
  pause
  exit /b 1
)
start "Qingming" http://127.0.0.1:4193/
node server.mjs
pause
