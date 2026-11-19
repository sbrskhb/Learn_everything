@echo off
cd /d "%~dp0"
title Learn_everything

echo ========================================================
echo   Learn_everything
echo   Local Web Learning App (Node + Python .venv Backend)
echo   Web UI:         http://localhost:3000
echo   Python Backend: http://127.0.0.1:3001
echo ========================================================
echo.

:: 1. Check Node.js runtime environment
where node >nul 2>&1
if not errorlevel 1 goto :NODE_OK

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "PATH=%LOCALAPPDATA%\Programs\node;%PATH%"

where node >nul 2>&1
if errorlevel 1 goto :ERR_NODE

:NODE_OK
:: 2. Check Python 3 runtime environment
set "PYTHON_CMD="
where python >nul 2>&1
if not errorlevel 1 (
    python -c "import sys; assert sys.version_info >= (3, 8)" >nul 2>&1
    if not errorlevel 1 set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3 -c "import sys; assert sys.version_info >= (3, 8)" >nul 2>&1
        if not errorlevel 1 set "PYTHON_CMD=py -3"
    )
)
if not defined PYTHON_CMD (
    for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*") do (
        if exist "%%~D\python.exe" set "PYTHON_CMD="%%~D\python.exe""
    )
)
if not defined PYTHON_CMD goto :ERR_PYTHON

:: 3. Check and install Node dependencies if needed
if not exist "node_modules" goto :DO_INSTALL
if not exist "node_modules\express" goto :DO_INSTALL
if not exist "node_modules\pdf-lib" goto :DO_INSTALL
if not exist "node_modules\katex" goto :DO_INSTALL
if not exist "node_modules\pdfjs-dist" goto :DO_INSTALL
goto :SETUP_VENV

:DO_INSTALL
echo [1/4] Installing Node.js dependencies, please wait...
call npm install --legacy-peer-deps
if errorlevel 1 call npm install --force
if errorlevel 1 goto :ERR_INSTALL

:SETUP_VENV
echo [2/4] Setting up Python virtual environment (.venv)...
set "VENV_DIR=%CD%\.venv"
set "VENV_PYTHON=%VENV_DIR%\Scripts\python.exe"

if exist "%VENV_PYTHON%" goto :VENV_READY

echo       Creating isolated virtual environment in .venv ...
%PYTHON_CMD% -m venv "%VENV_DIR%" >nul 2>&1
if exist "%VENV_PYTHON%" goto :VENV_READY

:: Fallback if ensurepip is unavailable on minimal Python installs
if exist "%VENV_DIR%" rmdir /s /q "%VENV_DIR%" >nul 2>&1
%PYTHON_CMD% -m venv --without-pip "%VENV_DIR%" >nul 2>&1
if exist "%VENV_PYTHON%" goto :VENV_READY

echo [WARN] Could not create .venv; falling back to system Python.
set "USE_VENV=0"
goto :START_PYTHON

:VENV_READY
set "USE_VENV=1"
set "VIRTUAL_ENV=%VENV_DIR%"
set "PATH=%VENV_DIR%\Scripts;%PATH%"
echo       Using Python virtual environment: %VENV_PYTHON%

:: Install pip packages only if backend\requirements.txt contains non-comment entries
if exist "backend\requirements.txt" (
    powershell -NoProfile -Command "$lines = Get-Content 'backend\requirements.txt' | Where-Object { $_.Trim() -ne '' -and -not $_.Trim().StartsWith('#') }; if ($lines.Count -gt 0) { exit 0 } else { exit 1 }" >nul 2>&1
    if not errorlevel 1 (
        echo       Installing Python packages from backend\requirements.txt...
        "%VENV_PYTHON%" -m pip install -r backend\requirements.txt
    )
)

:START_PYTHON
echo [3/4] Starting Python backend service (http://127.0.0.1:3001)...
set "PYTHON_BACKEND_PORT=3001"
set "PYTHON_BACKEND_URL=http://127.0.0.1:3001"
set "PYTHONIOENCODING=utf-8"

:: Reuse existing healthy Python backend if already running, otherwise launch minimized window
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/py/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo       Python backend already running on http://127.0.0.1:3001
    goto :DO_START
)

if "%USE_VENV%"=="1" (
    start "Learn_everything Python Backend (.venv)" /min "%VENV_PYTHON%" backend\server.py
) else (
    start "Learn_everything Python Backend" /min cmd /c %PYTHON_CMD% backend\server.py
)

:: Wait briefly until Python backend responds
powershell -NoProfile -Command "for ($i=0; $i -lt 20; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/api/py/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1" >nul 2>&1
if errorlevel 1 (
    echo [WARN] Python backend slow to respond; main server will monitor/retry startup.
) else (
    echo       Python backend ready: http://127.0.0.1:3001
)

:DO_START
echo       Building optimized web assets...
call npm run build
if errorlevel 1 goto :ERR_SERVER

echo [4/4] Starting Web and API server (http://localhost:3000)...
echo.

:: Open default browser after 2 seconds delay
start "" /min cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:3000"

:: Serve the built site, including when browsing from a phone.
set "NODE_ENV=production"
call npx --no-install tsx server.ts
if errorlevel 1 goto :ERR_SERVER
goto :EXIT

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

:ERR_PYTHON
echo.
echo ========================================================
echo [ERROR] Python 3.8+ is not found on your system.
echo Please install Python 3 from:
echo https://www.python.org/downloads/
echo (Check "Add Python to PATH" during installation)
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
echo [INFO] Local server stopped.
echo ========================================================
echo.
pause
exit /b 0

:EXIT
pause
