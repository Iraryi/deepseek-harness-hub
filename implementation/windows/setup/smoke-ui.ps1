param(
    [string]$Setup = "$PSScriptRoot\dist\DeepSeek-Harness-Setup-Full-0.1.0-rc.6-win-x64.exe",
    [int]$ResponseTimeoutMilliseconds = 500,
    [int]$OverallTimeoutMinutes = 35,
    [switch]$StopAtCheck
)

$ErrorActionPreference = 'Stop'
$setupPath = [IO.Path]::GetFullPath($Setup)
if (-not (Test-Path $setupPath)) { throw "Setup UI smoke input is missing: $setupPath" }

$dist = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$testRoot = [IO.Path]::GetFullPath((Join-Path $dist ('smoke-ui-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))))
if (-not $testRoot.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Setup UI smoke root must stay under $dist"
}
New-Item -ItemType Directory -Path $testRoot | Out-Null

$installPath = Join-Path $testRoot 'Responsive Install'
$localAppData = Join-Path $testRoot 'localappdata'
$logPath = Join-Path $testRoot 'setup.log'
$checkScreenshotPath = Join-Path $testRoot 'computer-check-page.png'
$preparationScreenshotPath = Join-Path $testRoot 'preparation-page.png'
$previousLocalAppData = $env:LOCALAPPDATA
$env:LOCALAPPDATA = $localAppData

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class SetupWindowInfo {
    public IntPtr Handle { get; set; }
    public uint ProcessId { get; set; }
    public string Text { get; set; }
    public string ClassName { get; set; }
    public bool Enabled { get; set; }
}

public static class SetupWindowApi {
    public const uint BM_CLICK = 0x00F5;
    public const uint BM_GETCHECK = 0x00F0;
    public const uint WM_NULL = 0x0000;
    public const uint SMTO_ABORTIFHUNG = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    private delegate bool EnumWindowProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowProc callback, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder text, int length);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam,
        uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr window, out RECT rectangle);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr window, IntPtr target, uint flags);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    public static void EnableDpiAwareness() { SetProcessDPIAware(); }

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

    private static SetupWindowInfo Describe(IntPtr window) {
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        return new SetupWindowInfo {
            Handle = window,
            ProcessId = processId,
            Text = ReadText(window),
            ClassName = ReadClass(window),
            Enabled = IsWindowEnabled(window)
        };
    }

    public static SetupWindowInfo[] TopWindows() {
        List<SetupWindowInfo> windows = new List<SetupWindowInfo>();
        EnumWindows(delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) windows.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static SetupWindowInfo[] Children(IntPtr parent) {
        List<SetupWindowInfo> windows = new List<SetupWindowInfo>();
        EnumChildWindows(parent, delegate(IntPtr window, IntPtr parameter) {
            if (IsWindowVisible(window)) windows.Add(Describe(window));
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static bool Click(IntPtr window, uint timeout) {
        IntPtr result;
        return SendMessageTimeout(window, BM_CLICK, IntPtr.Zero, IntPtr.Zero,
            SMTO_ABORTIFHUNG, timeout, out result) != IntPtr.Zero;
    }

    public static int CheckState(IntPtr window) {
        return SendMessage(window, BM_GETCHECK, IntPtr.Zero, IntPtr.Zero).ToInt32();
    }

    public static bool Ping(IntPtr window, uint timeout) {
        IntPtr result;
        return SendMessageTimeout(window, WM_NULL, IntPtr.Zero, IntPtr.Zero,
            SMTO_ABORTIFHUNG, timeout, out result) != IntPtr.Zero;
    }
}
'@
[SetupWindowApi]::EnableDpiAwareness()

function Wait-SetupWindow([datetime]$Deadline, [datetime]$StartedAt) {
    while ((Get-Date) -lt $Deadline) {
        foreach ($window in [SetupWindowApi]::TopWindows()) {
            if ($window.Text -notmatch 'DeepSeek Harness') { continue }
            $candidate = Get-Process -Id $window.ProcessId -ErrorAction SilentlyContinue
            if ($candidate -and $candidate.StartTime -ge $StartedAt.AddSeconds(-2)) { return $window }
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Setup did not create its wizard window'
}

function Save-WindowScreenshot([IntPtr]$Window, [string]$Path) {
    $rectangle = [SetupWindowApi+RECT]::new()
    if (-not [SetupWindowApi]::GetWindowRect($Window, [ref]$rectangle)) { throw 'Could not read Setup window rectangle' }
    $width = $rectangle.Right - $rectangle.Left
    $height = $rectangle.Bottom - $rectangle.Top
    if ($width -le 0 -or $height -le 0) { throw 'Setup window has an invalid rectangle' }
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $target = $graphics.GetHdc()
        try {
            if (-not [SetupWindowApi]::PrintWindow($Window, $target, 2)) {
                throw 'Could not render the Setup window'
            }
        }
        finally {
            $graphics.ReleaseHdc($target)
        }
        $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Click-MatchingControl([SetupWindowInfo[]]$Controls, [string[]]$Patterns) {
    foreach ($pattern in $Patterns) {
        $control = $Controls | Where-Object {
            $_.Enabled -and $_.Text -match $pattern
        } | Select-Object -First 1
        if ($control) {
            if (-not [SetupWindowApi]::Click($control.Handle, [uint32]$ResponseTimeoutMilliseconds)) {
                throw "Setup control did not respond: $($control.Text)"
            }
            return $true
        }
    }
    return $false
}

function Stop-InstalledProcesses([string]$Root) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$arguments = '/LANG=chinesesimp /NORESTART /TASKS=""' +
    ' /DIR="' + $installPath + '"' +
    ' /DATAMODE=portable /RUNTIMEMODE=bundled' +
    ' /LOG="' + $logPath + '"'
$process = $null
$wizardProcess = $null
$checkPageSeen = $false
$privateNodeMessageSeen = $false
$preparationSeen = $false
$progressSeen = $false
$responsiveSamples = 0
$hungSamples = 0
$maximumResponseMilliseconds = 0
$deadline = (Get-Date).AddMinutes($OverallTimeoutMinutes)
$nextClickAllowedAt = [datetime]::MinValue

try {
    $startedAt = Get-Date
    $process = Start-Process $setupPath -ArgumentList $arguments -PassThru
    $windowInfo = Wait-SetupWindow $deadline $startedAt
    $wizardProcess = Get-Process -Id $windowInfo.ProcessId
    $window = $windowInfo.Handle

    while ((Get-Date) -lt $deadline) {
        $wizardProcess.Refresh()
        if ($wizardProcess.HasExited) { break }
        $controls = [SetupWindowApi]::Children($window)
        $visibleText = ($controls | Where-Object Text | ForEach-Object Text) -join [Environment]::NewLine
        $isPreparationPage = $visibleText -match '正在准备 DeepSeek Harness|Preparing DeepSeek Harness|第 3/5 步|Step 3 of 5'

        if ($visibleText -match '电脑检查|Computer check|系统与运行环境|System and environment') {
            $checkPageSeen = $true
            $privateNodeMessageSeen = $privateNodeMessageSeen -or
                $visibleText -match '私有 Node.js|private Node.js'
            if (-not (Test-Path $checkScreenshotPath)) { Save-WindowScreenshot $window $checkScreenshotPath }
            if ($StopAtCheck) {
                [pscustomobject]@{
                    Setup = $setupPath
                    ComputerCheckScreenshot = $checkScreenshotPath
                    PrivateNodeMessageSeen = $privateNodeMessageSeen
                }
                return
            }
        }

        if ($isPreparationPage) {
            $preparationSeen = $true
            $progressSeen = $progressSeen -or @($controls | Where-Object { $_.ClassName -match 'progress' }).Count -gt 0
            $stopwatch = [Diagnostics.Stopwatch]::StartNew()
            $responsive = [SetupWindowApi]::Ping($window, [uint32]$ResponseTimeoutMilliseconds)
            $stopwatch.Stop()
            $maximumResponseMilliseconds = [Math]::Max($maximumResponseMilliseconds, [int]$stopwatch.ElapsedMilliseconds)
            if ($responsive) { $responsiveSamples++ } else { $hungSamples++ }
            if (-not (Test-Path $preparationScreenshotPath)) { Save-WindowScreenshot $window $preparationScreenshotPath }
        }
        elseif ((Get-Date) -ge $nextClickAllowedAt) {
            Click-MatchingControl $controls @('我接受|I accept') | Out-Null
            foreach ($launch in $controls | Where-Object { $_.Text -match '启动 DeepSeek Harness|Launch DeepSeek Harness' }) {
                if ([SetupWindowApi]::CheckState($launch.Handle) -ne 0) {
                    [SetupWindowApi]::Click($launch.Handle, [uint32]$ResponseTimeoutMilliseconds) | Out-Null
                }
            }
            $clicked = Click-MatchingControl $controls @(
                '^安装(?:\(&.\))?|^Install\b',
                '^下一步(?:\(&.\))?|^Next\b',
                '^完成(?:\(&.\))?|^Finish\b'
            )
            if ($clicked) { $nextClickAllowedAt = (Get-Date).AddMilliseconds(400) }
        }

        Start-Sleep -Milliseconds 100
    }

    if (-not $wizardProcess.HasExited) { throw "Setup UI smoke timed out after $OverallTimeoutMinutes minutes" }
    if (-not $process.WaitForExit(10000)) { throw 'Setup bootstrap process did not exit' }
    if ($process.ExitCode -ne 0) { throw "Setup exited with code $($process.ExitCode). Log: $logPath" }
    if (-not $checkPageSeen) { throw 'Setup never displayed the computer-check page' }
    if (-not $privateNodeMessageSeen) { throw 'Computer-check page did not explain the bundled private Node.js' }
    if (-not $preparationSeen) { throw 'Setup never displayed the live preparation page' }
    if (-not $progressSeen) { throw 'Setup preparation page did not expose progress feedback' }
    if ($responsiveSamples -lt 10) { throw "Setup preparation completed before enough response samples were collected: $responsiveSamples" }
    if ($hungSamples -ne 0) { throw "Setup stopped responding during preparation: $hungSamples timed-out samples" }
    if (-not (Test-Path (Join-Path $installPath 'dsh.exe'))) { throw 'Setup UI smoke completed without installing dsh.exe' }
    if (-not (Test-Path (Join-Path $installPath 'dsh-hub.exe'))) { throw 'Setup UI smoke completed without installing dsh-hub.exe' }

    [pscustomobject]@{
        Setup = $setupPath
        InstallPath = $installPath
        Log = $logPath
        ComputerCheckScreenshot = $checkScreenshotPath
        PreparationScreenshot = $preparationScreenshotPath
        ResponsiveSamples = $responsiveSamples
        HungSamples = $hungSamples
        MaximumResponseMilliseconds = $maximumResponseMilliseconds
    }
}
finally {
    $env:LOCALAPPDATA = $previousLocalAppData
    if ($process) {
        try { $process.Refresh() } catch {}
        if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    }
    if ($wizardProcess) {
        try { $wizardProcess.Refresh() } catch {}
        if (-not $wizardProcess.HasExited) { & taskkill.exe /PID $wizardProcess.Id /T /F | Out-Null }
    }
    Stop-InstalledProcesses $installPath
    $uninstaller = Join-Path $installPath 'unins000.exe'
    if (Test-Path $uninstaller) {
        $uninstall = Start-Process $uninstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { Write-Warning "Setup UI smoke cleanup failed: $($uninstall.ExitCode)" }
    }
}
