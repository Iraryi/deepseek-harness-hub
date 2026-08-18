param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-taskbar-' + [Guid]::NewGuid().ToString('N'))
$data = Join-Path $work 'data'
$previousData = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousHome = $env:DSH_HOME
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$desktop = $null
$hub = $null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshTaskbarProbe {
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    public static extern IntPtr GetWindowLongPtr(IntPtr window, int index);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr window, uint command);
}
'@

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

function Wait-MainWindow([Diagnostics.Process]$Process, [string]$Name) {
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $Process.Refresh()
        if ($Process.MainWindowHandle -ne 0) { return }
        Start-Sleep -Milliseconds 150
    } while ((Get-Date) -lt $deadline)
    throw "$Name main window did not appear"
}

try {
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $port = Get-FreePort
    [ordered]@{
        ResolutionWidth = 1100
        ResolutionHeight = 760
        Language = 'zh-CN'
        FirstRunCompleted = $true
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$port"
        Port = $port
        NodePath = (Get-Command node.exe -ErrorAction Stop).Source
        RepoPath = $repository
        ToolbarAutoHide = $true
        ToolbarEdgeReveal = $false
        ToolbarHotkey = 'F8'
        FullscreenHotkey = 'F11'
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $true
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = ''
        DevTools = $false
        ExternalLinksInBrowser = $true
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'config.json') -Encoding UTF8
    [ordered]@{
        Theme = 'system'
        StartPage = 'home'
        DiscoverySource = 'dshmk'
        PageSize = 24
        DetailMode = 'side'
        DetailContent = 'native'
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $true
        AllowDesktopPlugins = $false
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'hub-config.json') -Encoding UTF8

    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $data 'dsh-home'
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'TASKBAR-' + [Guid]::NewGuid().ToString('N')
    $desktop = Start-Process -FilePath (Join-Path $launcher 'dsh.exe') -WorkingDirectory $launcher -WindowStyle Normal -PassThru
    $hub = Start-Process -FilePath (Join-Path $launcher 'dsh-hub.exe') -WorkingDirectory $launcher -WindowStyle Normal -PassThru
    Wait-MainWindow $desktop 'Desktop'
    Wait-MainWindow $hub 'HUB'
    Start-Sleep -Milliseconds 700

    $appWindowStyle = 0x00040000L
    $toolWindowStyle = 0x00000080L
    $rows = foreach ($entry in @(
        [pscustomobject]@{ Name = 'Desktop'; Process = $desktop },
        [pscustomobject]@{ Name = 'HUB'; Process = $hub }
    )) {
        $entry.Process.Refresh()
        $window = $entry.Process.MainWindowHandle
        $style = [DshTaskbarProbe]::GetWindowLongPtr($window, -20).ToInt64()
        [pscustomobject]@{
            Name = $entry.Name
            ProcessId = $entry.Process.Id
            Title = $entry.Process.MainWindowTitle
            AppWindow = ($style -band $appWindowStyle) -ne 0
            ToolWindow = ($style -band $toolWindowStyle) -ne 0
            OwnerIsZero = [DshTaskbarProbe]::GetWindow($window, 4) -eq [IntPtr]::Zero
        }
    }

    if (@($rows | Where-Object { -not $_.AppWindow -or $_.ToolWindow -or -not $_.OwnerIsZero }).Count -ne 0) {
        throw 'A launcher window is not eligible for an independent taskbar button'
    }
    if ($desktop.Id -eq $hub.Id -or $desktop.MainWindowHandle -eq $hub.MainWindowHandle) {
        throw 'Desktop and HUB did not remain independent windows'
    }
    $rows
}
finally {
    foreach ($process in @($hub, $desktop)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            try { $process.WaitForExit(10000) | Out-Null } catch { }
        }
    }
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousData
    $env:DSH_HOME = $previousHome
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $resolvedWork = [IO.Path]::GetFullPath($work)
    $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if ($resolvedWork.StartsWith($resolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedWork)) {
        Remove-Item -LiteralPath $resolvedWork -Recurse -Force -ErrorAction SilentlyContinue
    }
}
