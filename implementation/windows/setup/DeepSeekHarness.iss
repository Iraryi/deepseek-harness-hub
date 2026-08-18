#ifndef AppVersion
  #define AppVersion "0.1.0-rc.6"
#endif
#ifndef AppNumericVersion
  #define AppNumericVersion "0.1.0.5"
#endif
#ifndef LauncherDir
  #define LauncherDir "..\launcher\dist"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef RuntimeArchive
  #define RuntimeArchive "..\runtime\dist\DeepSeek-Harness-Runtime-win-x64.zip"
#endif
#ifndef RuntimeAssetName
  #define RuntimeAssetName "DeepSeek-Harness-Runtime-" + AppVersion + "-win-x64.zip"
#endif
#ifndef RuntimeSha256
  #define RuntimeSha256 ""
#endif
#ifndef RuntimeArchiveBytes
  #define RuntimeArchiveBytes "0"
#endif
#ifndef RuntimeInstalledBytes
  #define RuntimeInstalledBytes "0"
#endif
#ifndef ReleaseBaseUrl
  #define ReleaseBaseUrl "https://github.com/Iraryi/deepseek-harness-hub/releases"
#endif
#ifndef WebViewOffline
  #define WebViewOffline "cache\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
#endif
#ifndef WebViewBootstrapper
  #define WebViewBootstrapper "cache\MicrosoftEdgeWebview2Setup.exe"
#endif
#ifndef WebViewOfflineBytes
  #define WebViewOfflineBytes "0"
#endif
#ifndef WebViewBootstrapperBytes
  #define WebViewBootstrapperBytes "0"
#endif
#ifndef RepositoryRoot
  #define RepositoryRoot "..\.."
#endif

#if Flavor == "full"
  #define FlavorTitle "Full"
  #define FlavorDefaultMode "bundled"
#else
  #define FlavorTitle "Lite"
  #define FlavorDefaultMode "download"
#endif

#define RuntimeDownloadUrl ReleaseBaseUrl + "/download/v" + AppVersion + "/" + RuntimeAssetName

