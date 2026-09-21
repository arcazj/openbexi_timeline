@echo off
setlocal EnableExtensions DisableDelayedExpansion
rem Build first: mvn --batch-mode --no-transfer-progress verify
if defined OPENBEXI_TIMELINE_HOME (
  set "OB_LAUNCH_ROOT=%OPENBEXI_TIMELINE_HOME%"
) else (
  set "OB_LAUNCH_ROOT=%~dp0"
)
for %%I in ("%OB_LAUNCH_ROOT%") do set "OB_LAUNCH_ROOT=%%~fI"
set "OB_LAUNCH_JAVA=java.exe"
if defined JAVA_HOME set "OB_LAUNCH_JAVA=%JAVA_HOME%\bin\java.exe"
if defined JDK_HOME set "OB_LAUNCH_JAVA=%JDK_HOME%\bin\java.exe"
if not "%OB_LAUNCH_JAVA%"=="java.exe" if not exist "%OB_LAUNCH_JAVA%" (
  echo Java not found. Set JAVA_HOME or JDK_HOME to a patched JDK 17 or newer.
  exit /b 1
)
if not exist "%OB_LAUNCH_ROOT%\target\classes\com\openbexi\timeline\server\openbexi_timeline.class" goto missingBuild
if not exist "%OB_LAUNCH_ROOT%\target\runtime\*.jar" goto missingBuild
set "OB_LAUNCH_CONFIG="
if not "%~1"=="" goto explicitConfig
set "OB_LAUNCH_CONFIG=%OB_LAUNCH_ROOT%\yaml\sources_startup.yml"
if defined OPENBEXI_TIMELINE_DATA_PATH set "OB_LAUNCH_CONFIG=%OPENBEXI_TIMELINE_DATA_PATH%"
if defined OPENBEXI_TIMELINE_CONFIG set "OB_LAUNCH_CONFIG=%OPENBEXI_TIMELINE_CONFIG%"
goto resolveConfig
:explicitConfig
if not "%~3"=="" goto run
if "%~1"=="-data_conf" set "OB_LAUNCH_CONFIG=%~2"
if "%~1"=="-data_path" set "OB_LAUNCH_CONFIG=%~2"
if not defined OB_LAUNCH_CONFIG goto run
:resolveConfig
for %%I in ("%OB_LAUNCH_CONFIG%") do set "OB_LAUNCH_CONFIG=%%~fI"
:run
pushd "%OB_LAUNCH_ROOT%" || exit /b 1
if not exist tomcat mkdir tomcat
if not defined OB_LAUNCH_CONFIG goto forwardArguments
"%OB_LAUNCH_JAVA%" -cp "%OB_LAUNCH_ROOT%\target\classes;%OB_LAUNCH_ROOT%\target\runtime\*" com.openbexi.timeline.server.openbexi_timeline -data_conf "%OB_LAUNCH_CONFIG%"
goto finished
:forwardArguments
"%OB_LAUNCH_JAVA%" -cp "%OB_LAUNCH_ROOT%\target\classes;%OB_LAUNCH_ROOT%\target\runtime\*" com.openbexi.timeline.server.openbexi_timeline %*
:finished
set "OB_LAUNCH_RESULT=%ERRORLEVEL%"
popd
exit /b %OB_LAUNCH_RESULT%
:missingBuild
echo Build the application first: mvn --batch-mode --no-transfer-progress verify
exit /b 1
