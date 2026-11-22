@echo off
cd /d "%~dp0"
title Learn_everything - Stop

where node >nul 2>&1
if not errorlevel 1 goto :NODE_OK

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
if exist "D:\Program Files\nodejs\node.exe" set "PATH=D:\Program Files\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  pause
  exit /b 1
)

:NODE_OK
node scripts\service-manager.mjs stop %*
if errorlevel 1 (
  echo [ERROR] Failed to stop background service cleanly.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
exit /b 0
