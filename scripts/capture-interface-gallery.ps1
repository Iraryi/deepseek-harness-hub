param(
    [string]$DesktopRepository = '',
    [string]$LauncherDirectory = '',
    [string]$Setup = '',
    [string]$OutputDirectory = '',
    [ValidateSet('zh-CN', 'en-US')]
    [string[]]$Languages = @('zh-CN', 'en-US'),
    [switch]$SkipHub,
    [switch]$SkipConfig,
    [switch]$SkipSetup,
    [switch]$SkipRecommendedSetup,
    [switch]$SkipAdvancedSetup
)

$ErrorActionPreference = 'Stop'

$hubRepository = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $hubRepository -Parent
if ([string]::IsNullOrWhiteSpace($DesktopRepository)) {
    $DesktopRepository = Join-Path $workspace 'deepseek-harness'
}
$desktop = [IO.Path]::GetFullPath($DesktopRepository)
if ([string]::IsNullOrWhiteSpace($LauncherDirectory)) {
    $LauncherDirectory = Join-Path $desktop 'windows\launcher\dist'
}
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
if ([string]::IsNullOrWhiteSpace($Setup)) {
    $Setup = Join-Path $desktop 'windows\release\dist-hub-release\DeepSeek-Harness-Setup-Full-0.1.0-rc.5-win-x64.exe'
}
$setupPath = [IO.Path]::GetFullPath($Setup)
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $hubRepository 'snapshots'
}
$output = [IO.Path]::GetFullPath($OutputDirectory)
$windowControl = Join-Path $workspace 'work\winctl.exe'
$systemNode = (Get-Command node.exe -ErrorAction Stop).Source
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousOffline = $env:DEEPSEEK_HARNESS_OFFLINE

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public sealed class GalleryTopWindowInfo {
    public IntPtr Handle { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
}

public static class GalleryDisplayApi {
    private const uint WM_KEYDOWN = 0x0100;
    private const uint WM_KEYUP = 0x0101;
    private const int VK_RETURN = 0x0D;
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    public static bool PressEnter(IntPtr target) {
        if (target == IntPtr.Zero) return false;
        SendMessage(target, WM_KEYDOWN, new IntPtr(VK_RETURN), new IntPtr(0x001c0001));
        SendMessage(target, WM_KEYUP, new IntPtr(VK_RETURN), new IntPtr(unchecked((int)0xc01c0001)));
        return true;
    }

    public static GalleryTopWindowInfo[] ProcessWindows(int processId) {
        List<GalleryTopWindowInfo> windows = new List<GalleryTopWindowInfo>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            NativeRect rect;
            if (owner == processId && IsWindowVisible(window) && GetWindowRect(window, out rect) && rect.Right > rect.Left && rect.Bottom > rect.Top) {
                windows.Add(new GalleryTopWindowInfo {
                    Handle = window,
                    X = rect.Left,
                    Y = rect.Top,
                    Width = rect.Right - rect.Left,
                    Height = rect.Bottom - rect.Top
                });
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static bool RenderWindow(IntPtr window, IntPtr deviceContext) { return PrintWindow(window, deviceContext, 3); }
}
'@
$primaryDisplay = [Windows.Forms.Screen]::PrimaryScreen.Bounds

foreach ($required in @(
    (Join-Path $launcher 'dsh-hub.exe'),
    (Join-Path $launcher 'dsh-config.exe'),
    (Join-Path $launcher 'dsh.exe'),
    $windowControl
)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required capture input is missing: $required" }
}
if (-not $SkipSetup -and -not (Test-Path -LiteralPath $setupPath)) {
    throw "Setup capture input is missing: $setupPath"
}

function New-CaptureDirectory([string]$Language, [string]$Surface) {
    $directory = Join-Path (Join-Path $output $Language) $Surface
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    return $directory
}

function New-TemporaryDirectory([string]$Prefix) {
    $directory = Join-Path ([IO.Path]::GetTempPath()) ($Prefix + '-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    return [IO.Path]::GetFullPath($directory)
}

function Remove-VerifiedTemporaryDirectory([string]$Directory) {
    if ([string]::IsNullOrWhiteSpace($Directory) -or -not (Test-Path -LiteralPath $Directory)) { return }
    $full = [IO.Path]::GetFullPath($Directory)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $tempRoot.EndsWith([IO.Path]::DirectorySeparatorChar)) { $tempRoot += [IO.Path]::DirectorySeparatorChar }
    if (-not $full.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to delete a non-temporary capture directory: $full"
    }
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $full); $attempt++) {
        try { [IO.Directory]::Delete($full, $true) }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path -LiteralPath $full) { throw "Temporary capture directory could not be removed: $full" }
}

function Copy-LauncherFiles([string]$Destination, [string[]]$Executables) {
    foreach ($file in $Executables) {
        Copy-Item -LiteralPath (Join-Path $launcher $file) -Destination $Destination
    }
    Copy-Item -Path (Join-Path $launcher '*.dll') -Destination $Destination
    foreach ($file in @('community-registry.json', 'dshmk-catalog.json', 'THIRD-PARTY-NOTICES.txt')) {
        $source = Join-Path $launcher $file
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $Destination }
    }
    New-Item -ItemType File -Path (Join-Path $Destination 'portable.mode') -Force | Out-Null
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
}

