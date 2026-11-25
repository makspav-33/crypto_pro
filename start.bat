@echo off
setlocal
set "PROJECT_ROOT=%~dp0"
set "PYTHON=%PROJECT_ROOT%backend\.venv\Scripts\python.exe"
cd /d "%PROJECT_ROOT%"
if not exist "%PYTHON%" (
    echo Missing backend virtual environment. See README.md for installation.
    pause
    exit /b 1
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js / npm.cmd is not on PATH.
    pause
    exit /b 1
)
if not exist "%PROJECT_ROOT%frontend\node_modules\.bin\vite.cmd" (
    echo Missing frontend dependencies. Run npm.cmd install in frontend first.
    pause
    exit /b 1
)
"%PYTHON%" -c "import sys; sys.path.insert(0, 'backend'); from app.main import app; from app.config import validate_auth_settings; validate_auth_settings()"
if errorlevel 1 (
    echo Backend preflight failed. Check dependencies and the private root .env.
    pause
    exit /b 1
)
"%PYTHON%" -c "import socket; a=socket.socket(); a.bind(('127.0.0.1',8000)); b=socket.socket(); b.bind(('127.0.0.1',5173)); a.close(); b.close()"
if errorlevel 1 (
    echo Port 8000 or 5173 is already in use. Close the existing server before retrying.
    pause
    exit /b 1
)
start "DigitalVault Backend" /D "%PROJECT_ROOT%" cmd /k ""%PYTHON%" -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000"
start "DigitalVault Frontend" /D "%PROJECT_ROOT%frontend" cmd /k "npm.cmd run dev -- --host 127.0.0.1"
powershell.exe -NoProfile -Command "$ready=$false; for($i=0; $i -lt 30; $i++){ try { $api=Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 1; $ui=Invoke-WebRequest 'http://127.0.0.1:5173' -UseBasicParsing -TimeoutSec 1; if($api.status -eq 'ok' -and $ui.StatusCode -eq 200){ $ready=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if($ready){ Start-Process 'http://127.0.0.1:5173' } else { Write-Host 'Servers did not become ready. Check the backend and frontend terminals.'; exit 1 }"
if errorlevel 1 (
    pause
    exit /b 1
)
echo DigitalVault is running. Close each server terminal to stop it.
endlocal
