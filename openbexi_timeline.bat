@echo off
setlocal EnableExtensions DisableDelayedExpansion
if defined OPENBEXI_TIMELINE_HOME (
  set "OB_LAUNCH_ROOT=%OPENBEXI_TIMELINE_HOME%"
) else (
  set "OB_LAUNCH_ROOT=%~dp0"
)
for %%I in ("%OB_LAUNCH_ROOT%") do set "OB_LAUNCH_ROOT=%%~fI"
set "OB_LAUNCH_PYTHON=python.exe"
if exist "%OB_LAUNCH_ROOT%\.venv\Scripts\python.exe" set "OB_LAUNCH_PYTHON=%OB_LAUNCH_ROOT%\.venv\Scripts\python.exe"
if defined OPENBEXI_PYTHON set "OB_LAUNCH_PYTHON=%OPENBEXI_PYTHON%"
"%OB_LAUNCH_PYTHON%" "%OB_LAUNCH_ROOT%\tools\launch-timeline.py" %*
exit /b %ERRORLEVEL%