[Setup]
AppId={{C6E80677-0378-4C12-99F5-C69665A59B6E}
AppName=DeepSeek Harness
AppVersion={#AppVersion}
AppVerName=DeepSeek Harness Desktop {#AppVersion}
AppPublisher=DeepSeek Harness Desktop contributors
AppPublisherURL=https://github.com/Iraryi/deepseek-harness-hub
AppSupportURL=https://github.com/Iraryi/deepseek-harness-hub/issues
AppUpdatesURL=https://github.com/Iraryi/deepseek-harness-hub/releases
VersionInfoVersion={#AppNumericVersion}
VersionInfoProductVersion={#AppNumericVersion}
VersionInfoCompany=DeepSeek AI
VersionInfoDescription=DeepSeek Harness {#FlavorTitle} Setup
VersionInfoProductName=DeepSeek Harness Desktop
DefaultDirName={localappdata}\Programs\DeepSeek Harness
DefaultGroupName=DeepSeek Harness
DisableProgramGroupPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
WizardStyle=modern light excludelightcontrols
WizardSizePercent=120
ExtraDiskSpaceRequired={#RuntimeInstalledBytes}
Compression=lzma2/normal
SolidCompression=yes
SetupIconFile={#RepositoryRoot}\windows\launcher\assets\dsh.ico
UninstallDisplayIcon={app}\dsh.exe
LicenseFile={#RepositoryRoot}\LICENSE
OutputDir={#OutputDir}
OutputBaseFilename=DeepSeek-Harness-Setup-{#FlavorTitle}-{#AppVersion}-win-x64
UsePreviousAppDir=yes
UsePreviousLanguage=yes
UsePreviousTasks=yes
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ChangesEnvironment=yes
ChangesAssociations=no
DisableWelcomePage=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

[CustomMessages]
english.DataModeTitle=Application data
english.DataModeDescription=Choose where settings, logs, and browser data are stored.
english.DataModePrompt=Standard mode stores data in %%LOCALAPPDATA%%. Portable data mode stores it beside the application and keeps it after uninstall.
english.DataModeStandard=Standard data mode (recommended)
english.DataModePortable=Portable data mode
english.RuntimeModeTitle=Runtime source
english.RuntimeModeDescription=Choose how Setup obtains the DeepSeek Harness runtime.
english.RuntimeModePrompt=Full Setup works offline by default. Lite Setup downloads the verified runtime by default. Local alternatives are always available.
english.RuntimeBundled=Use the runtime included in this Setup (offline, recommended)
english.RuntimeDownload=Download the verified runtime from GitHub (recommended)
english.RuntimeArchive=Import a local Runtime ZIP
english.RuntimeFolder=Copy an existing Runtime folder
english.RuntimeSource=Build from a GitHub source ZIP (advanced; requires Node.js and pnpm)
english.RuntimeArchiveTitle=Local Runtime ZIP
english.RuntimeArchiveDescription=Select a previously downloaded DeepSeek Harness Runtime ZIP.
english.RuntimeArchivePrompt=Runtime ZIP:
english.RuntimeFolderTitle=Existing Runtime folder
english.RuntimeFolderDescription=Select a folder containing runtime-manifest.json, tools\node\node.exe, and the packaged application.
english.RuntimeFolderPrompt=Runtime folder:
english.SourceArchiveTitle=Source ZIP build
english.SourceArchiveDescription=Select a DeepSeek Harness GitHub source ZIP. Setup will install dependencies and build it locally.
english.SourceArchivePrompt=Source ZIP:
english.MissingRuntimeArchive=Select an existing Runtime ZIP before continuing.
english.MissingRuntimeFolder=Select an existing Runtime folder before continuing.
english.MissingSourceArchive=Select an existing source ZIP before continuing.
english.DownloadTitle=Downloading DeepSeek Harness
english.DownloadDescription=Setup is downloading and verifying the Windows Runtime.
english.DownloadFailed=The Runtime download failed
english.PrepareTitle=Preparing DeepSeek Harness
english.PrepareStarting=Setup is checking the selected components.
english.PrepareStopping=Closing running DeepSeek Harness processes...
english.PrepareWebView=Installing the Microsoft Edge WebView2 Runtime...
english.PrepareRuntime=Verifying and installing the DeepSeek Harness Runtime...
english.PrepareConfig=Preparing the first-run configuration...
english.RuntimeInstallFailed=The selected Runtime could not be installed. Setup has preserved the previous Runtime when one existed.
english.ConfigSeedFailed=Setup could not prepare the first-run configuration.
english.WebViewInstallFailed=Microsoft Edge WebView2 Runtime could not be installed.
english.ProcessStopFailed=Setup could not close a running DeepSeek Harness process. Exit the application and try again.
english.ReadyDataMode=Data mode:
english.ReadyRuntimeMode=Runtime source:
english.ReadyDataStandard=Standard — %%LOCALAPPDATA%%\DeepSeekHarness
english.ReadyDataPortable=Portable — application directory\data (preserved on uninstall)
english.WebViewPresent=Microsoft Edge WebView2 Runtime is already installed.
english.WebViewMissing=Microsoft Edge WebView2 Runtime will be installed before first launch.
english.SetupTypeTitle=Choose an installation method
english.SetupTypeDescription=The recommended option is designed for computers with no development tools installed.
english.SetupTypePrompt=Most people should keep the first option and click Next. DeepSeek Harness brings its own private Node.js runtime and installs WebView2 automatically when needed.
english.SetupTypeRecommended=Recommended installation — install everything automatically
english.SetupTypeAdvanced=Advanced options — customize data placement or Runtime source
english.CheckTitle=Computer check
english.CheckDescription=Setup checks the locations and components needed for a reliable installation.
english.CheckStarting=Checking this computer...
english.CheckPassed=[PASS]
english.CheckAutomatic=[AUTO]
english.CheckAttention=[ACTION]
english.CheckWindows=This Windows version and processor architecture are supported.
english.CheckPrivateNode=Private Node.js is included. No system Node.js, pnpm, Git, or development environment is required.
english.CheckInstallWritable=The installation location is writable: %1
english.CheckInstallBlocked=Setup cannot write to the installation location: %1
english.CheckDataWritable=The application data location is writable: %1
english.CheckDataBlocked=Setup cannot write to the application data location: %1
english.CheckDiskPassed=Free space: %1. Setup may temporarily use up to %2.
english.CheckDiskBlocked=Free space: %1. Setup needs approximately %2 during installation.
english.CheckWebViewPresent=Microsoft Edge WebView2 is ready.
english.CheckWebViewBundled=WebView2 is not present. Setup includes the Microsoft offline installer and will install it automatically.
english.CheckWebViewOnline=WebView2 is not present. Setup will use the Microsoft online installer; an internet connection is required.
english.CheckRuntimeBundled=The complete DeepSeek Harness Runtime is included and will be verified before installation.
english.CheckRuntimeDownload=The application Runtime will be downloaded from GitHub and verified before installation.
english.CheckRuntimeLocal=The selected local Runtime source will be verified before replacing any existing Runtime.
english.CheckExisting=An existing installation was found. Setup will close its processes, upgrade program files, and preserve user data.
english.CheckFresh=No existing installation was found. Setup will perform a clean installation.
english.CheckReady=All checks passed. Click Next to review the installation, then click Install.
english.CheckBlocked=One or more checks need attention. Free disk space or choose another writable location, then click Retry checks.
english.CheckRetry=Retry checks
english.CheckRecommended=Use recommended settings
english.CheckShowDetails=Show technical details
english.CheckHideDetails=Hide technical details
english.CheckSystemTitle=System and environment
english.CheckSystemReady=Windows is compatible; private Node.js and other runtimes are included.
english.CheckSourceToolsReady=Node.js and pnpm were found for the selected source ZIP build.
english.CheckSourceToolsMissing=Source ZIP build requires Node.js 22.19+ and pnpm. Use recommended installation or install those tools.
english.CheckInstallTitle=Installation location
english.CheckInstallReady=The selected location is writable.
english.CheckInstallNeedsAction=Choose another writable program location.
english.CheckDataTitle=User data
english.CheckDataStandardReady=Settings and logs use the standard per-user directory.
english.CheckDataPortableReady=Settings and logs are stored beside the application.
english.CheckDataNeedsAction=Choose a writable data location.
english.CheckDiskTitle=Disk space
english.CheckDiskReady=%1 free; Setup may temporarily use about %2.
english.CheckDiskNeedsAction=Only %1 is free; approximately %2 is required.
english.CheckWebViewTitle=Embedded web interface
english.CheckWebViewReady=Microsoft Edge WebView2 is ready.
english.CheckWebViewWillInstall=WebView2 is missing and will be installed automatically.
english.CheckApplicationTitle=Application files
english.CheckApplicationBundled=The complete application is included and will be verified.
english.CheckApplicationDownload=The application will be downloaded and verified automatically.
english.CheckApplicationLocal=The selected local application source will be verified before installation.
english.CheckUpgradeSuffix= Existing program files will be upgraded and user data will be preserved.
english.CheckFreshSuffix= A clean installation will be created.
english.CheckBlockedMessage=Setup cannot continue until the computer check passes. Correct the item marked ACTION and retry.
english.ReadyRecommended=Installation method:
english.ReadyRecommendedValue=Recommended automatic installation
english.ReadyIncludes=Included components:
english.ReadyIncludesValue=Desktop application, private Node.js Runtime, and automatic WebView2 installation when needed
english.DownloadRetry=Check the network connection and click Install to retry. Advanced options can import a previously downloaded Runtime ZIP.
english.PrepareStep=Step %1 of %2 — %3
english.PrepareStopStep=Closing any running DeepSeek Harness processes
english.PrepareWebViewStep=Preparing Microsoft Edge WebView2
english.PrepareRuntimeStep=Verifying and installing the application Runtime; this can take several minutes
english.PrepareConfigStep=Preparing first-use settings
english.PrepareFinishStep=Completing the installation checks
english.PrepareRetry=No incomplete installation was accepted. Correct the problem and click Install to retry.
english.TechnicalLog=Technical log: %1
english.WelcomeTitle=Welcome to DeepSeek Harness
english.WelcomeText=This Setup is ready for a computer with no Node.js or development tools installed.%n%nKeep the recommended options and click Next. Setup will check the computer, install the complete application, add missing WebView2 components, and preserve existing user data during upgrades.
english.FinishedText=DeepSeek Harness is installed.%n%nThe first launch opens CONFIG so you can choose language, window size, fullscreen behavior, loading style, tray behavior, and extensions before entering the main application.
english.LaunchAfterInstall=Launch DeepSeek Harness (opens CONFIG on first use)

chinesesimp.DataModeTitle=应用数据
chinesesimp.DataModeDescription=选择设置、日志和浏览器数据的保存位置。
chinesesimp.DataModePrompt=标准模式把数据保存到 %%LOCALAPPDATA%%；便携数据模式把数据放在程序旁边，卸载时仍会保留。
chinesesimp.DataModeStandard=标准数据模式（推荐）
chinesesimp.DataModePortable=便携数据模式
chinesesimp.RuntimeModeTitle=运行时来源
chinesesimp.RuntimeModeDescription=选择安装程序如何取得 DeepSeek Harness Runtime。
chinesesimp.RuntimeModePrompt=Full 安装包默认完全离线；Lite 安装包默认从 GitHub 下载并校验。始终可以改用本地文件。
chinesesimp.RuntimeBundled=使用安装包内置 Runtime（离线，推荐）
chinesesimp.RuntimeDownload=从 GitHub 下载并校验 Runtime（推荐）
chinesesimp.RuntimeArchive=导入本地 Runtime ZIP
chinesesimp.RuntimeFolder=复制已有 Runtime 文件夹
chinesesimp.RuntimeSource=从 GitHub 源码 ZIP 本地构建（高级；需要 Node.js 与 pnpm）
chinesesimp.RuntimeArchiveTitle=本地 Runtime ZIP
chinesesimp.RuntimeArchiveDescription=选择以前下载的 DeepSeek Harness Runtime ZIP。
chinesesimp.RuntimeArchivePrompt=Runtime ZIP：
chinesesimp.RuntimeFolderTitle=已有 Runtime 文件夹
chinesesimp.RuntimeFolderDescription=选择包含 runtime-manifest.json、tools\node\node.exe 和打包程序的文件夹。
chinesesimp.RuntimeFolderPrompt=Runtime 文件夹：
chinesesimp.SourceArchiveTitle=源码 ZIP 构建
chinesesimp.SourceArchiveDescription=选择 DeepSeek Harness 的 GitHub 源码 ZIP，安装程序会在本机安装依赖并构建。
chinesesimp.SourceArchivePrompt=源码 ZIP：
chinesesimp.MissingRuntimeArchive=请先选择一个存在的 Runtime ZIP。
chinesesimp.MissingRuntimeFolder=请先选择一个存在的 Runtime 文件夹。
chinesesimp.MissingSourceArchive=请先选择一个存在的源码 ZIP。
chinesesimp.DownloadTitle=正在下载 DeepSeek Harness
chinesesimp.DownloadDescription=安装程序正在下载并校验 Windows Runtime。
chinesesimp.DownloadFailed=Runtime 下载失败
chinesesimp.PrepareTitle=正在准备 DeepSeek Harness
chinesesimp.PrepareStarting=安装程序正在检查所选组件。
chinesesimp.PrepareStopping=正在关闭运行中的 DeepSeek Harness 进程……
chinesesimp.PrepareWebView=正在安装 Microsoft Edge WebView2 Runtime……
chinesesimp.PrepareRuntime=正在校验并安装 DeepSeek Harness Runtime……
chinesesimp.PrepareConfig=正在准备首次运行配置……
chinesesimp.RuntimeInstallFailed=所选 Runtime 无法安装；如果此前已有 Runtime，安装程序已经将其保留。
chinesesimp.ConfigSeedFailed=安装程序无法准备首次运行配置。
chinesesimp.WebViewInstallFailed=无法安装 Microsoft Edge WebView2 Runtime。
chinesesimp.ProcessStopFailed=安装程序无法关闭正在运行的 DeepSeek Harness 进程。请完全退出应用后重试。
chinesesimp.ReadyDataMode=数据模式：
chinesesimp.ReadyRuntimeMode=Runtime 来源：
chinesesimp.ReadyDataStandard=标准 — %%LOCALAPPDATA%%\DeepSeekHarness
chinesesimp.ReadyDataPortable=便携 — 程序目录\data（卸载时保留）
chinesesimp.WebViewPresent=系统已经安装 Microsoft Edge WebView2 Runtime。
chinesesimp.WebViewMissing=首次启动前将安装 Microsoft Edge WebView2 Runtime。
chinesesimp.SetupTypeTitle=选择安装方式
chinesesimp.SetupTypeDescription=推荐安装专门面向没有安装任何开发工具的电脑。
chinesesimp.SetupTypePrompt=绝大多数用户保持第一项并点击“下一步”即可。DeepSeek Harness 自带私有 Node.js，并会在需要时自动安装 WebView2。
chinesesimp.SetupTypeRecommended=推荐安装——自动安装全部必需内容
chinesesimp.SetupTypeAdvanced=高级选项——自定义数据位置或 Runtime 来源
chinesesimp.CheckTitle=电脑检查
chinesesimp.CheckDescription=安装程序会检查可靠安装所需的位置和组件。
chinesesimp.CheckStarting=正在检查这台电脑……
chinesesimp.CheckPassed=[通过]
chinesesimp.CheckAutomatic=[自动处理]
chinesesimp.CheckAttention=[需要处理]
chinesesimp.CheckWindows=Windows 版本和处理器架构受支持。
chinesesimp.CheckPrivateNode=安装包自带私有 Node.js；无需安装系统 Node.js、pnpm、Git 或任何开发环境。
chinesesimp.CheckInstallWritable=程序安装位置可以写入：%1
chinesesimp.CheckInstallBlocked=安装程序无法写入程序安装位置：%1
chinesesimp.CheckDataWritable=应用数据位置可以写入：%1
chinesesimp.CheckDataBlocked=安装程序无法写入应用数据位置：%1
chinesesimp.CheckDiskPassed=可用空间：%1。安装期间最多可能临时使用约 %2。
chinesesimp.CheckDiskBlocked=可用空间：%1。安装期间大约需要 %2。
chinesesimp.CheckWebViewPresent=Microsoft Edge WebView2 已就绪。
chinesesimp.CheckWebViewBundled=系统尚无 WebView2；安装包已内置微软离线安装器，将会自动安装。
chinesesimp.CheckWebViewOnline=系统尚无 WebView2；安装程序将使用微软在线安装器，需要网络连接。
chinesesimp.CheckRuntimeBundled=完整的 DeepSeek Harness Runtime 已包含在安装包中，并会在安装前校验。
chinesesimp.CheckRuntimeDownload=应用 Runtime 将从 GitHub 下载，并在安装前校验。
chinesesimp.CheckRuntimeLocal=所选本地 Runtime 来源会先经过校验，再替换任何已有 Runtime。
chinesesimp.CheckExisting=检测到已有安装。安装程序会关闭相关进程、升级程序文件，并保留用户数据。
chinesesimp.CheckFresh=未检测到已有安装，将执行全新安装。
chinesesimp.CheckReady=全部检查通过。点击“下一步”确认安装内容，然后点击“安装”。
chinesesimp.CheckBlocked=有检查项需要处理。请释放磁盘空间或选择可写的位置，然后点击“重新检查”。
chinesesimp.CheckRetry=重新检查
chinesesimp.CheckRecommended=恢复推荐设置
chinesesimp.CheckShowDetails=显示技术细节
chinesesimp.CheckHideDetails=收起技术细节
chinesesimp.CheckSystemTitle=系统与运行环境
chinesesimp.CheckSystemReady=Windows 兼容；私有 Node.js 等运行环境已随安装包提供。
chinesesimp.CheckSourceToolsReady=已找到源码 ZIP 构建所需的 Node.js 和 pnpm。
chinesesimp.CheckSourceToolsMissing=源码 ZIP 构建需要 Node.js 22.19+ 和 pnpm；请恢复推荐安装，或先安装这些工具。
chinesesimp.CheckInstallTitle=程序安装位置
chinesesimp.CheckInstallReady=所选位置可写，可以安装。
chinesesimp.CheckInstallNeedsAction=请改用一个可以写入的程序位置。
chinesesimp.CheckDataTitle=用户数据
chinesesimp.CheckDataStandardReady=设置和日志保存在当前用户目录。
chinesesimp.CheckDataPortableReady=设置和日志保存在程序旁边。
chinesesimp.CheckDataNeedsAction=请选择一个可以写入的数据位置。
chinesesimp.CheckDiskTitle=磁盘空间
chinesesimp.CheckDiskReady=可用 %1；安装期间可能临时使用约 %2。
chinesesimp.CheckDiskNeedsAction=仅剩 %1；安装期间大约需要 %2。
chinesesimp.CheckWebViewTitle=内嵌网页界面
chinesesimp.CheckWebViewReady=Microsoft Edge WebView2 已就绪。
chinesesimp.CheckWebViewWillInstall=系统缺少 WebView2，安装程序会自动补齐。
chinesesimp.CheckApplicationTitle=应用本体
chinesesimp.CheckApplicationBundled=完整应用已包含在安装包中，并会自动校验。
chinesesimp.CheckApplicationDownload=应用本体会自动下载并校验。
chinesesimp.CheckApplicationLocal=所选本地应用来源会在安装前自动校验。
chinesesimp.CheckUpgradeSuffix= 检测到已有版本：将升级程序文件并保留用户数据。
chinesesimp.CheckFreshSuffix= 将执行全新安装。
chinesesimp.CheckBlockedMessage=电脑检查通过后才能继续。请处理标有“需要处理”的项目，再重新检查。
chinesesimp.ReadyRecommended=安装方式：
chinesesimp.ReadyRecommendedValue=推荐的全自动安装
chinesesimp.ReadyIncludes=包含内容：
chinesesimp.ReadyIncludesValue=桌面程序、私有 Node.js Runtime，以及缺失时自动安装 WebView2
chinesesimp.DownloadRetry=请检查网络连接后再次点击“安装”。也可以在高级选项中导入提前下载好的 Runtime ZIP。
chinesesimp.PrepareStep=第 %1/%2 步——%3
chinesesimp.PrepareStopStep=关闭正在运行的 DeepSeek Harness 相关进程
chinesesimp.PrepareWebViewStep=准备 Microsoft Edge WebView2
chinesesimp.PrepareRuntimeStep=校验并安装应用 Runtime；这一步可能需要几分钟
chinesesimp.PrepareConfigStep=准备首次使用设置
chinesesimp.PrepareFinishStep=完成安装检查
chinesesimp.PrepareRetry=安装程序没有接受不完整安装。请处理问题后再次点击“安装”。
chinesesimp.TechnicalLog=技术日志：%1
chinesesimp.WelcomeTitle=欢迎使用 DeepSeek Harness
chinesesimp.WelcomeText=这个安装包可以直接用于没有安装 Node.js 或开发工具的电脑。%n%n保持推荐选项并一路点击“下一步”即可。安装程序会检查电脑、安装完整本体、自动补齐 WebView2，并在升级时保留已有用户数据。
chinesesimp.FinishedText=DeepSeek Harness 已安装完成。%n%n首次启动会先打开 CONFIG，你可以设置语言、窗口大小、全屏方式、加载画面、托盘行为和扩展，然后再进入主程序。
chinesesimp.LaunchAfterInstall=启动 DeepSeek Harness（首次使用先打开 CONFIG）

[Files]
Source: "{#LauncherDir}\dsh.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\dsh-hub.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\dsh-config.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\Microsoft.Web.WebView2.Core.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\Microsoft.Web.WebView2.WinForms.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\community-registry.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\dshmk-catalog.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#LauncherDir}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "install-runtime.ps1"; Flags: dontcopy noencryption
Source: "seed-config.ps1"; Flags: dontcopy noencryption
Source: "stop-installed-processes.ps1"; Flags: dontcopy noencryption
Source: "stop-installed-processes.ps1"; DestDir: "{app}\setup"; Flags: ignoreversion
#if Flavor == "full"
Source: "{#RuntimeArchive}"; Flags: dontcopy noencryption nocompression solidbreak
Source: "{#WebViewOffline}"; Flags: dontcopy noencryption nocompression solidbreak
#else
Source: "{#WebViewBootstrapper}"; Flags: dontcopy noencryption nocompression solidbreak
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Icons]
Name: "{group}\DeepSeek Harness"; Filename: "{app}\dsh.exe"; WorkingDir: "{app}"
Name: "{group}\HUB"; Filename: "{app}\dsh-hub.exe"; WorkingDir: "{app}"
Name: "{group}\CONFIG"; Filename: "{app}\dsh-config.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\DeepSeek Harness"; Filename: "{app}\dsh.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\dsh-config.exe"; Parameters: "--first-run"; Description: "{cm:LaunchAfterInstall}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup\stop-installed-processes.ps1"" -AppDirectory ""{app}"""; Flags: runhidden waituntilterminated; RunOnceId: "stop-installed-processes"
Filename: "{cmd}"; Parameters: "/D /C rd /S /Q ""\\?\{app}\runtime"""; Flags: runhidden waituntilterminated; RunOnceId: "remove-runtime"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\runtime"
Type: files; Name: "{app}\portable.mode"

[Code]
var
  SetupTypePage: TInputOptionWizardPage;
  DataModePage: TInputOptionWizardPage;
  RuntimeModePage: TInputOptionWizardPage;
  RuntimeArchivePage: TInputFileWizardPage;
  RuntimeFolderPage: TInputDirWizardPage;
  SourceArchivePage: TInputFileWizardPage;
  DownloadPage: TDownloadWizardPage;
  CheckPage: TWizardPage;
  CheckSummaryLabel: TNewStaticText;
  CheckStateLabels: array[0..5] of TNewStaticText;
  CheckTextLabels: array[0..5] of TNewStaticText;
  CheckDetailsMemo: TNewMemo;
  CheckRetryButton: TNewButton;
  CheckRecommendedButton: TNewButton;
  CheckDetailsButton: TNewButton;
  PreparationPage: TOutputMarqueeProgressWizardPage;
  PreparationComplete: Boolean;
  CheckPassed: Boolean;
  LastTaskLogPath: String;
  RequestedDataMode: String;
  RequestedRuntimeMode: String;
  CheckDetailsVisible: Boolean;

function GetTickCount: Cardinal;
  external 'GetTickCount@kernel32.dll stdcall';

function IsRecommendedInstall: Boolean;
begin
  Result := SetupTypePage.SelectedValueIndex = 0;
end;

function RuntimeModeKey: String;
begin
  if IsRecommendedInstall and (RequestedRuntimeMode = '') then begin
    Result := '{#FlavorDefaultMode}';
    Exit;
  end;
  case RuntimeModePage.SelectedValueIndex of
#if Flavor == "full"
    0: Result := 'bundled';
#else
    0: Result := 'download';
#endif
    1: Result := 'archive';
    2: Result := 'folder';
    3: Result := 'source';
  else
    Result := '{#FlavorDefaultMode}';
  end;
end;

function DataModeKey: String;
begin
  if IsRecommendedInstall and (RequestedDataMode = '') then begin
    Result := 'standard';
    Exit;
  end;
  if DataModePage.SelectedValueIndex = 1 then
    Result := 'portable'
  else
    Result := 'standard';
end;

function RuntimeModeDisplay: String;
var
  Mode: String;
begin
  Mode := RuntimeModeKey;
  if Mode = 'bundled' then Result := CustomMessage('RuntimeBundled')
  else if Mode = 'download' then Result := CustomMessage('RuntimeDownload')
  else if Mode = 'archive' then Result := CustomMessage('RuntimeArchive')
  else if Mode = 'folder' then Result := CustomMessage('RuntimeFolder')
  else Result := CustomMessage('RuntimeSource');
end;

function IsWebView2Installed: Boolean;
var
  Version: String;
  Key: String;
begin
  Key := 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result :=
    (RegQueryStringValue(HKLM32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU32, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function ExpandMessageLineBreaks(const Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '%n', #13#10, True);
end;

function FormatByteCount(const Value: Int64): String;
var
  Whole: Int64;
  Tenths: Int64;
begin
  if Value >= 1073741824 then begin
    Whole := Value div 1073741824;
    Tenths := ((Value mod 1073741824) * 10) div 1073741824;
    Result := IntToStr(Whole) + '.' + IntToStr(Tenths) + ' GB';
  end else
    Result := IntToStr(Value div 1048576) + ' MB';
end;

function ExistingDirectory(const Value: String): String;
var
  Parent: String;
begin
  Result := Value;
  while not DirExists(Result) do begin
    Parent := ExtractFileDir(Result);
    if (Parent = '') or (CompareText(Parent, Result) = 0) then begin
      Result := '';
      Exit;
    end;
    Result := Parent;
  end;
end;

function NormalizePath(const Value: String): String;
begin
  Result := Value;
  while (Length(Result) > 0) and
    ((Result[Length(Result)] = '\\') or (Result[Length(Result)] = '/')) do
    Delete(Result, Length(Result), 1);
end;

function CanWriteLocation(const Value: String): Boolean;
var
  Directory: String;
  Probe: String;
begin
  Directory := ExistingDirectory(Value);
  if Directory = '' then begin
    Result := False;
    Exit;
  end;
  Probe := AddBackslash(Directory) + '.dsh-setup-write-' + IntToStr(GetTickCount) + '.tmp';
  Result := SaveStringToFile(Probe, 'DeepSeek Harness Setup', False);
  if Result then DeleteFile(Probe);
end;

procedure AppendCheckDetail(var Details: String; const Status, MessageText: String);
begin
  Details := Details + Status + '  ' + MessageText + #13#10;
end;

procedure SetCheckRow(Index: Integer; const Status, Title, MessageText: String; StatusColor: TColor);
begin
  CheckStateLabels[Index].Caption := Status;
  CheckStateLabels[Index].Font.Color := StatusColor;
  CheckTextLabels[Index].Caption := Title + '  —  ' + MessageText;
end;

function SelectedDataDirectory: String;
begin
  if DataModeKey = 'portable' then
    Result := ExpandConstant('{app}\data')
  else
    Result := ExpandConstant('{localappdata}\DeepSeekHarness');
end;

function SourceBuildToolsAvailable: Boolean;
begin
  Result :=
    (FileSearch('node.exe', GetEnv('PATH')) <> '') and
    (FileSearch('pnpm.cmd', GetEnv('PATH')) <> '');
end;

function CurrentPackagedRuntimeIsInstalled: Boolean;
var
  RuntimeRoot: String;
  HashText: AnsiString;
begin
  Result := False;
  if (RuntimeModeKey <> 'bundled') and (RuntimeModeKey <> 'download') then Exit;
  RuntimeRoot := ExpandConstant('{app}\runtime');
  if not FileExists(RuntimeRoot + '\runtime-manifest.json') then Exit;
  if not FileExists(RuntimeRoot + '\runtime-resolver.mjs') then Exit;
  if not FileExists(RuntimeRoot + '\tools\node\node.exe') then Exit;
  if not FileExists(RuntimeRoot + '\tools\node\npm.cmd') then Exit;
  if not FileExists(RuntimeRoot + '\tools\node\node_modules\npm\bin\npm-cli.js') then Exit;
  if not FileExists(RuntimeRoot + '\tools\pnpm\pnpm.cmd') then Exit;
  if not FileExists(RuntimeRoot + '\tools\pnpm\node_modules\pnpm\bin\pnpm.mjs') then Exit;
  if not FileExists(RuntimeRoot + '\node_modules\@deepseek-ai\dsh\lib\bin.js') then Exit;
  if not LoadStringFromFile(RuntimeRoot + '\.source-sha256', HashText) then Exit;
  Result := CompareText(Trim(HashText), '{#RuntimeSha256}') = 0;
end;

function SetEnvironmentVariable(const Name, Value: String): Boolean;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

function SendMessageTimeout(hWnd, Msg, wParam, lParam, fuFlags, uTimeout: Integer; var lpdwResult: Integer): Integer;
  external 'SendMessageTimeoutW@user32.dll stdcall';

function UserEnvironmentValueExists(const Name: String; var Value: String): Boolean;
begin
  Result := RegQueryStringValue(HKCU, 'Environment', Name, Value);
end;

function PathListContains(const List, Entry: String): Boolean;
var
  StartIndex: Integer;
  SeparatorIndex: Integer;
  Candidate: String;
begin
  Result := False;
  StartIndex := 1;
  while StartIndex <= Length(List) + 1 do begin
    SeparatorIndex := Pos(';', Copy(List, StartIndex, Length(List)));
    if SeparatorIndex > 0 then SeparatorIndex := SeparatorIndex + StartIndex - 1;
    if SeparatorIndex = 0 then SeparatorIndex := Length(List) + 1;
    Candidate := Trim(Copy(List, StartIndex, SeparatorIndex - StartIndex));
    if CompareText(NormalizePath(Candidate), NormalizePath(Entry)) = 0 then begin
      Result := True;
      Exit;
    end;
    StartIndex := SeparatorIndex + 1;
  end;
end;

function RemovePathListEntry(const List, Entry: String): String;
var
  StartIndex: Integer;
  SeparatorIndex: Integer;
  Candidate: String;
begin
  Result := '';
  StartIndex := 1;
  while StartIndex <= Length(List) + 1 do begin
    SeparatorIndex := Pos(';', Copy(List, StartIndex, Length(List)));
    if SeparatorIndex > 0 then SeparatorIndex := SeparatorIndex + StartIndex - 1;
    if SeparatorIndex = 0 then SeparatorIndex := Length(List) + 1;
    Candidate := Trim(Copy(List, StartIndex, SeparatorIndex - StartIndex));
    if (Candidate <> '') and (CompareText(NormalizePath(Candidate), NormalizePath(Entry)) <> 0) then begin
      if Result <> '' then Result := Result + ';';
      Result := Result + Candidate;
    end;
    StartIndex := SeparatorIndex + 1;
  end;
end;

procedure BroadcastEnvironmentChange;
var
  ResultCode: Integer;
begin
  ResultCode := 0;
  SendMessageTimeout($FFFF, $001A, 0, 0, $0002, 5000, ResultCode);
end;

procedure RegisterUserEnvironment;
var
  ExistingPath: String;
  ProcessPath: String;
  InstallPath: String;
  DshHome: String;
  ExistingDshHome: String;
begin
  InstallPath := NormalizePath(ExpandConstant('{app}'));
  if not UserEnvironmentValueExists('Path', ExistingPath) then ExistingPath := '';
  if not PathListContains(ExistingPath, InstallPath) then begin
    if ExistingPath = '' then ExistingPath := InstallPath else ExistingPath := ExistingPath + ';' + InstallPath;
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', ExistingPath);
  end;
  ProcessPath := GetEnv('PATH');
  if not PathListContains(ProcessPath, InstallPath) then begin
    if ProcessPath = '' then ProcessPath := InstallPath else ProcessPath := ProcessPath + ';' + InstallPath;
  end;
  SetEnvironmentVariable('Path', ProcessPath);

  DshHome := ExpandConstant('{localappdata}\DeepSeekHarness\dsh');
  if not UserEnvironmentValueExists('DSH_HOME', ExistingDshHome) or (Trim(ExistingDshHome) = '') then begin
    RegWriteExpandStringValue(HKCU, 'Environment', 'DSH_HOME', DshHome);
    SetEnvironmentVariable('DSH_HOME', DshHome);
  end else begin
    SetEnvironmentVariable('DSH_HOME', ExistingDshHome);
  end;
  BroadcastEnvironmentChange;
end;

procedure UnregisterUserEnvironment;
var
  ExistingPath: String;
  ProcessPath: String;
  ExistingDshHome: String;
  InstallPath: String;
  OwnedDshHome: String;
begin
  InstallPath := NormalizePath(ExpandConstant('{app}'));
  if UserEnvironmentValueExists('Path', ExistingPath) then begin
    ExistingPath := RemovePathListEntry(ExistingPath, InstallPath);
    if ExistingPath = '' then RegDeleteValue(HKCU, 'Environment', 'Path')
    else RegWriteExpandStringValue(HKCU, 'Environment', 'Path', ExistingPath);
  end;
  ProcessPath := RemovePathListEntry(GetEnv('PATH'), InstallPath);
  SetEnvironmentVariable('Path', ProcessPath);
  OwnedDshHome := ExpandConstant('{localappdata}\DeepSeekHarness\dsh');
  if UserEnvironmentValueExists('DSH_HOME', ExistingDshHome) and
    (CompareText(NormalizePath(ExistingDshHome), NormalizePath(OwnedDshHome)) = 0) then begin
    RegDeleteValue(HKCU, 'Environment', 'DSH_HOME');
    SetEnvironmentVariable('DSH_HOME', '');
  end;
  BroadcastEnvironmentChange;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then RegisterUserEnvironment;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then UnregisterUserEnvironment;
end;

procedure ApplyRecommendedSettings;
begin
  SetupTypePage.SelectedValueIndex := 0;
  DataModePage.SelectedValueIndex := 0;
  RuntimeModePage.SelectedValueIndex := 0;
  RequestedDataMode := '';
  RequestedRuntimeMode := '';
  WizardForm.DirEdit.Text := ExpandConstant('{localappdata}\Programs\DeepSeek Harness');
end;

procedure RunComputerChecks;
var
  Details: String;
  InstallPath: String;
  DataPath: String;
  TempPath: String;
  InstallDirectory: String;
  TempDirectory: String;
  FreeBytes: Int64;
  TotalBytes: Int64;
  RequiredInstallBytes: Int64;
  RequiredTempBytes: Int64;
  RequiredCombinedBytes: Int64;
  RuntimeArchiveSize: Int64;
  RuntimeInstalledSize: Int64;
  WebViewInstallerSize: Int64;
  SpacePassed: Boolean;
  Mode: String;
  ApplicationMessage: String;
begin
  CheckPassed := True;
  Details := '';
  InstallPath := ExpandConstant('{app}');
  DataPath := SelectedDataDirectory;
  TempPath := ExpandConstant('{tmp}');
  RuntimeArchiveSize := StrToInt64('{#RuntimeArchiveBytes}');
  RuntimeInstalledSize := StrToInt64('{#RuntimeInstalledBytes}');
  if CurrentPackagedRuntimeIsInstalled then begin
    RuntimeArchiveSize := 0;
    RuntimeInstalledSize := 0;
  end;
#if Flavor == "full"
  WebViewInstallerSize := StrToInt64('{#WebViewOfflineBytes}');
#else
  WebViewInstallerSize := StrToInt64('{#WebViewBootstrapperBytes}');
#endif
  if IsWebView2Installed then WebViewInstallerSize := 0;
  Mode := RuntimeModeKey;

  if (Mode = 'source') and not SourceBuildToolsAvailable then begin
    SetCheckRow(0, CustomMessage('CheckAttention'), CustomMessage('CheckSystemTitle'),
      CustomMessage('CheckSourceToolsMissing'), clRed);
    AppendCheckDetail(Details, CustomMessage('CheckAttention'), CustomMessage('CheckSourceToolsMissing'));
    CheckPassed := False;
  end else begin
    if Mode = 'source' then ApplicationMessage := CustomMessage('CheckSourceToolsReady')
    else ApplicationMessage := CustomMessage('CheckSystemReady');
    SetCheckRow(0, CustomMessage('CheckPassed'), CustomMessage('CheckSystemTitle'),
      ApplicationMessage, clGreen);
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckWindows'));
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckPrivateNode'));
  end;

  if CanWriteLocation(InstallPath) then begin
    SetCheckRow(1, CustomMessage('CheckPassed'), CustomMessage('CheckInstallTitle'),
      CustomMessage('CheckInstallReady'), clGreen);
    AppendCheckDetail(Details, CustomMessage('CheckPassed'),
      FmtMessage(CustomMessage('CheckInstallWritable'), [InstallPath]));
  end
  else begin
    SetCheckRow(1, CustomMessage('CheckAttention'), CustomMessage('CheckInstallTitle'),
      CustomMessage('CheckInstallNeedsAction'), clRed);
    AppendCheckDetail(Details, CustomMessage('CheckAttention'),
      FmtMessage(CustomMessage('CheckInstallBlocked'), [InstallPath]));
    CheckPassed := False;
  end;

  if CanWriteLocation(DataPath) then begin
    if DataModeKey = 'portable' then
      ApplicationMessage := CustomMessage('CheckDataPortableReady')
    else
      ApplicationMessage := CustomMessage('CheckDataStandardReady');
    SetCheckRow(2, CustomMessage('CheckPassed'), CustomMessage('CheckDataTitle'),
      ApplicationMessage, clGreen);
    AppendCheckDetail(Details, CustomMessage('CheckPassed'),
      FmtMessage(CustomMessage('CheckDataWritable'), [DataPath]));
  end
  else begin
    SetCheckRow(2, CustomMessage('CheckAttention'), CustomMessage('CheckDataTitle'),
      CustomMessage('CheckDataNeedsAction'), clRed);
    AppendCheckDetail(Details, CustomMessage('CheckAttention'),
      FmtMessage(CustomMessage('CheckDataBlocked'), [DataPath]));
    CheckPassed := False;
  end;

  RequiredInstallBytes := RuntimeInstalledSize + 268435456;
  RequiredTempBytes := RuntimeArchiveSize + WebViewInstallerSize + 268435456;
  InstallDirectory := ExistingDirectory(InstallPath);
  TempDirectory := ExistingDirectory(TempPath);
  SpacePassed := False;
  if (InstallDirectory <> '') and (TempDirectory <> '') then begin
    if CompareText(ExtractFileDrive(InstallDirectory), ExtractFileDrive(TempDirectory)) = 0 then begin
      RequiredCombinedBytes := RequiredInstallBytes + RequiredTempBytes;
      if GetSpaceOnDisk64(InstallDirectory, FreeBytes, TotalBytes) then begin
        SpacePassed := FreeBytes >= RequiredCombinedBytes;
        if SpacePassed then begin
          SetCheckRow(3, CustomMessage('CheckPassed'), CustomMessage('CheckDiskTitle'),
            FmtMessage(CustomMessage('CheckDiskReady'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredCombinedBytes)]), clGreen);
          AppendCheckDetail(Details, CustomMessage('CheckPassed'),
            FmtMessage(CustomMessage('CheckDiskPassed'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredCombinedBytes)]));
        end else begin
          SetCheckRow(3, CustomMessage('CheckAttention'), CustomMessage('CheckDiskTitle'),
            FmtMessage(CustomMessage('CheckDiskNeedsAction'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredCombinedBytes)]), clRed);
          AppendCheckDetail(Details, CustomMessage('CheckAttention'),
            FmtMessage(CustomMessage('CheckDiskBlocked'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredCombinedBytes)]));
        end;
      end;
    end else begin
      SpacePassed := GetSpaceOnDisk64(InstallDirectory, FreeBytes, TotalBytes) and
        (FreeBytes >= RequiredInstallBytes);
      if SpacePassed then begin
        SpacePassed := GetSpaceOnDisk64(TempDirectory, FreeBytes, TotalBytes) and
          (FreeBytes >= RequiredTempBytes);
      end;
      if SpacePassed then begin
        SetCheckRow(3, CustomMessage('CheckPassed'), CustomMessage('CheckDiskTitle'),
          FmtMessage(CustomMessage('CheckDiskReady'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredTempBytes)]), clGreen);
        AppendCheckDetail(Details, CustomMessage('CheckPassed'),
          FmtMessage(CustomMessage('CheckDiskPassed'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredTempBytes)]));
      end else begin
        SetCheckRow(3, CustomMessage('CheckAttention'), CustomMessage('CheckDiskTitle'),
          FmtMessage(CustomMessage('CheckDiskNeedsAction'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredTempBytes)]), clRed);
        AppendCheckDetail(Details, CustomMessage('CheckAttention'),
          FmtMessage(CustomMessage('CheckDiskBlocked'), [FormatByteCount(FreeBytes), FormatByteCount(RequiredTempBytes)]));
      end;
    end;
  end;
  if not SpacePassed then CheckPassed := False;

  if IsWebView2Installed then begin
    SetCheckRow(4, CustomMessage('CheckPassed'), CustomMessage('CheckWebViewTitle'),
      CustomMessage('CheckWebViewReady'), clGreen);
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckWebViewPresent'));
  end
  else begin
    SetCheckRow(4, CustomMessage('CheckAutomatic'), CustomMessage('CheckWebViewTitle'),
      CustomMessage('CheckWebViewWillInstall'), clNavy);
#if Flavor == "full"
    AppendCheckDetail(Details, CustomMessage('CheckAutomatic'), CustomMessage('CheckWebViewBundled'));
#else
    AppendCheckDetail(Details, CustomMessage('CheckAutomatic'), CustomMessage('CheckWebViewOnline'));
#endif
  end;

  if Mode = 'bundled' then begin
    ApplicationMessage := CustomMessage('CheckApplicationBundled');
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckRuntimeBundled'));
  end else if Mode = 'download' then begin
    ApplicationMessage := CustomMessage('CheckApplicationDownload');
    AppendCheckDetail(Details, CustomMessage('CheckAutomatic'), CustomMessage('CheckRuntimeDownload'));
  end else begin
    ApplicationMessage := CustomMessage('CheckApplicationLocal');
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckRuntimeLocal'));
  end;

  if FileExists(ExpandConstant('{app}\dsh.exe')) then begin
    ApplicationMessage := ApplicationMessage + CustomMessage('CheckUpgradeSuffix');
    AppendCheckDetail(Details, CustomMessage('CheckAutomatic'), CustomMessage('CheckExisting'));
  end else begin
    ApplicationMessage := ApplicationMessage + CustomMessage('CheckFreshSuffix');
    AppendCheckDetail(Details, CustomMessage('CheckPassed'), CustomMessage('CheckFresh'));
  end;
  if Mode = 'download' then
    SetCheckRow(5, CustomMessage('CheckAutomatic'), CustomMessage('CheckApplicationTitle'),
      ApplicationMessage, clNavy)
  else
    SetCheckRow(5, CustomMessage('CheckPassed'), CustomMessage('CheckApplicationTitle'),
      ApplicationMessage, clGreen);

  if CheckPassed then
    CheckPage.Description := CustomMessage('CheckReady')
  else
    CheckPage.Description := CustomMessage('CheckBlocked');
  if CheckPassed then
    Log('Computer checks passed.' + #13#10 + Details)
  else
    Log('Computer checks failed.' + #13#10 + Details);
  CheckDetailsMemo.Lines.Text := Details;
  CheckRecommendedButton.Visible := (not IsRecommendedInstall) or (not CheckPassed);
  CheckRecommendedButton.Enabled := CheckRecommendedButton.Visible;
  if CheckRecommendedButton.Visible then
    CheckDetailsButton.Left := CheckRecommendedButton.Left + CheckRecommendedButton.Width + ScaleX(10)
  else
    CheckDetailsButton.Left := CheckRetryButton.Left + CheckRetryButton.Width + ScaleX(10);
end;

procedure CheckDetailsButtonClick(Sender: TObject);
var
  I: Integer;
begin
  CheckDetailsVisible := not CheckDetailsVisible;
  for I := 0 to 5 do begin
    CheckStateLabels[I].Visible := not CheckDetailsVisible;
    CheckTextLabels[I].Visible := not CheckDetailsVisible;
  end;
  CheckDetailsMemo.Visible := CheckDetailsVisible;
  if CheckDetailsVisible then
    CheckDetailsButton.Caption := CustomMessage('CheckHideDetails')
  else
    CheckDetailsButton.Caption := CustomMessage('CheckShowDetails');
end;

procedure CheckRetryButtonClick(Sender: TObject);
begin
  RunComputerChecks;
end;

procedure CheckRecommendedButtonClick(Sender: TObject);
begin
  ApplyRecommendedSettings;
  RunComputerChecks;
end;

procedure SelectRuntimeMode(const Mode: String);
begin
#if Flavor == "full"
  if Mode = 'bundled' then RuntimeModePage.SelectedValueIndex := 0
#else
  if Mode = 'download' then RuntimeModePage.SelectedValueIndex := 0
#endif
  else if Mode = 'archive' then RuntimeModePage.SelectedValueIndex := 1
  else if Mode = 'folder' then RuntimeModePage.SelectedValueIndex := 2
  else if Mode = 'source' then RuntimeModePage.SelectedValueIndex := 3;
end;

procedure InitializeWizard;
var
  PreviousMode: String;
  I: Integer;
  RowTop: Integer;
begin
  RequestedDataMode := ExpandConstant('{param:DATAMODE|}');
  RequestedRuntimeMode := ExpandConstant('{param:RUNTIMEMODE|}');

  SetupTypePage := CreateInputOptionPage(wpLicense,
    CustomMessage('SetupTypeTitle'), CustomMessage('SetupTypeDescription'),
    CustomMessage('SetupTypePrompt'), True, False);
  SetupTypePage.Add(CustomMessage('SetupTypeRecommended'));
  SetupTypePage.Add(CustomMessage('SetupTypeAdvanced'));
  if CompareText(ExpandConstant('{param:ADVANCED|}'), '1') = 0 then
    SetupTypePage.SelectedValueIndex := 1
  else
    SetupTypePage.SelectedValueIndex := 0;

  DataModePage := CreateInputOptionPage(wpSelectDir,
    CustomMessage('DataModeTitle'), CustomMessage('DataModeDescription'),
    CustomMessage('DataModePrompt'), True, False);
  DataModePage.Add(CustomMessage('DataModeStandard'));
  DataModePage.Add(CustomMessage('DataModePortable'));
  if CompareText(RequestedDataMode, 'portable') = 0 then
    DataModePage.SelectedValueIndex := 1
  else if CompareText(GetPreviousData('DataMode', ''), 'portable') = 0 then
    DataModePage.SelectedValueIndex := 1
  else
    DataModePage.SelectedValueIndex := 0;

  RuntimeModePage := CreateInputOptionPage(DataModePage.ID,
    CustomMessage('RuntimeModeTitle'), CustomMessage('RuntimeModeDescription'),
    CustomMessage('RuntimeModePrompt'), True, False);
#if Flavor == "full"
  RuntimeModePage.Add(CustomMessage('RuntimeBundled'));
#else
  RuntimeModePage.Add(CustomMessage('RuntimeDownload'));
#endif
  RuntimeModePage.Add(CustomMessage('RuntimeArchive'));
  RuntimeModePage.Add(CustomMessage('RuntimeFolder'));
  RuntimeModePage.Add(CustomMessage('RuntimeSource'));
  RuntimeModePage.SelectedValueIndex := 0;
  PreviousMode := GetPreviousData('RuntimeMode', '');
  if PreviousMode <> '' then SelectRuntimeMode(PreviousMode);
  if RequestedRuntimeMode <> '' then SelectRuntimeMode(RequestedRuntimeMode);

  RuntimeArchivePage := CreateInputFilePage(RuntimeModePage.ID,
    CustomMessage('RuntimeArchiveTitle'), CustomMessage('RuntimeArchiveDescription'), '');
  RuntimeArchivePage.Add(CustomMessage('RuntimeArchivePrompt'), 'ZIP files|*.zip|All files|*.*', '.zip');
  RuntimeArchivePage.Values[0] := ExpandConstant('{param:RUNTIMEZIP|}');

  RuntimeFolderPage := CreateInputDirPage(RuntimeArchivePage.ID,
    CustomMessage('RuntimeFolderTitle'), CustomMessage('RuntimeFolderDescription'), '',
    False, SetupMessage(msgNewFolderName));
  RuntimeFolderPage.Add(CustomMessage('RuntimeFolderPrompt'));
  RuntimeFolderPage.Values[0] := ExpandConstant('{param:RUNTIMEFOLDER|}');

  SourceArchivePage := CreateInputFilePage(RuntimeFolderPage.ID,
    CustomMessage('SourceArchiveTitle'), CustomMessage('SourceArchiveDescription'), '');
  SourceArchivePage.Add(CustomMessage('SourceArchivePrompt'), 'ZIP files|*.zip|All files|*.*', '.zip');
  SourceArchivePage.Values[0] := ExpandConstant('{param:SOURCEZIP|}');

  DownloadPage := CreateDownloadPage(CustomMessage('DownloadTitle'), CustomMessage('DownloadDescription'), nil);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
  CheckPage := CreateCustomPage(wpSelectTasks,
    CustomMessage('CheckTitle'), CustomMessage('CheckDescription'));
  CheckSummaryLabel := TNewStaticText.Create(CheckPage);
  CheckSummaryLabel.Parent := CheckPage.Surface;
  CheckSummaryLabel.Left := 0;
  CheckSummaryLabel.Top := ScaleY(4);
  CheckSummaryLabel.Width := CheckPage.Surface.Width;
  CheckSummaryLabel.Height := ScaleY(38);
  CheckSummaryLabel.AutoSize := False;
  CheckSummaryLabel.WordWrap := True;
  CheckSummaryLabel.Font.Style := [fsBold];
  CheckSummaryLabel.Visible := False;
  RowTop := ScaleY(8);
  for I := 0 to 5 do begin
    CheckStateLabels[I] := TNewStaticText.Create(CheckPage);
    CheckStateLabels[I].Parent := CheckPage.Surface;
    CheckStateLabels[I].Left := 0;
    CheckStateLabels[I].Top := RowTop + (I * ScaleY(42));
    CheckStateLabels[I].Width := ScaleX(70);
    CheckStateLabels[I].Height := ScaleY(34);
    CheckStateLabels[I].AutoSize := False;
    CheckStateLabels[I].Font.Style := [fsBold];
    CheckTextLabels[I] := TNewStaticText.Create(CheckPage);
    CheckTextLabels[I].Parent := CheckPage.Surface;
    CheckTextLabels[I].Left := ScaleX(82);
    CheckTextLabels[I].Top := CheckStateLabels[I].Top;
    CheckTextLabels[I].Width := CheckPage.Surface.Width - ScaleX(82);
    CheckTextLabels[I].Height := ScaleY(36);
    CheckTextLabels[I].AutoSize := False;
    CheckTextLabels[I].WordWrap := True;
  end;
  CheckDetailsMemo := TNewMemo.Create(CheckPage);
  CheckDetailsMemo.Parent := CheckPage.Surface;
  CheckDetailsMemo.Left := 0;
  CheckDetailsMemo.Top := RowTop;
  CheckDetailsMemo.Width := CheckPage.Surface.Width;
  CheckDetailsMemo.Height := CheckPage.Surface.Height - RowTop - ScaleY(44);
  CheckDetailsMemo.ReadOnly := True;
  CheckDetailsMemo.ScrollBars := ssVertical;
  CheckDetailsMemo.Visible := False;
  CheckRetryButton := TNewButton.Create(CheckPage);
  CheckRetryButton.Parent := CheckPage.Surface;
  CheckRetryButton.Caption := CustomMessage('CheckRetry');
  CheckRetryButton.Left := 0;
  CheckRetryButton.Width := ScaleX(120);
  CheckRetryButton.Height := ScaleY(28);
  CheckRetryButton.Top := CheckPage.Surface.Height - CheckRetryButton.Height - ScaleY(4);
  CheckRetryButton.OnClick := @CheckRetryButtonClick;
  CheckRecommendedButton := TNewButton.Create(CheckPage);
  CheckRecommendedButton.Parent := CheckPage.Surface;
  CheckRecommendedButton.Caption := CustomMessage('CheckRecommended');
  CheckRecommendedButton.Left := CheckRetryButton.Left + CheckRetryButton.Width + ScaleX(10);
  CheckRecommendedButton.Top := CheckRetryButton.Top;
  CheckRecommendedButton.Width := ScaleX(150);
  CheckRecommendedButton.Height := CheckRetryButton.Height;
  CheckRecommendedButton.OnClick := @CheckRecommendedButtonClick;
  CheckDetailsButton := TNewButton.Create(CheckPage);
  CheckDetailsButton.Parent := CheckPage.Surface;
  CheckDetailsButton.Caption := CustomMessage('CheckShowDetails');
  CheckDetailsButton.Left := CheckRecommendedButton.Left + CheckRecommendedButton.Width + ScaleX(10);
  CheckDetailsButton.Top := CheckRetryButton.Top;
  CheckDetailsButton.Width := ScaleX(135);
  CheckDetailsButton.Height := CheckRetryButton.Height;
  CheckDetailsButton.OnClick := @CheckDetailsButtonClick;
  CheckDetailsVisible := False;
  PreparationPage := CreateOutputMarqueeProgressPage(
    CustomMessage('PrepareTitle'), CustomMessage('PrepareStarting'));
  PreparationComplete := False;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
var
  Mode: String;
begin
  Mode := RuntimeModeKey;
  Result :=
    ((PageID = wpSelectDir) and IsRecommendedInstall) or
    ((PageID = DataModePage.ID) and IsRecommendedInstall) or
    ((PageID = RuntimeModePage.ID) and IsRecommendedInstall) or
    ((PageID = RuntimeArchivePage.ID) and (IsRecommendedInstall or (Mode <> 'archive'))) or
    ((PageID = RuntimeFolderPage.ID) and (Mode <> 'folder')) or
    ((PageID = SourceArchivePage.ID) and (Mode <> 'source'));
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpWelcome then begin
    WizardForm.WelcomeLabel1.Caption := CustomMessage('WelcomeTitle');
    WizardForm.WelcomeLabel2.Caption := ExpandMessageLineBreaks(CustomMessage('WelcomeText'));
    WizardForm.WelcomeLabel2.Height := ScaleY(150);
  end else if CurPageID = CheckPage.ID then
    RunComputerChecks
  else if CurPageID = wpFinished then begin
    WizardForm.FinishedLabel.Caption := ExpandMessageLineBreaks(CustomMessage('FinishedText'));
    WizardForm.FinishedLabel.Height := ScaleY(100);
  end;
end;

function ValidateRuntimeSelection(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = RuntimeArchivePage.ID) and not FileExists(RuntimeArchivePage.Values[0]) then begin
    MsgBox(CustomMessage('MissingRuntimeArchive'), mbError, MB_OK);
    Result := False;
  end else if (CurPageID = RuntimeFolderPage.ID) and not DirExists(RuntimeFolderPage.Values[0]) then begin
    MsgBox(CustomMessage('MissingRuntimeFolder'), mbError, MB_OK);
    Result := False;
  end else if (CurPageID = SourceArchivePage.ID) and not FileExists(SourceArchivePage.Values[0]) then begin
    MsgBox(CustomMessage('MissingSourceArchive'), mbError, MB_OK);
    Result := False;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  ErrorText: String;
begin
  Result := ValidateRuntimeSelection(CurPageID);
  if not Result then Exit;

  if CurPageID = CheckPage.ID then begin
    RunComputerChecks;
    if not CheckPassed then begin
      SuppressibleMsgBox(CustomMessage('CheckBlockedMessage'), mbError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
  end;

  if (CurPageID = wpReady) and (RuntimeModeKey = 'download') and
    (not CurrentPackagedRuntimeIsInstalled) then begin
    DownloadPage.Clear;
    DownloadPage.Add('{#RuntimeDownloadUrl}', '{#RuntimeAssetName}', '{#RuntimeSha256}');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        Result := True;
      except
        ErrorText := CustomMessage('DownloadFailed') + ': ' + GetExceptionMessage + #13#10#13#10 +
          CustomMessage('DownloadRetry');
        SuppressibleMsgBox(ErrorText, mbCriticalError, MB_OK, IDOK);
        Result := False;
      end;
    finally
      DownloadPage.Hide;
    end;
  end;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'DataMode', DataModeKey);
  SetPreviousData(PreviousDataKey, 'RuntimeMode', RuntimeModeKey);
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
var
  S: String;
begin
  S := MemoDirInfo + NewLine + NewLine;
  if IsRecommendedInstall and (RequestedDataMode = '') and (RequestedRuntimeMode = '') then begin
    S := S + CustomMessage('ReadyRecommended') + NewLine + Space +
      CustomMessage('ReadyRecommendedValue') + NewLine + NewLine;
    S := S + CustomMessage('ReadyIncludes') + NewLine + Space +
      CustomMessage('ReadyIncludesValue') + NewLine + NewLine;
  end else begin
    S := S + CustomMessage('ReadyDataMode') + NewLine + Space;
    if DataModeKey = 'portable' then
      S := S + CustomMessage('ReadyDataPortable')
    else
      S := S + CustomMessage('ReadyDataStandard');
    S := S + NewLine + NewLine;
    S := S + CustomMessage('ReadyRuntimeMode') + NewLine + Space + RuntimeModeDisplay + NewLine + NewLine;
  end;
  if IsWebView2Installed then
    S := S + CustomMessage('WebViewPresent')
  else
    S := S + CustomMessage('WebViewMissing');
  if MemoTasksInfo <> '' then S := S + NewLine + NewLine + MemoTasksInfo;
  Result := S;
end;

function Quote(const Value: String): String;
begin
  Result := '"' + Value + '"';
end;

function PowerShellLiteral(const Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '''', '''''', True);
  Result := '''' + Result + '''';
end;

procedure StopBackgroundTask(const PidPath: String);
var
  PidText: AnsiString;
  Pid: Integer;
  ResultCode: Integer;
begin
  if LoadStringFromFile(PidPath, PidText) then begin
    Pid := StrToIntDef(Trim(PidText), 0);
    if Pid > 0 then
      Exec(ExpandConstant('{sys}\taskkill.exe'), '/PID ' + IntToStr(Pid) + ' /T /F', '',
        SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;

function PersistFailureLog(const TaskName, LogPath: String): String;
var
  LogDirectory: String;
begin
  Result := '';
  if not FileExists(LogPath) then Exit;
  LogDirectory := ExpandConstant('{localappdata}\DeepSeekHarness\InstallerLogs');
  if not ForceDirectories(LogDirectory) then Exit;
  Result := AddBackslash(LogDirectory) + 'setup-last-' + TaskName + '.log';
  if not CopyFile(LogPath, Result, False) then Result := '';
end;

function TaskFailureMessage(const MessageText: String): String;
begin
  Result := MessageText + #13#10#13#10 + CustomMessage('PrepareRetry');
  if LastTaskLogPath <> '' then
    Result := Result + #13#10#13#10 +
      FmtMessage(CustomMessage('TechnicalLog'), [LastTaskLogPath]);
end;

procedure SetPreparationStage(Stage, StageCount: Integer; const MessageName: String);
begin
  PreparationPage.SetText(CustomMessage('PrepareTitle'),
    FmtMessage(CustomMessage('PrepareStep'), [IntToStr(Stage), IntToStr(StageCount), CustomMessage(MessageName)]));
end;

function RunPowerShellBodyResponsive(const TaskName, Body: String;
  TimeoutMilliseconds: Cardinal): Boolean;
var
  PowerShell: String;
  Parameters: String;
  WrapperPath: String;
  ResultPath: String;
  ResultTempPath: String;
  LogPath: String;
  PidPath: String;
  Wrapper: String;
  ResultText: AnsiString;
  LogText: AnsiString;
  ResultCode: Integer;
  StartedAt: Cardinal;
begin
  LastTaskLogPath := '';
  PowerShell := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  WrapperPath := ExpandConstant('{tmp}\dsh-setup-' + TaskName + '.ps1');
  ResultPath := ExpandConstant('{tmp}\dsh-setup-' + TaskName + '.result');
  ResultTempPath := ResultPath + '.tmp';
  LogPath := ExpandConstant('{tmp}\dsh-setup-' + TaskName + '.log');
  PidPath := ExpandConstant('{tmp}\dsh-setup-' + TaskName + '.pid');
  DeleteFile(ResultPath);
  DeleteFile(ResultTempPath);
  DeleteFile(LogPath);
  DeleteFile(PidPath);

  Wrapper :=
    '$ErrorActionPreference = ''Stop'''#13#10 +
    '[IO.File]::WriteAllText(' + PowerShellLiteral(PidPath) + ', [string]$PID)'#13#10 +
    '$exitCode = 1'#13#10 +
    'try {'#13#10 +
    '  & {'#13#10 + Body + #13#10 +
    '  } *>&1 | Out-File -LiteralPath ' + PowerShellLiteral(LogPath) + ' -Encoding utf8'#13#10 +
    '  $exitCode = 0'#13#10 +
    '} catch {'#13#10 +
    '  ($_ | Out-String) | Add-Content -LiteralPath ' + PowerShellLiteral(LogPath) + ' -Encoding utf8'#13#10 +
    '} finally {'#13#10 +
    '  [IO.File]::WriteAllText(' + PowerShellLiteral(ResultTempPath) + ', [string]$exitCode)'#13#10 +
    '  Move-Item -LiteralPath ' + PowerShellLiteral(ResultTempPath) +
      ' -Destination ' + PowerShellLiteral(ResultPath) + ' -Force'#13#10 +
    '}'#13#10 +
    'exit $exitCode'#13#10;
  if not SaveStringToFile(WrapperPath, Wrapper, False) then begin
    Result := False;
    Exit;
  end;

  Parameters := '-NoProfile -ExecutionPolicy Bypass -File ' + Quote(WrapperPath);
  if not Exec(PowerShell, Parameters, '', SW_HIDE, ewNoWait, ResultCode) then begin
    Result := False;
    Exit;
  end;

  StartedAt := GetTickCount;
  while not FileExists(ResultPath) do begin
    PreparationPage.Animate;
    Sleep(50);
    if GetTickCount - StartedAt >= TimeoutMilliseconds then begin
      StopBackgroundTask(PidPath);
      Log('Setup task timed out: ' + TaskName);
      LastTaskLogPath := PersistFailureLog(TaskName, LogPath);
      Result := False;
      Exit;
    end;
  end;

  Result := LoadStringFromFile(ResultPath, ResultText) and (Trim(ResultText) = '0');
  if not Result then begin
    LastTaskLogPath := PersistFailureLog(TaskName, LogPath);
    if LoadStringFromFile(LogPath, LogText) then
      Log('Setup task failed: ' + TaskName + #13#10 + LogText);
  end;
end;

function RunPowerShellResponsive(const TaskName, ScriptName, Arguments: String;
  TimeoutMilliseconds: Cardinal): Boolean;
var
  ScriptPath: String;
  Body: String;
begin
  ExtractTemporaryFile(ScriptName);
  ScriptPath := ExpandConstant('{tmp}\' + ScriptName);
  Body := '    & ' + PowerShellLiteral(ScriptPath) + ' ' + Arguments;
  Result := RunPowerShellBodyResponsive(TaskName, Body, TimeoutMilliseconds);
end;

function InstallWebView2: Boolean;
var
  InstallerName: String;
  InstallerPath: String;
  Body: String;
begin
  if IsWebView2Installed then begin
    Result := True;
    Exit;
  end;
#if Flavor == "full"
  InstallerName := 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe';
#else
  InstallerName := 'MicrosoftEdgeWebview2Setup.exe';
#endif
  ExtractTemporaryFile(InstallerName);
  InstallerPath := ExpandConstant('{tmp}\' + InstallerName);
  Body :=
    '    $process = Start-Process -FilePath ' + PowerShellLiteral(InstallerPath) +
      ' -ArgumentList @(''/silent'', ''/install'') -Wait -PassThru'#13#10 +
    '    if ($process.ExitCode -notin @(0, 3010)) { throw "WebView2 installer exited with code $($process.ExitCode)" }';
  Result := RunPowerShellBodyResponsive('webview', Body, 1800000);
end;

function InstallSelectedRuntime: Boolean;
var
  Mode: String;
  InputPath: String;
  Arguments: String;
begin
  Mode := RuntimeModeKey;
  if CurrentPackagedRuntimeIsInstalled then begin
    Log('The current packaged Runtime is already installed; skipping Runtime replacement.');
    Result := True;
    Exit;
  end;
  if Mode = 'bundled' then begin
    ExtractTemporaryFile(ExtractFileName('{#RuntimeArchive}'));
    InputPath := ExpandConstant('{tmp}\' + ExtractFileName('{#RuntimeArchive}'));
    Mode := 'archive';
  end else if Mode = 'download' then begin
    InputPath := ExpandConstant('{tmp}\{#RuntimeAssetName}');
    Mode := 'archive';
  end else if Mode = 'archive' then
    InputPath := RuntimeArchivePage.Values[0]
  else if Mode = 'folder' then
    InputPath := RuntimeFolderPage.Values[0]
  else
    InputPath := SourceArchivePage.Values[0];

  Arguments := '-Mode ' + PowerShellLiteral(Mode) +
    ' -Destination ' + PowerShellLiteral(ExpandConstant('{app}\runtime')) +
    ' -InputPath ' + PowerShellLiteral(InputPath);
  if (Mode = 'archive') and ((RuntimeModeKey = 'bundled') or (RuntimeModeKey = 'download')) then
    Arguments := Arguments + ' -ExpectedSha256 {#RuntimeSha256}';
  Result := RunPowerShellResponsive('runtime', 'install-runtime.ps1', Arguments, 14400000);
end;

function SeedFirstRunConfig: Boolean;
var
  Language: String;
  Arguments: String;
begin
  if ActiveLanguage = 'chinesesimp' then Language := 'zh-CN' else Language := 'en-US';
  Arguments := '-Language ' + PowerShellLiteral(Language) +
    ' -AppDirectory ' + PowerShellLiteral(ExpandConstant('{app}'));
  if DataModeKey = 'portable' then Arguments := Arguments + ' -Portable';
  Result := RunPowerShellResponsive('config', 'seed-config.ps1', Arguments, 600000);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  NeedsRestart := False;
  if PreparationComplete then Exit;
  RunComputerChecks;
  if not CheckPassed then begin
    Result := CustomMessage('CheckBlockedMessage');
    Exit;
  end;
  WizardForm.CancelButton.Enabled := False;
  PreparationPage.Show;
  try
    SetPreparationStage(1, 5, 'PrepareStopStep');
    if not RunPowerShellResponsive('stop-processes', 'stop-installed-processes.ps1',
      '-AppDirectory ' + PowerShellLiteral(ExpandConstant('{app}')), 120000) then begin
      Result := TaskFailureMessage(CustomMessage('ProcessStopFailed'));
      Exit;
    end;
    SetPreparationStage(2, 5, 'PrepareWebViewStep');
    if not IsWebView2Installed then begin
      if not InstallWebView2 then begin
        Result := TaskFailureMessage(CustomMessage('WebViewInstallFailed'));
        Exit;
      end;
    end;

    SetPreparationStage(3, 5, 'PrepareRuntimeStep');
    if not InstallSelectedRuntime then begin
      Result := TaskFailureMessage(CustomMessage('RuntimeInstallFailed'));
      Exit;
    end;

    if DataModeKey = 'portable' then
      SaveStringToFile(ExpandConstant('{app}\portable.mode'), '', False)
    else if FileExists(ExpandConstant('{app}\portable.mode')) then
      DeleteFile(ExpandConstant('{app}\portable.mode'));

    SetPreparationStage(4, 5, 'PrepareConfigStep');
    if not SeedFirstRunConfig then begin
      Result := TaskFailureMessage(CustomMessage('ConfigSeedFailed'));
      Exit;
    end;
    SetPreparationStage(5, 5, 'PrepareFinishStep');
    if not FileExists(ExpandConstant('{app}\runtime\runtime-manifest.json')) then begin
      LastTaskLogPath := '';
      Result := TaskFailureMessage(CustomMessage('RuntimeInstallFailed'));
      Exit;
    end;
    PreparationComplete := True;
  finally
    PreparationPage.Hide;
    WizardForm.CancelButton.Enabled := True;
  end;
end;
