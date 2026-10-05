@echo off
cd /d "%~dp0"
if defined FREECAD_PYTHON (
  "%FREECAD_PYTHON%" launch.py %*
  exit /b %errorlevel%
)
where micromamba >nul 2>nul
if %errorlevel% equ 0 (
  micromamba run -n solidbench python launch.py %*
) else (
  python launch.py %*
)
if errorlevel 1 pause
