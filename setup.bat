@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Shortsmith setup
echo.
echo  ==== Shortsmith setup ====
echo.

rem ---- Python ------------------------------------------------------------
set "PYBOOT="
where py >nul 2>nul && set "PYBOOT=py -3"
if not defined PYBOOT where python >nul 2>nul && set "PYBOOT=python"
if not defined PYBOOT (
  echo  Python 3.10+ is required.  Install it with:  winget install Python.Python.3.13
  pause & exit /b 1
)
rem The Python environment goes in .venv inside this folder. If this folder's path is very long it goes in
rem %LOCALAPPDATA%\Shortsmith\venv instead (some packages fail to load from deep paths on Windows).
set "ROOT=%~dp0"
set "VENV=%ROOT%.venv"
if not exist "%VENV%\Scripts\python.exe" if not "%ROOT:~80,1%"=="" set "VENV=%LOCALAPPDATA%\Shortsmith\venv"
set "PY=%VENV%\Scripts\python.exe"
if not exist "%PY%" (
  echo  Creating Python environment in %VENV% ...
  %PYBOOT% -m venv "%VENV%" || goto :fail
)
"%PY%" -m pip install --upgrade pip --quiet
echo  Installing Python packages (FastAPI, faster-whisper, sherpa-onnx) ...
"%PY%" -m pip install -r backend\requirements.txt || goto :fail
where nvidia-smi >nul 2>nul && (
  echo  NVIDIA GPU found - installing CUDA runtime for fast local transcription ...
  "%PY%" -m pip install -r backend\requirements-gpu.txt
)

rem ---- FFmpeg ------------------------------------------------------------
set "HAVEFF="
where ffmpeg >nul 2>nul && set "HAVEFF=1"
if exist "%~dp0bin\ffmpeg.exe" set "HAVEFF=1"
for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*") do set "HAVEFF=1"
if not defined HAVEFF (
  echo  Installing FFmpeg with winget ...
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements || (
    echo  Could not install FFmpeg automatically. Install it from https://www.gyan.dev/ffmpeg/builds/
    echo  and put ffmpeg.exe + ffprobe.exe in the "bin" folder next to this script.
  )
)

rem ---- Frontend ----------------------------------------------------------
where npm >nul 2>nul || (
  echo  Node.js 18+ is required to build the interface.  Install it with:  winget install OpenJS.NodeJS.LTS
  pause & exit /b 1
)
pushd frontend
echo  Building the interface ...
call npm install --no-audit --no-fund || (popd & goto :fail)
call npm run build || (popd & goto :fail)
popd

rem ---- Shortcuts (start Shortsmith without a console window) --------------
echo  Creating Shortsmith shortcuts ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\create_shortcuts.ps1" -Pythonw "%VENV%\Scripts\pythonw.exe"

echo.
echo  Setup complete.  Open Shortsmith from the shortcut on your Desktop or Start menu,
echo  or "Shortsmith" in this folder.  (start.bat runs it with a console for troubleshooting.)
echo.
pause
exit /b 0

:fail
echo.
echo  Setup failed - see the messages above.
pause
exit /b 1