function Wait-MainWindow([Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $Process.Refresh()
        if ($Process.MainWindowHandle -ne 0) { return }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    throw "Main window missing for process $($Process.Id)"
}

function Expand-WindowToPrimaryDisplay([Diagnostics.Process]$Process) {
    $Process.Refresh()
    if ($Process.MainWindowHandle -eq 0) { throw "Cannot expand a process without a main window: $($Process.Id)" }
    [GalleryDisplayApi]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
    if (-not [GalleryDisplayApi]::MoveWindow(
        $Process.MainWindowHandle,
        $primaryDisplay.X,
        $primaryDisplay.Y,
        $primaryDisplay.Width,
        $primaryDisplay.Height,
        $true
    )) {
        throw "Could not expand process $($Process.Id) to $($primaryDisplay.Width)x$($primaryDisplay.Height)"
    }
    if (-not [GalleryDisplayApi]::SetWindowPos(
        $Process.MainWindowHandle,
        [IntPtr](-1),
        $primaryDisplay.X,
        $primaryDisplay.Y,
        $primaryDisplay.Width,
        $primaryDisplay.Height,
        [uint32]0x0040
    )) {
        throw "Could not place process $($Process.Id) above the taskbar for capture"
    }
    Start-Sleep -Milliseconds 900
}

function Save-ConfigPage([Diagnostics.Process]$Process, [string]$Path) {
    $Process.Refresh()
    $windows = [GalleryDisplayApi]::ProcessWindows($Process.Id) |
        Sort-Object @{ Expression = { [long]$_.Width * [long]$_.Height }; Descending = $true }
    if (-not $windows) { throw "Could not find CONFIG windows for process $($Process.Id): $Path" }
    $canvas = New-Object Drawing.Bitmap $primaryDisplay.Width, $primaryDisplay.Height
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.Clear([Drawing.Color]::White)
        foreach ($window in $windows) {
            $layer = New-Object Drawing.Bitmap $window.Width, $window.Height
            $layerGraphics = [Drawing.Graphics]::FromImage($layer)
            try {
                $deviceContext = $layerGraphics.GetHdc()
                try { [GalleryDisplayApi]::RenderWindow($window.Handle, $deviceContext) | Out-Null }
                finally { $layerGraphics.ReleaseHdc($deviceContext) }
                $graphics.DrawImageUnscaled(
                    $layer,
                    $window.X - $primaryDisplay.X,
                    $window.Y - $primaryDisplay.Y
                )
            }
            finally {
                $layerGraphics.Dispose()
                $layer.Dispose()
            }
        }
        $canvas.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $canvas.Dispose()
    }
}

function Wait-WebUiReady([string]$DataDirectory) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        foreach ($log in Get-ChildItem (Join-Path $DataDirectory 'logs') -File -ErrorAction SilentlyContinue) {
            if ((Get-Content -LiteralPath $log.FullName -Raw -ErrorAction SilentlyContinue) -match 'Web UI boot verified') { return }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw "HUB Web UI did not become ready: $DataDirectory"
}

function Stop-CaptureProcessTree([Diagnostics.Process]$Process, [string]$WorkDirectory) {
    if ($Process) {
        try { $Process.Refresh() } catch {}
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
            try { $Process.WaitForExit(10000) | Out-Null } catch {}
        }
    }
    $fullWorkDirectory = [IO.Path]::GetFullPath($WorkDirectory)
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $owned = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            ($_.ExecutablePath -and $_.ExecutablePath.StartsWith(
                $fullWorkDirectory + [IO.Path]::DirectorySeparatorChar,
                [StringComparison]::OrdinalIgnoreCase
            )) -or
            ($_.CommandLine -and $_.CommandLine.IndexOf($fullWorkDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        }
        if (-not $owned) { return }
        $owned | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 300
    }
    throw "Capture process tree did not exit: $fullWorkDirectory"
}

function Write-AppConfig([string]$DataDirectory, [string]$Language, [int]$Port, [string]$InjectJs, [bool]$FirstRunCompleted) {
    [ordered]@{
        ResolutionWidth = $primaryDisplay.Width
        ResolutionHeight = $primaryDisplay.Height
        Language = $Language
        FirstRunCompleted = $FirstRunCompleted
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$Port"
        Port = $Port
        NodePath = $systemNode
        RepoPath = $desktop
        ToolbarAutoHide = $true
        ToolbarEdgeReveal = $false
        ToolbarHotkey = 'F8'
        FullscreenHotkey = 'F11'
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $true
        AllowDesktopPlugins = $false
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = $InjectJs
        DevTools = $false
        ExternalLinksInBrowser = $true
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $DataDirectory 'config.json') -Encoding UTF8
}

