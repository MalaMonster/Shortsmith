@echo off
rem Runs Shortsmith WITH a console window showing the server log (handy for troubleshooting).
rem For everyday use, open the "Shortsmith" shortcut instead - it starts without a console.
cd /d "%~dp0"
title Shortsmith
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=%LOCALAPPDATA%\Shortsmith\venv\Scripts\python.exe"
if not exist "%PY%" (
  echo Shortsmith is not set up yet - running setup first...
  call setup.bat || exit /b 1
  set "PY=%~dp0.venv\Scripts\python.exe"
  if not exist "%~dp0.venv\Scripts\python.exe" set "PY=%LOCALAPPDATA%\Shortsmith\venv\Scripts\python.exe"
)
if not exist "frontend\dist\index.html" (
  echo The interface has not been built - run setup.bat.
  pause & exit /b 1
)
"%PY%" backend\run.py --console %*
if errorlevel 1 pause
