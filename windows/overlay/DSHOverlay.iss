#ifndef StageDir
  #error StageDir is required; use build.ps1
#endif
#ifndef OutputDir
  #error OutputDir is required; use build.ps1
#endif
#ifndef OverlayVersion
  #define OverlayVersion "0.1.0"
#endif

[Setup]
AppId={{6E4AA8A1-93AD-47D7-AD79-75FA9A01DCBE}
AppName=DSH Overlay
AppVersion={#OverlayVersion}
AppPublisher=DSH Overlay contributors
DefaultDirName={localappdata}\Programs\DSH-Overlay
DefaultGroupName=DSH Overlay
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=DSH-Overlay-Setup-{#OverlayVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=DSH Overlay (base DSH and data retained)
UninstallDisplayIcon={app}\payload\dsh-hub.exe
CloseApplications=no
RestartApplications=no
UsePreviousAppDir=yes
SetupLogging=yes
MinVersion=10.0

[Files]
Source: "{#StageDir}\Overlay.psm1"; Flags: dontcopy
Source: "{#StageDir}\prepare.ps1"; Flags: dontcopy
Source: "{#StageDir}\Overlay.psm1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\launch.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\plan.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\resolver.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\README.zh.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\INTEGRATION.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\TESTING.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageDir}\payload-manifest.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{code:BindingSource}"; DestDir: "{app}"; DestName: "overlay-binding.json"; Flags: external ignoreversion
Source: "{#StageDir}\payload\*"; DestDir: "{app}\payload"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DSH enhanced Desktop (Overlay)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch.ps1"" -Target DESKTOP"; WorkingDir: "{app}"; IconFilename: "{app}\payload\dsh.exe"; AppUserModelID: "DSH.Overlay.Desktop"
Name: "{group}\HUB (Overlay)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch.ps1"" -Target HUB"; WorkingDir: "{app}"; IconFilename: "{app}\payload\dsh-hub.exe"; AppUserModelID: "DSH.Overlay.Hub"
Name: "{group}\CONFIG (Overlay)"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch.ps1"" -Target CONFIG"; WorkingDir: "{app}"; IconFilename: "{app}\payload\dsh-config.exe"; AppUserModelID: "DSH.Overlay.Config"

[Code]
var
  PathsPage: TInputDirWizardPage;
  NodePage: TInputFileWizardPage;
  BindingDirectory: String;
  ValidationSequence: Integer;

function BindingSource(Param: String): String;
begin
  Result := BindingDirectory + '\overlay-binding.json';
end;

procedure InitializeWizard;
begin
  PathsPage := CreateInputDirPage(wpSelectDir, 'Select existing DSH and separate Overlay state',
    'No base files, profiles or sessions are installed, replaced or migrated.',
    'Select paths explicitly. Host and Runtime may differ. The home must already exist. ' +
    'Overlay state must be separate from the host, Runtime, home and install directory.', False, '');
  PathsPage.Add('Existing DSH host directory:');
  PathsPage.Add('Existing compiled CLI Runtime or repository:');
  PathsPage.Add('Existing DSH home (no migration):');
  PathsPage.Add('Overlay-only state (retained on uninstall):');
  PathsPage.Values[0] := ExpandConstant('{param:HOST|}');
  PathsPage.Values[1] := ExpandConstant('{param:RUNTIME|}');
  PathsPage.Values[2] := ExpandConstant('{param:DSHHOME|}');
  PathsPage.Values[3] := ExpandConstant('{param:STATE|{localappdata}\DSH-Overlay-State}');
  NodePage := CreateInputFilePage(PathsPage.ID, 'Select existing Node.js',
    'Read-only inspection; no download or execution of the selected Node.js.',
    'Select node.exe for the chosen Runtime. Node 22.19+ (22.x) or 24+ is required. ' +
    'This Overlay supports the alpha.2 CLI layout, not arbitrary Electron or ASAR profiles.');
  NodePage.Add('Existing node.exe:', 'Node.js|node.exe', '.exe');
  NodePage.Values[0] := ExpandConstant('{param:NODE|}');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := 'DSH Overlay - independent add-on, not Full or Lite' + NewLine + NewLine +
    MemoDirInfo + NewLine +
    'Host: ' + PathsPage.Values[0] + NewLine +
    'Runtime: ' + PathsPage.Values[1] + NewLine +
    'DSH home: ' + PathsPage.Values[2] + NewLine +
    'Overlay state: ' + PathsPage.Values[3] + NewLine +
    'Node: ' + NodePage.Values[0] + NewLine + NewLine +
    'Installs enhanced Desktop/HUB/CONFIG copies and supporting files, independent shortcuts and normal ' +
    'per-user uninstall registration. No PATH changes, runtime replacement or profile edits.' + NewLine +
    'Update/repair must retain all selected paths. Uninstall retains all state and DSH data.' + NewLine +
    'Static layout inspection is not session/plugin compatibility qualification. ' +
    'Close Overlay HUB/CONFIG before repair; Setup never kills the base DSH.';
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  RequestPath, Helper, Arguments: String;
  ExitCode: Integer;
  ErrorText: AnsiString;
begin
  Result := '';
  ExtractTemporaryFile('Overlay.psm1');
  ExtractTemporaryFile('prepare.ps1');
  ValidationSequence := ValidationSequence + 1;
  BindingDirectory := ExpandConstant('{tmp}') + '\validation-' + IntToStr(ValidationSequence);
  if not ForceDirectories(BindingDirectory) then begin
    Result := 'Cannot create private validation staging.';
    Exit;
  end;
  RequestPath := BindingDirectory + '\request.ini';
  if not SaveStringToFile(RequestPath, #$FF + #$FE, False) then begin
    Result := 'Cannot create Unicode validation request.';
    Exit;
  end;
  SetIniString('Overlay', 'HostRoot', PathsPage.Values[0], RequestPath);
  SetIniString('Overlay', 'RuntimeRoot', PathsPage.Values[1], RequestPath);
  SetIniString('Overlay', 'DshHome', PathsPage.Values[2], RequestPath);
  SetIniString('Overlay', 'StateRoot', PathsPage.Values[3], RequestPath);
  SetIniString('Overlay', 'NodePath', NodePage.Values[0], RequestPath);
  SetIniString('Overlay', 'InstallRoot', ExpandConstant('{app}'), RequestPath);
  SetIniString('Overlay', 'Version', '{#OverlayVersion}', RequestPath);
  Helper := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Arguments := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{tmp}\prepare.ps1') +
    '" -Request "' + RequestPath + '" -OutputDirectory "' + BindingDirectory + '"';
  if not Exec(Helper, Arguments, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Could not run read-only Overlay validation.'
  else if ExitCode <> 0 then begin
    if LoadStringFromFile(BindingDirectory + '\error.txt', ErrorText) then Result := String(ErrorText)
    else Result := 'Overlay validation failed. No base application files were changed.';
  end;
end;
