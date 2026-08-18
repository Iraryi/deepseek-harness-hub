$ErrorActionPreference = 'Stop'

$launcherRoot = $PSScriptRoot
$repository = Split-Path (Split-Path $launcherRoot -Parent) -Parent
$work = Join-Path (Split-Path $repository -Parent) 'work'
$dist = Join-Path $launcherRoot 'dist-check'
$windowControl = Join-Path $work 'winctl.exe'
$previousInstanceScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'SMOKE-' + [Guid]::NewGuid().ToString('N')

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopSmokeWindows {
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
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

function New-SmokeDirectory([string]$name, [int]$port, [string]$closeAction) {
    $directory = Join-Path $work ($name + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $directory | Out-Null
    Copy-Item (Join-Path $dist 'dsh.exe') $directory
    Copy-Item (Join-Path $dist 'dsh-config.exe') $directory
    Copy-Item (Join-Path $dist '*.dll') $directory
    New-Item -ItemType File -Path (Join-Path $directory 'portable.mode') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $directory 'data') | Out-Null
    $config = [ordered]@{
        ResolutionWidth = 1280
        ResolutionHeight = 800
        Language = 'zh-CN'
        FirstRunCompleted = $true
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$port"
        Port = $port
        NodePath = ''
        RepoPath = $repository
        ToolbarAutoHide = $true
        ToolbarEdgeReveal = $false
        ToolbarHotkey = 'F8'
        FullscreenHotkey = 'F11'
        LoadingStyle = 'off'
        CloseAction = $closeAction
        ShowTrayButton = $true
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = ''
        DevTools = $true
        ExternalLinksInBrowser = $true
    }
    $config | ConvertTo-Json -Compress | Set-Content (Join-Path $directory 'data\config.json') -Encoding UTF8
    return $directory
}

function Wait-MainWindow([Diagnostics.Process]$process) {
    $deadline = (Get-Date).AddSeconds(15)
    while ($process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
    }
    if ($process.MainWindowHandle -eq 0) { throw "Main window missing for process $($process.Id)" }
}

function Wait-ChildNode([int]$parentProcessId) {
    $deadline = (Get-Date).AddSeconds(20)
    do {
        $node = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $parentProcessId
        } | Select-Object -First 1
        if ($node) { return $node }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw "Child node.exe missing for process $parentProcessId"
}

function Wait-Http([int]$port) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        try {
            return (Invoke-WebRequest "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2).StatusCode
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    throw "HTTP service did not become ready on port $port"
}

function Stop-SmokeApp([Diagnostics.Process]$process) {
    if (-not $process -or $process.HasExited) { return }
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate($process.Id) | Out-Null
        $shell.SendKeys('{F8}')
        Start-Sleep -Milliseconds 500
        & $windowControl btn $process.Id 'Exit' | Out-Null
        Start-Sleep -Seconds 2
    }
    catch {
    }
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
}

function Stop-SmokeNodes([string]$directory) {
    $directoryName = Split-Path $directory -Leaf
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $directoryName + '*')
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$singleDirectory = New-SmokeDirectory 'single-instance' (Get-FreePort) 'tray'
$secondDirectory = New-SmokeDirectory 'single-instance-copy' (Get-FreePort) 'tray'
$first = $null
$second = $null
$singleResult = $null
try {
    $first = Start-Process (Join-Path $singleDirectory 'dsh.exe') -WorkingDirectory $singleDirectory -PassThru
    Wait-MainWindow $first
    $node = Wait-ChildNode $first.Id
    if ($node.CommandLine -notmatch '--patch') { throw 'First instance did not load the desktop patch' }

    $firstHandle = $first.MainWindowHandle
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate($first.Id) | Out-Null
    $shell.SendKeys('%{F4}')
    $deadline = (Get-Date).AddSeconds(10)
    while ([DesktopSmokeWindows]::IsWindowVisible($firstHandle) -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 100
    }
    if ($first.HasExited) { throw 'First instance exited instead of minimizing to tray' }
    if ([DesktopSmokeWindows]::IsWindowVisible($firstHandle)) { throw 'First instance did not minimize to tray' }

    $second = Start-Process (Join-Path $secondDirectory 'dsh.exe') -WorkingDirectory $secondDirectory -PassThru
    Wait-MainWindow $second
    Start-Sleep -Milliseconds 500
    $first.Refresh()
    $trayHandle = $first.MainWindowHandle
    $stayedInTray = $trayHandle -eq 0 -or -not [DesktopSmokeWindows]::IsWindowVisible($trayHandle)

    $reminder = Join-Path $work 'single-instance-reminder.png'
    & $windowControl screen $second.Id $reminder | Out-Null
    $second.CloseMainWindow() | Out-Null
    if (-not $second.WaitForExit(10000)) { throw 'Second instance reminder did not close' }

    $remaining = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'dsh.exe' -and $_.ExecutablePath -eq (Join-Path $singleDirectory 'dsh.exe')
    }).Count
    $singleLog = Get-Content (Join-Path $singleDirectory 'data\logs\app.log') -Raw
    $singleResult = [pscustomobject]@{
        StayedInTray = $stayedInTray
        SecondExited = $second.HasExited
        RemainingInstances = $remaining
        WebViewInitializationFailed = $singleLog -match 'WebView2 (init|start) failed'
        ReminderScreenshot = $reminder
    }
}
finally {
    Stop-SmokeApp $first
    if ($second -and -not $second.HasExited) { Stop-Process -Id $second.Id -Force }
    Stop-SmokeNodes $singleDirectory
    Stop-SmokeNodes $secondDirectory
}

$occupiedPort = Get-FreePort
$collisionDirectory = New-SmokeDirectory 'port-collision' $occupiedPort 'exit'
$occupier = Start-Process python -ArgumentList '-m', 'http.server', $occupiedPort, '--bind', '127.0.0.1' -WorkingDirectory $collisionDirectory -WindowStyle Hidden -PassThru
$collisionApp = $null
try {
    Start-Sleep -Milliseconds 500
    $collisionApp = Start-Process (Join-Path $collisionDirectory 'dsh.exe') -WorkingDirectory $collisionDirectory -PassThru
    Wait-MainWindow $collisionApp
    $node = Wait-ChildNode $collisionApp.Id
    if ($node.CommandLine -notmatch '--patch') { throw 'Collision service did not load the desktop patch' }
    $portMatch = [regex]::Match($node.CommandLine, '--port"?\s+(\d+)')
    if (-not $portMatch.Success) { throw 'Collision service port missing from Node command' }
    $activePort = [int]$portMatch.Groups[1].Value
    $httpStatus = Wait-Http $activePort
    $nodeProcess = Get-Process -Id $node.ProcessId
    $log = Get-Content (Join-Path $collisionDirectory 'data\logs\app.log') -Raw
    $collisionResult = [pscustomobject]@{
        ConfiguredPort = $occupiedPort
        ActivePort = $activePort
        UsedIsolatedPort = $activePort -ne $occupiedPort
        DesktopPatchLoaded = $node.CommandLine -match '--patch'
        NodeHasNoWindow = $nodeProcess.MainWindowHandle -eq 0
        HttpStatus = $httpStatus
        CollisionLogged = $log -match 'occupied by another service'
    }
}
finally {
    Stop-SmokeApp $collisionApp
    if ($occupier -and -not $occupier.HasExited) { Stop-Process -Id $occupier.Id -Force }
    Stop-SmokeNodes $collisionDirectory
}

try {
    [pscustomobject]@{
        SingleInstance = $singleResult
        PortIsolation = $collisionResult
    }
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousInstanceScope
}
