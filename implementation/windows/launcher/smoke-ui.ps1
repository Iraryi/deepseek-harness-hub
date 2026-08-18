$ErrorActionPreference = 'Stop'

$launcherRoot = $PSScriptRoot
$repository = Split-Path (Split-Path $launcherRoot -Parent) -Parent
$work = Join-Path (Split-Path $repository -Parent) 'work'
$dist = Join-Path $launcherRoot 'dist-check'
$testDir = Join-Path $work ('formal-ui-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$port = 32191

New-Item -ItemType Directory -Path $testDir | Out-Null
Copy-Item (Join-Path $dist 'dsh.exe') $testDir
Copy-Item (Join-Path $dist 'dsh-config.exe') $testDir
Copy-Item (Join-Path $dist '*.dll') $testDir
New-Item -ItemType File -Path (Join-Path $testDir 'portable.mode') | Out-Null
New-Item -ItemType Directory -Path (Join-Path $testDir 'data') | Out-Null
Set-Content (Join-Path $testDir 'index.html') '<!doctype html><meta charset=utf-8><title>Toolbar smoke</title><style>body{font:28px sans-serif;margin:80px;background:#eef3ff}</style><h1>WebView remains fixed</h1>' -Encoding UTF8

$config = [ordered]@{
    ResolutionWidth = 1280
    ResolutionHeight = 800
    Language = 'zh-CN'
    FirstRunCompleted = $true
    LaunchMode = 'window'
    Url = "http://127.0.0.1:$port"
    Port = $port
    NodePath = ''
    RepoPath = ''
    ToolbarAutoHide = $true
    ToolbarEdgeReveal = $false
    ToolbarHotkey = 'F8'
    FullscreenHotkey = 'F11'
    LoadingStyle = 'whales'
    CloseAction = 'exit'
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
$config | ConvertTo-Json -Compress | Set-Content (Join-Path $testDir 'data\config.json') -Encoding UTF8

$python = Start-Process python -ArgumentList '-m', 'http.server', $port, '--bind', '127.0.0.1' -WorkingDirectory $testDir -WindowStyle Hidden -PassThru
$windowControl = Join-Path $work 'winctl.exe'
$app = $null
try {
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $client = New-Object Net.Sockets.TcpClient
            $connection = $client.BeginConnect('127.0.0.1', $port, $null, $null)
            if ($connection.AsyncWaitHandle.WaitOne(100)) {
                $client.EndConnect($connection)
                $client.Close()
                break
            }
            $client.Close()
        }
        catch {
        }
        Start-Sleep -Milliseconds 100
    }

    $app = Start-Process (Join-Path $testDir 'dsh.exe') -WorkingDirectory $testDir -PassThru
    $deadline = (Get-Date).AddSeconds(10)
    while ($app.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 100
        $app.Refresh()
    }
    if ($app.MainWindowHandle -eq 0) { throw 'main window missing' }

    Start-Sleep -Milliseconds 250
    $loading = Join-Path $work 'formal-loading-title.png'
    & $windowControl screen $app.Id $loading | Out-Null

    Start-Sleep -Seconds 3
    $info = & $windowControl info $app.Id
    $parts = @{}
    foreach ($token in ($info -split ' ')) {
        $pair = $token -split '='
        if ($pair.Count -eq 2) { $parts[$pair[0]] = $pair[1] }
    }
    $hoverX = [int]$parts['L'] + [int]$parts['W'] / 2
    $hoverY = [int]$parts['T'] + 2
    & $windowControl click $hoverX $hoverY | Out-Null
    Start-Sleep -Milliseconds 800
    $edge = Join-Path $work 'formal-edge-disabled.png'
    & $windowControl screen $app.Id $edge | Out-Null

    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate($app.Id) | Out-Null
    $shell.SendKeys('{F8}')
    Start-Sleep -Milliseconds 900
    $toolbar = Join-Path $work 'formal-toolbar-f8.png'
    & $windowControl screen $app.Id $toolbar | Out-Null

    $button = & $windowControl btn $app.Id 'Config'
    Start-Sleep -Seconds 1
    $configProcess = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'dsh-config.exe' -and $_.ExecutablePath -eq (Join-Path $testDir 'dsh-config.exe')
    } | Select-Object -First 1
    if ($configProcess) { & $windowControl btn $configProcess.ProcessId '取消' | Out-Null }

    [pscustomobject]@{
        Sandbox = $testDir
        ConfigButton = $button -join ' '
        ConfigOpened = [bool]$configProcess
        Loading = $loading
        Edge = $edge
        Toolbar = $toolbar
    }
}
finally {
    if ($app -and -not $app.HasExited) {
        try { & $windowControl btn $app.Id 'Exit' | Out-Null } catch {}
        Start-Sleep -Milliseconds 500
    }
    if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force }
    if ($python -and -not $python.HasExited) { Stop-Process -Id $python.Id -Force }
}
