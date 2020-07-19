@ECHO OFF

::----------------------------------------------------------------------
:: openBEXI_timeline Web serve startup script example.
::----------------------------------------------------------------------

:: ---------------------------------------------------------------------
:: Locate a JDK installation directory which will be used to run topenBEXI_timeline.
:: Try (in order):  ..\jre, JDK_HOME, JAVA_HOME.
:: ---------------------------------------------------------------------
SET JDK=
SET BITS=

:: Set your environment variables here if needed
SET JDK_HOME=
SET OPENBEXI_TIMELINE_HOME=

IF EXIST "%JDK_HOME%" SET JDK=%JDK_HOME%
IF EXIST "%JDK%" GOTO check

IF EXIST "%JAVA_HOME%" SET JDK=%JAVA_HOME%

:check
SET JAVA_EXE=%JDK%\bin\java.exe
IF NOT EXIST "%JAVA_EXE%" SET JAVA_EXE=%JDK%\jre\bin\java.exe
IF NOT EXIST "%JAVA_EXE%" (
  ECHO ERROR: cannot start openBEXI_timeline.
  ECHO No JDK found. Please validate either JDK_HOME or JAVA_HOME points to valid JDK installation.
  EXIT /B
)

SET JRE=%JDK%
IF EXIST "%JRE%\jre" SET JRE=%JDK%\jre
IF EXIST "%JRE%\lib\amd64" (
  SET BITS=64
) ELSE (
  IF EXIST "%JRE%\bin\windowsaccessbridge-64.dll" SET BITS=64
)


SET CLASS_PATH=%OPENBEXI_TIMELINE_HOME%\lib\openBEXI_timeline.jar
echo %CLASS_PATH%


:: ---------------------------------------------------------------------
:: Run openBEXI_timeline.
:: ---------------------------------------------------------------------

"%JAVA_EXE%" -cp "%CLASS_PATH%" com.openbexi.timeline.server.openBEXI_timeline -data_path ""

::pause