function Write-HubConfig([string]$DataDirectory, [string]$Theme, [string]$DiscoverySource, [string]$DetailMode) {
    [ordered]@{
        Theme = $Theme
        StartPage = 'home'
        DiscoverySource = $DiscoverySource
        PageSize = 24
        DetailEntry = 'button'
        DetailMode = $DetailMode
        DetailContent = 'native'
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $true
        AllowDesktopPlugins = $false
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $DataDirectory 'hub-config.json') -Encoding UTF8
}

function Invoke-HubSnapshot(
    [string]$Language,
    [string]$Name,
    [string]$Section,
    [string]$DiscoverySource = 'dshmk',
    [string]$Theme = 'light',
    [string]$DetailMode = 'side',
    [bool]$OpenDetail = $false,
    [bool]$OpenFilters = $false
) {
    $directory = New-CaptureDirectory $Language 'hub'
    $image = Join-Path $directory ($Name + '.png')
    $work = New-TemporaryDirectory 'dsh-hub-gallery'
    $data = Join-Path $work 'data'
    $process = $null
    try {
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        Copy-LauncherFiles $work @('dsh-hub.exe', 'dsh.exe', 'dsh-config.exe')
        $inject = Join-Path $work 'capture-route.js'
        $languageJson = $Language | ConvertTo-Json -Compress
        $sectionJson = $Section | ConvertTo-Json -Compress
        $sourceIndex = if ($DiscoverySource -eq 'community') { 1 } elseif ($DiscoverySource -eq 'github') { 2 } else { 0 }
        $openDetailJson = if ($OpenDetail) { 'true' } else { 'false' }
        $openFiltersJson = if ($OpenFilters) { 'true' } else { 'false' }
        @"
(() => {
  const language = $languageJson
  try { Object.defineProperty(navigator, 'language', { configurable: true, get: () => language }) } catch {}
  try { Object.defineProperty(navigator, 'languages', { configurable: true, get: () => [language] }) } catch {}
  const targetSection = $sectionJson
  const sourceIndex = $sourceIndex
  const openDetail = $openDetailJson
  const openFilters = $openFiltersJson
  let sectionDone = false
  let sourceDone = targetSection !== 'github'
  let detailDone = !openDetail
  let filtersDone = !openFilters
  let attempts = 0
  const timer = setInterval(() => {
    attempts += 1
    if (!sectionDone) {
      const section = document.querySelector('button[data-section="' + targetSection + '"]')
      if (section instanceof HTMLButtonElement) { section.click(); sectionDone = true }
    }
    if (sectionDone && !sourceDone) {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
      const source = tabs[sourceIndex]
      if (source instanceof HTMLButtonElement) { source.click(); sourceDone = true }
    }
    if (sectionDone && sourceDone && !filtersDone) {
      const trigger = Array.from(document.querySelectorAll('button')).find(button =>
        button.getAttribute('aria-expanded') === 'false' && /筛选|Filters/i.test(button.textContent ?? ''))
      if (trigger instanceof HTMLButtonElement) { trigger.scrollIntoView({ block: 'center' }); trigger.click(); filtersDone = true }
    }
    if (sectionDone && sourceDone && !detailDone) {
      const detail = Array.from(document.querySelectorAll('button')).find(button => /项目详情|详情|Details/i.test(button.textContent ?? ''))
      if (detail instanceof HTMLButtonElement) { detail.scrollIntoView({ block: 'center' }); detail.click(); detailDone = true }
    }
    if ((sectionDone && sourceDone && detailDone && filtersDone) || attempts > 180) clearInterval(timer)
  }, 200)
})()
"@ | Set-Content -LiteralPath $inject -Encoding UTF8

        $port = Get-FreePort
        Write-AppConfig $data $Language $port $inject $true
        Write-HubConfig $data $Theme $DiscoverySource $DetailMode
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'GALLERY-' + [Guid]::NewGuid().ToString('N')
        $env:DEEPSEEK_HARNESS_OFFLINE = '1'
        $process = Start-Process (Join-Path $work 'dsh-hub.exe') -WorkingDirectory $work -PassThru
        Wait-MainWindow $process
        Wait-WebUiReady $data
        Expand-WindowToPrimaryDisplay $process
        Start-Sleep -Seconds $(if ($Section -eq 'github' -or $OpenDetail -or $OpenFilters) { 5 } else { 2 })
        & $windowControl screen $process.Id $image | Out-Null
        Write-Host "HUB $Language $Name -> $image"
    }
    finally {
        Stop-CaptureProcessTree $process $work
        Remove-VerifiedTemporaryDirectory $work
    }
}

