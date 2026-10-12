#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{49E61C05-64B4-4D69-8BF3-FD19F8D49682}
AppName=OpenBEXI Timeline
AppVersion={#AppVersion}
AppPublisher=OpenBEXI
AppPublisherURL=https://github.com/arcazj/openbexi_timeline
DefaultDirName={localappdata}\Programs\OpenBEXI Timeline
DefaultGroupName=OpenBEXI Timeline
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=openbexi-timeline-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile={#PayloadDir}\app\LICENSE
UninstallDisplayIcon={app}\app\favicon.ico
CloseApplications=yes

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\OpenBEXI Timeline"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Start-OpenBEXI.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\app\favicon.ico"
Name: "{group}\Release notes"; Filename: "{app}\app\docs\release-{#AppVersion}.md"
Name: "{group}\Uninstall OpenBEXI Timeline"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Start-OpenBEXI.ps1"""; Description: "Open OpenBEXI Timeline"; Flags: nowait postinstall skipifsilent
