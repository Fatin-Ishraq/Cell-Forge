; Forma Wallpaper installer
; Compile with Inno Setup 6:
;   iscc desktop\forma-wallpaper\installer\FormaWallpaper.iss

#define MyAppName "Forma Wallpaper"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Forma"
#define MyAppExeName "forma-wallpaper.exe"
#define MyAppId "{{F0E9A9D7-4B08-4A70-9C0E-2BE10B4B6C11}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\FormaWallpaper
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=FormaWallpaper-Setup-{#MyAppVersion}
OutputDir=..\..\..\dist\installer
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=..\assets\icons\forma-app.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ChangesAssociations=no
CloseApplications=force
CloseApplicationsFilter={#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "..\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\..\www\*"; DestDir: "{app}\www"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent unchecked

[UninstallDelete]
; Keep user data in %APPDATA%\Forma by design.
Type: filesandordirs; Name: "{app}\www"