function Invoke-HubGallery([string]$Language) {
    Invoke-HubSnapshot $Language '01-home' 'home'
    Invoke-HubSnapshot $Language '02-discovery-dshmk' 'github' 'dshmk'
    Invoke-HubSnapshot $Language '03-discovery-curated' 'github' 'community'
    Invoke-HubSnapshot $Language '04-discovery-github' 'github' 'github'
    Invoke-HubSnapshot $Language '05-reviewed-catalog' 'catalog'
    Invoke-HubSnapshot $Language '06-starred' 'starred'
    Invoke-HubSnapshot $Language '07-setup-library' 'library'
    Invoke-HubSnapshot $Language '08-offline-packages' 'offline'
    Invoke-HubSnapshot $Language '09-installed-setups' 'installed'
    Invoke-HubSnapshot $Language '10-setup-builder' 'builder'
    Invoke-HubSnapshot $Language '11-github-account' 'account'
    Invoke-HubSnapshot $Language '12-security' 'security'
    Invoke-HubSnapshot $Language '13-discovery-filters' 'github' 'dshmk' 'light' 'side' $false $true
    Invoke-HubSnapshot $Language '14-project-detail-side' 'github' 'dshmk' 'light' 'side' $true $false
    Invoke-HubSnapshot $Language '15-project-detail-modal-dark' 'github' 'dshmk' 'dark' 'modal' $true $false
}

