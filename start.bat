@echo off
cd /d "%~dp0"
title Learn_everything

echo ========================================================
echo   Learn_everything
echo   Unified Windowless Background Service Launcher
echo ========================================================
echo.

:: 1. Check Node.js runtime environment
where node >nul 2>&1
if not errorlevel 1 goto :NODE_OK

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"
if exist "D:\Program Files\nodejs\node.exe" set "PATH=D:\Program Files\nodejs;%PATH%"

where node >nul 2>&1
if errorlevel 1 goto :ERR_NODE

:NODE_OK
:: 2. Check and install Node dependencies if needed
if not exist "node_modules" goto :DO_INSTALL
if not exist "node_modules\express" goto :DO_INSTALL
if not exist "node_modules\pdf-lib" goto :DO_INSTALL
if not exist "node_modules\katex" goto :DO_INSTALL
if not exist "node_modules\pdfjs-dist" goto :DO_INSTALL
goto :START_BG

:DO_INSTALL
echo [1/2] Installing Node.js dependencies, please wait...
call npm install --legacy-peer-deps
if errorlevel 1 call npm install --force
if errorlevel 1 goto :ERR_INSTALL

:START_BG
echo [2/2] Starting unified windowless background service (Node + Python)...
echo       (Tip: Double-click Learn_everything.vbs to launch directly with zero terminal flash.)
node scripts\service-manager.mjs start %*
if errorlevel 1 goto :ERR_SERVER

echo.
echo Background service is running. Log: data\logs\server.log
echo Use stop.bat to stop both Node and Python background services.
timeout /t 2 /nobreak >nul
exit /b 0

:ERR_NODE
echo.
echo ========================================================
echo [ERROR] Node.js is not found on your system.
echo Please install Node.js (LTS version) from:
echo https://nodejs.org
echo ========================================================
echo.
pause
exit /b 1

:ERR_INSTALL
echo.
echo ========================================================
echo [ERROR] Failed to install dependencies via npm.
echo Please check your network connection and retry.
echo ========================================================
echo.
pause
exit /b 1

:ERR_SERVER
echo.
echo ========================================================
echo [ERROR] Failed to start Learn_everything background service.
echo Check data\logs\server.log or data\logs\build.log.
echo ========================================================
echo.
pause
exit /b 1
