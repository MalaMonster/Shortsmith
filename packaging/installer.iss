; Inno Setup script — builds dist\Shortsmith-Setup-<version>.exe. Run via packaging\build.ps1
; (iscc /DAppVersion=1.2.3 packaging\installer.iss)
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6C2B7E4A-3F1D-4C55-9B7E-5D0F2A8C9E11}
AppName=Shortsmith
AppVersion={#AppVersion}
AppVerName=Shortsmith {#AppVersion}
AppPublisher=MalaMonster
AppPublisherURL=https://github.com/MalaMonster/Shortsmith
AppSupportURL=https://github.com/MalaMonster/Shortsmith/issues
AppUpdatesURL=https://github.com/MalaMonster/Shortsmith/releases
; per-user install: no admin prompt, and auto-updates can replace files silently
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Shortsmith
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir=..\dist
OutputBaseFilename=Shortsmith-Setup-{#AppVersion}
SetupIconFile=..\assets\shortsmith.ico
UninstallDisplayIcon={app}\Shortsmith.exe
UninstallDisplayName=Shortsmith
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force
RestartApplications=no
LicenseFile=..\LICENSE

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[InstallDelete]
; remove the previous version's bundled libraries so no stale files remain after an update
Type: filesandordirs; Name: "{app}\_internal"

[Files]
Source: "..\build\pyi\Shortsmith\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\build\ffmpeg\*"; DestDir: "{app}\ffmpeg"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Shortsmith"; Filename: "{app}\Shortsmith.exe"; Comment: "Turn gaming clips into YouTube Shorts"
Name: "{autodesktop}\Shortsmith"; Filename: "{app}\Shortsmith.exe"; Tasks: desktopicon

[Run]
; also runs after silent auto-updates (no skipifsilent), passing /LAUNCHARGS=--after-update through
Filename: "{app}\Shortsmith.exe"; Parameters: "{param:LAUNCHARGS|}"; Description: "Launch Shortsmith"; Flags: nowait postinstall

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\Shortsmith');
    if DirExists(DataDir) and not UninstallSilent then
      if MsgBox('Also delete your Shortsmith projects, settings and downloaded AI models?' + #13#10 + #13#10 +
                DataDir + #13#10 + #13#10 + 'Your videos and exported shorts are not affected.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