function Invoke-ConfigControl(
    [Diagnostics.Process]$Process,
    [string[]]$Names,
    [bool]$SidebarOnly = $true
) {
    $Process.Refresh()
    if ($Process.MainWindowHandle -eq 0) { throw "CONFIG window is unavailable for automation" }
    $root = [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
    $sidebarRight = $primaryDisplay.X + [math]::Max(520, [int]($primaryDisplay.Width * 0.25))
    foreach ($name in $Names) {
        $condition = New-Object Windows.Automation.PropertyCondition(
            [Windows.Automation.AutomationElement]::NameProperty,
            $name
        )
        $matches = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
        $candidates = for ($index = 0; $index -lt $matches.Count; $index++) {
            $element = $matches.Item($index)
            $current = $element.Current
            $bounds = $current.BoundingRectangle
            if ($current.IsOffscreen -or $current.NativeWindowHandle -eq 0 -or $bounds.Width -le 1 -or $bounds.Height -le 1) { continue }
            if ($current.ClassName -like 'WindowsForms10.STATIC*') { continue }
            if ($SidebarOnly -and $bounds.Left -ge $sidebarRight) { continue }
            [pscustomobject]@{
                Handle = [IntPtr]$current.NativeWindowHandle
                X = $bounds.Left
                Y = $bounds.Top
            }
        }
        $target = $candidates | Sort-Object X, Y | Select-Object -First 1
        if ($target -and [GalleryDisplayApi]::PressEnter($target.Handle)) { return }
    }
    throw "Could not invoke CONFIG control: $($Names -join ' / ')"
}

function Invoke-ConfigMode([string]$Language, [bool]$HubMode) {
    $directory = New-CaptureDirectory $Language 'config'
    $work = New-TemporaryDirectory 'dsh-config-gallery'
    $data = Join-Path $work 'data'
    $process = $null
    try {
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        Copy-LauncherFiles $work @('dsh-config.exe')
        Write-AppConfig $data $Language 3080 '' $true
        Write-HubConfig $data 'system' 'dshmk' 'side'
        $arguments = if ($HubMode) { '--hub' } else { '' }
        $process = Start-Process (Join-Path $work 'dsh-config.exe') -WorkingDirectory $work -ArgumentList $arguments -PassThru
        Wait-MainWindow $process
        Expand-WindowToPrimaryDisplay $process
        Start-Sleep -Seconds 1
        if ($HubMode) {
            Save-ConfigPage $process (Join-Path $directory '05-hub-appearance.png')
            Invoke-ConfigControl $process @('HUB Startup', 'HUB 启动')
            Start-Sleep -Milliseconds 700
            Save-ConfigPage $process (Join-Path $directory '06-hub-startup.png')
            Invoke-ConfigControl $process @('DSH HUB')
            Start-Sleep -Milliseconds 500
            Save-ConfigPage $process (Join-Path $directory '07-hub-target-switcher.png')
        }
        else {
            Save-ConfigPage $process (Join-Path $directory '01-display.png')
            Invoke-ConfigControl $process @('Server', '服务')
            Start-Sleep -Milliseconds 700
            Save-ConfigPage $process (Join-Path $directory '02-server.png')
            Invoke-ConfigControl $process @('Extensions & Dev', 'Extensions  Dev', '扩展与开发')
            Start-Sleep -Milliseconds 700
            Save-ConfigPage $process (Join-Path $directory '03-extensions-and-dev.png')
            Invoke-ConfigControl $process @('DeepSeek Harness')
            Start-Sleep -Milliseconds 500
            Save-ConfigPage $process (Join-Path $directory '04-desktop-target-switcher.png')
        }
        Write-Host "CONFIG $Language $(if ($HubMode) { 'hub' } else { 'desktop' }) captured"
    }
    finally {
        Stop-CaptureProcessTree $process $work
        Remove-VerifiedTemporaryDirectory $work
    }
}

function Invoke-ConfigLanguagePrompt([string]$Language) {
    $directory = New-CaptureDirectory $Language 'config'
    $work = New-TemporaryDirectory 'dsh-config-language-gallery'
    $data = Join-Path $work 'data'
    $process = $null
    try {
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        Copy-LauncherFiles $work @('dsh-config.exe')
        Write-AppConfig $data $Language 3080 '' $false
        Write-HubConfig $data 'system' 'dshmk' 'side'
        $process = Start-Process (Join-Path $work 'dsh-config.exe') -WorkingDirectory $work -PassThru
        Wait-MainWindow $process
        Expand-WindowToPrimaryDisplay $process
        Start-Sleep -Seconds 2
        Save-ConfigPage $process (Join-Path $directory '00-language-selection.png')
        Write-Host "CONFIG $Language language prompt captured"
    }
    finally {
        Stop-CaptureProcessTree $process $work
        Remove-VerifiedTemporaryDirectory $work
    }
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class GalleryWindowInfo {
    public IntPtr Handle { get; set; }
    public uint ProcessId { get; set; }
    public string Text { get; set; }
    public string ClassName { get; set; }
    public bool Enabled { get; set; }
}

public static class GalleryWindowApi {
    public const uint BM_CLICK = 0x00F5;
    public const uint BM_GETCHECK = 0x00F0;
    public const uint SMTO_ABORTIFHUNG = 0x0002;
    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);
    private static int installingGateState;
    private static int installingGateProcessId;

    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("ntdll.dll")] private static extern int NtSuspendProcess(IntPtr processHandle);
    [DllImport("ntdll.dll")] private static extern int NtResumeProcess(IntPtr processHandle);

    private static string ReadText(IntPtr window) {
        int length = GetWindowTextLength(window);
        StringBuilder text = new StringBuilder(Math.Max(length + 1, 512));
        GetWindowText(window, text, text.Capacity);
        return text.ToString();
    }

    private static string ReadClass(IntPtr window) {
        StringBuilder text = new StringBuilder(256);
        GetClassName(window, text, text.Capacity);
        return text.ToString();
    }

    private static GalleryWindowInfo Describe(IntPtr window) {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        return new GalleryWindowInfo { Handle = window, ProcessId = processId, Text = ReadText(window), ClassName = ReadClass(window), Enabled = IsWindowEnabled(window) };
    }

    public static GalleryWindowInfo[] TopWindows() {
        List<GalleryWindowInfo> windows = new List<GalleryWindowInfo>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) windows.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static GalleryWindowInfo[] Children(IntPtr parent) {
        List<GalleryWindowInfo> windows = new List<GalleryWindowInfo>();
        EnumChildWindows(parent, delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) windows.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static void ArmInstallingGate(int processId, IntPtr parent) {
        ResumeInstallingGate();
        installingGateProcessId = processId;
        Volatile.Write(ref installingGateState, 1);
        Thread watcher = new Thread(delegate() {
            DateTime deadline = DateTime.UtcNow.AddMinutes(10);
            while (Volatile.Read(ref installingGateState) == 1 && DateTime.UtcNow < deadline) {
                foreach (GalleryWindowInfo control in Children(parent)) {
                    string text = (control.Text ?? string.Empty).Replace("&", string.Empty).Trim();
                    if (!text.StartsWith("Installing", StringComparison.Ordinal) && !text.StartsWith("正在安装", StringComparison.Ordinal)) continue;
                    try {
                        using (Process process = Process.GetProcessById(processId)) {
                            if (NtSuspendProcess(process.Handle) == 0) Volatile.Write(ref installingGateState, 2);
                        }
                    }
                    catch { Volatile.Write(ref installingGateState, 0); }
                    return;
                }
                Thread.Sleep(1);
            }
            if (Volatile.Read(ref installingGateState) == 1) Volatile.Write(ref installingGateState, 0);
        });
        watcher.IsBackground = true;
        watcher.Start();
    }

    public static bool InstallingGateSuspended() { return Volatile.Read(ref installingGateState) == 2; }

    public static void ResumeInstallingGate() {
        if (Volatile.Read(ref installingGateState) == 2 && installingGateProcessId > 0) {
            try {
                using (Process process = Process.GetProcessById(installingGateProcessId)) {
                    NtResumeProcess(process.Handle);
                }
            }
            catch { }
        }
        installingGateProcessId = 0;
        Volatile.Write(ref installingGateState, 0);
    }

    public static bool Click(IntPtr window, uint timeout) {
        IntPtr result;
        if (SendMessageTimeout(window, BM_CLICK, IntPtr.Zero, IntPtr.Zero, SMTO_ABORTIFHUNG, timeout, out result) != IntPtr.Zero) return true;
        return PostMessage(window, BM_CLICK, IntPtr.Zero, IntPtr.Zero);
    }

    public static bool ClickAsync(IntPtr window) { return PostMessage(window, BM_CLICK, IntPtr.Zero, IntPtr.Zero); }

    public static int CheckState(IntPtr window) { return SendMessage(window, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero).ToInt32(); }
}
'@

function Wait-SetupWindow([datetime]$Deadline, [datetime]$StartedAt) {
    while ((Get-Date) -lt $Deadline) {
        foreach ($window in [GalleryWindowApi]::TopWindows()) {
            if ($window.Text -notmatch 'DeepSeek Harness|安装语言|Setup Language') { continue }
            $candidate = Get-Process -Id $window.ProcessId -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.StartTime -ge $StartedAt.AddSeconds(-2)) { return $window }
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Setup did not create a wizard window.'
}

function Click-MatchingSetupControl(
    [GalleryWindowInfo[]]$Controls,
    [string[]]$Patterns,
    [int]$ProcessId,
    [switch]$Asynchronous
) {
    foreach ($pattern in $Patterns) {
        $control = $Controls |
            Where-Object {
                $_.Enabled -and
                $_.ClassName -match 'Button$' -and
                ($_.Text -replace '&', '') -match $pattern
            } |
            Select-Object -First 1
        if ($control) {
            if ($control.ClassName -match 'RadioButton|CheckBox') {
                $clicked = [GalleryWindowApi]::Click($control.Handle, 750)
                Start-Sleep -Milliseconds 80
                $clicked = $clicked -and [GalleryWindowApi]::CheckState($control.Handle) -ne 0
            }
            elseif ($Asynchronous) {
                $clicked = [GalleryWindowApi]::ClickAsync($control.Handle)
            }
            else {
                & $windowControl btn $ProcessId $control.Text | Out-Null
                $clicked = $LASTEXITCODE -eq 0 -or [GalleryWindowApi]::Click($control.Handle, 750)
            }
            if (-not $clicked) {
                throw "Setup control did not respond: $($control.Text)"
            }
            return $true
        }
    }
    return $false
}

function Get-SetupPageName([string]$Text) {
    if ($Text -match 'Welcome to DeepSeek Harness|欢迎使用 DeepSeek Harness') { return '01-welcome' }
    if ($Text -match 'License Agreement|许可协议') { return '02-license' }
    if ($Text -match 'Choose an installation method|选择安装方式') { return '03-installation-method' }
    if ($Text -match 'Application data|应用数据') { return '05-application-data' }
    if ($Text -match 'Runtime source|运行时来源') { return '06-runtime-source' }
    if ($Text -match 'Local Runtime ZIP|本地 Runtime ZIP') { return '07-local-runtime-zip' }
    if ($Text -match 'Existing Runtime folder|已有 Runtime 文件夹') { return '08-existing-runtime-folder' }
    if ($Text -match 'Source ZIP build|源码 ZIP 构建') { return '09-source-zip-build' }
    if ($Text -match 'Computer check|电脑检查|System and environment|系统与运行环境') { return '10-computer-check' }
    if ($Text -match 'Preparing DeepSeek Harness|正在准备 DeepSeek Harness|Step [1-5] of 5|第 [1-5]/5 步') { return '12-preparation' }
    if ($Text -match 'Ready to Install|准备安装') { return '11-ready-to-install' }
    if ($Text -match '(?m)^(Installing|正在安装)$') { return '13-installing' }
    if ($Text -match 'DeepSeek Harness is installed|完成 DeepSeek Harness 安装向导|Completing the DeepSeek Harness') { return '14-finished' }
    if ($Text -match 'Select Destination Location|选择目标位置|安装程序将安装') { return '04-install-location' }
    if ($Text -match 'Select Start Menu Folder|选择开始菜单文件夹') { return '09a-start-menu-folder' }
    if ($Text -match 'Select Additional Tasks|选择附加任务') { return '09b-additional-tasks' }
    return $null
}

function Save-SetupPage([int]$ProcessId, [string]$Directory, [string]$PageName, [hashtable]$Seen) {
    if ([string]::IsNullOrWhiteSpace($PageName) -or $Seen.ContainsKey($PageName)) { return }
    Start-Sleep -Milliseconds $(if ($PageName -eq '13-installing') { 0 } elseif ($PageName -eq '12-preparation') { 40 } else { 350 })
    $path = Join-Path $Directory ($PageName + '.png')
    & $windowControl screen $ProcessId $path | Out-Null
    $Seen[$PageName] = $true
    Write-Host "SETUP $PageName -> $path"
}

function Stop-InstalledProcesses([string]$Root) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Invoke-SetupRecommendedFlow([string]$Language, [string]$InnoLanguage) {
    $directory = New-CaptureDirectory $Language 'setup'
    $work = New-TemporaryDirectory 'dsh-setup-gallery'
    $installPath = Join-Path $work 'install'
    $localAppData = Join-Path $work 'localappdata'
    $logPath = Join-Path $work 'setup.log'
    $previousLocalAppData = $env:LOCALAPPDATA
    $env:LOCALAPPDATA = $localAppData
    $process = $null
    $wizard = $null
    $seen = @{}
    $deadline = (Get-Date).AddMinutes(35)
    $nextClickAllowedAt = [datetime]::MinValue
    try {
        $arguments = '/LANG=' + $InnoLanguage + ' /NORESTART /TASKS=""' +
            ' /DIR="' + $installPath + '" /DATAMODE=portable /RUNTIMEMODE=bundled' +
            ' /LOG="' + $logPath + '"'
        $startedAt = Get-Date
        $process = Start-Process $setupPath -ArgumentList $arguments -PassThru
        $window = Wait-SetupWindow $deadline $startedAt
        $wizard = Get-Process -Id $window.ProcessId
        Expand-WindowToPrimaryDisplay $wizard
        while ((Get-Date) -lt $deadline) {
            $wizard.Refresh()
            if ($wizard.HasExited) { break }
            $controls = [GalleryWindowApi]::Children($window.Handle)
            $visibleText = ($controls | Where-Object Text | ForEach-Object Text) -join [Environment]::NewLine
            $pageName = Get-SetupPageName $visibleText
            if ($pageName -eq '12-preparation' -and -not $seen.ContainsKey('12-preparation')) {
                [GalleryWindowApi]::ArmInstallingGate($wizard.Id, $window.Handle)
            }
            Save-SetupPage $wizard.Id $directory $pageName $seen

            if ($pageName -eq '12-preparation' -and -not $seen.ContainsKey('13-installing')) {
                $installingDeadline = (Get-Date).AddMinutes(10)
                while (-not [GalleryWindowApi]::InstallingGateSuspended() -and (Get-Date) -lt $installingDeadline) {
                    Start-Sleep -Milliseconds 2
                }
                if (-not [GalleryWindowApi]::InstallingGateSuspended()) {
                    throw "Setup did not expose the native installing page for $Language"
                }
                try { Save-SetupPage $wizard.Id $directory '13-installing' $seen }
                finally { [GalleryWindowApi]::ResumeInstallingGate() }
                continue
            }

            if ($pageName -eq '10-computer-check' -and $visibleText -notmatch 'All checks passed|全部检查通过|检查已通过|Click Next|点击.下一步') {
                Start-Sleep -Milliseconds 200
                continue
            }

            if ($pageName -eq '14-finished') {
                foreach ($launch in $controls | Where-Object { $_.Text -match 'Launch DeepSeek Harness|启动 DeepSeek Harness' }) {
                    if ([GalleryWindowApi]::CheckState($launch.Handle) -ne 0) { [GalleryWindowApi]::Click($launch.Handle, 750) | Out-Null }
                }
                if ((Get-Date) -ge $nextClickAllowedAt -and (Click-MatchingSetupControl $controls @('^Finish\b|^完成') $wizard.Id)) {
                    $nextClickAllowedAt = (Get-Date).AddMilliseconds(500)
                }
            }
            elseif ($pageName -notin @('12-preparation', '13-installing') -and (Get-Date) -ge $nextClickAllowedAt) {
                Click-MatchingSetupControl $controls @('I accept|我同意') $wizard.Id | Out-Null
                if ($pageName -eq '11-ready-to-install') {
                    $clicked = Click-MatchingSetupControl $controls @('^Install\b|^安装') $wizard.Id -Asynchronous
                }
                else {
                    $clicked = Click-MatchingSetupControl $controls @(
                        '^Next\b|^下一步',
                        '^Finish\b|^完成'
                    ) $wizard.Id
                }
                if ($clicked) { $nextClickAllowedAt = (Get-Date).AddMilliseconds(500) }
            }
            $pollDelay = if ($seen.ContainsKey('12-preparation') -and -not $seen.ContainsKey('13-installing')) { 10 } else { 100 }
            Start-Sleep -Milliseconds $pollDelay
        }
        if (-not $wizard.HasExited) { throw "Setup gallery timed out for $Language" }
        if (-not $process.WaitForExit(10000)) { throw "Setup bootstrap did not exit for $Language" }
        if ($process.ExitCode -ne 0) { throw "Setup exited with code $($process.ExitCode): $logPath" }
        foreach ($requiredPage in @('01-welcome', '02-license', '03-installation-method', '10-computer-check', '11-ready-to-install', '12-preparation', '13-installing', '14-finished')) {
            if (-not $seen.ContainsKey($requiredPage)) { throw "Setup page was not captured for ${Language}: $requiredPage" }
        }
    }
    finally {
        [GalleryWindowApi]::ResumeInstallingGate()
        $env:LOCALAPPDATA = $previousLocalAppData
        if ($process) {
            try { $process.Refresh() } catch {}
            if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
        }
        if ($wizard) {
            try { $wizard.Refresh() } catch {}
            if (-not $wizard.HasExited) { & taskkill.exe /PID $wizard.Id /T /F | Out-Null }
        }
        Stop-InstalledProcesses $installPath
        $uninstaller = Join-Path $installPath 'unins000.exe'
        if (Test-Path -LiteralPath $uninstaller) {
            Start-Process $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait | Out-Null
        }
        Remove-VerifiedTemporaryDirectory $work
    }
}

function Invoke-SetupAdvancedBranch([string]$Language, [string]$InnoLanguage, [string]$Branch) {
    $directory = New-CaptureDirectory $Language 'setup'
    $work = New-TemporaryDirectory 'dsh-setup-advanced-gallery'
    $installPath = Join-Path $work 'install'
    $process = $null
    $wizard = $null
    $seen = @{}
    $deadline = (Get-Date).AddMinutes(5)
    $nextClickAllowedAt = [datetime]::MinValue
    $branchPage = if ($Branch -eq 'archive') { '07-local-runtime-zip' } elseif ($Branch -eq 'folder') { '08-existing-runtime-folder' } else { '09-source-zip-build' }
    try {
        $arguments = '/LANG=' + $InnoLanguage + ' /NORESTART /TASKS="" /ADVANCED=1' +
            ' /RUNTIMEMODE=' + $Branch + ' /DIR="' + $installPath + '"'
        $startedAt = Get-Date
        $process = Start-Process $setupPath -ArgumentList $arguments -PassThru
        $window = Wait-SetupWindow $deadline $startedAt
        $wizard = Get-Process -Id $window.ProcessId
        Expand-WindowToPrimaryDisplay $wizard
        while ((Get-Date) -lt $deadline) {
            $wizard.Refresh()
            if ($wizard.HasExited) { break }
            $controls = [GalleryWindowApi]::Children($window.Handle)
            $visibleText = ($controls | Where-Object Text | ForEach-Object Text) -join [Environment]::NewLine
            $pageName = Get-SetupPageName $visibleText
            Save-SetupPage $wizard.Id $directory $pageName $seen
            if ($pageName -eq $branchPage) { return }
            if ((Get-Date) -ge $nextClickAllowedAt) {
                Click-MatchingSetupControl $controls @('I accept|我同意') $wizard.Id | Out-Null
                if ($pageName -eq '03-installation-method') {
                    Click-MatchingSetupControl $controls @('Advanced options|高级选项') $wizard.Id | Out-Null
                }
                if (Click-MatchingSetupControl $controls @('^Next\b|^下一步') $wizard.Id) {
                    $nextClickAllowedAt = (Get-Date).AddMilliseconds(500)
                }
            }
            Start-Sleep -Milliseconds 100
        }
        throw "Advanced Setup branch did not reach $branchPage for $Language"
    }
    finally {
        if ($process) {
            try { $process.Refresh() } catch {}
            if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
        }
        if ($wizard) {
            try { $wizard.Refresh() } catch {}
            if (-not $wizard.HasExited) { & taskkill.exe /PID $wizard.Id /T /F | Out-Null }
        }
        Remove-VerifiedTemporaryDirectory $work
    }
}

try {
    foreach ($language in $Languages) {
        if (-not $SkipHub) { Invoke-HubGallery $language }
        if (-not $SkipConfig) {
            Invoke-ConfigLanguagePrompt $language
            Invoke-ConfigMode $language $false
            Invoke-ConfigMode $language $true
        }
        if (-not $SkipSetup) {
            $innoLanguage = if ($language -eq 'zh-CN') { 'chinesesimp' } else { 'english' }
            if (-not $SkipRecommendedSetup) { Invoke-SetupRecommendedFlow $language $innoLanguage }
            if (-not $SkipAdvancedSetup) {
                Invoke-SetupAdvancedBranch $language $innoLanguage 'archive'
                Invoke-SetupAdvancedBranch $language $innoLanguage 'folder'
                Invoke-SetupAdvancedBranch $language $innoLanguage 'source'
            }
        }
    }
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_OFFLINE = $previousOffline
}

$images = Get-ChildItem -LiteralPath $output -Recurse -Filter '*.png' -File | Sort-Object FullName
[pscustomobject]@{
    OutputDirectory = $output
    ImageCount = $images.Count
    Bytes = ($images | Measure-Object Length -Sum).Sum
}
