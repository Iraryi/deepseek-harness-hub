param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

$ErrorActionPreference = 'Stop'
$app = [IO.Path]::GetFullPath($LauncherDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-hub-desktop-restart-' + [Guid]::NewGuid().ToString('N'))
$data = Join-Path $work 'data'
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousDataDirectory = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousHome = $env:DSH_HOME
$desktop = $null
$hub = $null
$firstDesktopNode = $null
$secondDesktopNode = $null
$hubNode = $null

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
}

function Wait-ChildNode([int]$ParentProcessId, [int]$ExcludeProcessId = 0) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $node = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $ParentProcessId -and $_.ProcessId -ne $ExcludeProcessId
        } | Select-Object -First 1
        if ($node) { return $node }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Child node.exe missing for process $ParentProcessId"
}

function Get-ServicePort($NodeProcess) {
    $match = [regex]::Match($NodeProcess.CommandLine, '--port"?\s+(\d+)')
    if (-not $match.Success) { throw "Service port missing from Node command: $($NodeProcess.CommandLine)" }
    return [int]$match.Groups[1].Value
}

function Wait-Http([int]$Port) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        try { return (Invoke-WebRequest "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2).StatusCode }
        catch { Start-Sleep -Milliseconds 300 }
    } while ((Get-Date) -lt $deadline)
    throw "HTTP service did not become ready on port $Port"
}

function Wait-Log([string]$Pattern) {
    $log = Join-Path $data 'logs\app.log'
    $deadline = (Get-Date).AddSeconds(90)
    do {
        if (Test-Path -LiteralPath $log) {
            $content = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
            if ($content -match $Pattern) { return $content }
        }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Application log did not contain: $Pattern"
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $app 'runtime\runtime-manifest.json'))) { throw "Packaged Runtime missing under $app" }
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $inject = Join-Path $work 'restart-desktop.js'
    @'
(() => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('dshSurface') !== 'hub') return
  if (window.sessionStorage.getItem('dshRestartSmokeReloaded') !== '1') {
    window.localStorage.setItem('dshHub.desktopRestartPending', '1')
    window.sessionStorage.setItem('dshRestartSmokeReloaded', '1')
    window.location.reload()
    return
  }
  let attempts = 0
  const timer = window.setInterval(() => {
    attempts += 1
    const restart = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes('重启主程序并应用') || button.textContent?.includes('Restart Desktop to apply'))
    if (restart instanceof HTMLButtonElement) {
      window.clearInterval(timer)
      restart.click()
    } else if (attempts > 240) {
      window.clearInterval(timer)
    }
  }, 250)
})()
'@ | Set-Content -LiteralPath $inject -Encoding UTF8

    $port = Get-FreePort
    [ordered]@{
        ResolutionWidth = 1100
        ResolutionHeight = 760
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
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $false
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = $inject
        DevTools = $false
        ExternalLinksInBrowser = $true
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'config.json') -Encoding UTF8
    [ordered]@{
        Theme = 'light'
        StartPage = 'github'
        DiscoverySource = 'dshmk'
        PageSize = 24
        DetailEntry = 'button'
        DetailMode = 'side'
        DetailContent = 'native'
        LoadingStyle = 'off'
        CloseAction = 'exit'
        ShowTrayButton = $false
        AllowDesktopPlugins = $false
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'hub-config.json') -Encoding UTF8

    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'HUB-RESTART-' + [Guid]::NewGuid().ToString('N')
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $work 'desktop-home'
    $desktop = Start-Process (Join-Path $app 'dsh.exe') -WorkingDirectory $app -WindowStyle Minimized -PassThru
    $firstDesktopNode = Wait-ChildNode $desktop.Id
    $desktopPort = Get-ServicePort $firstDesktopNode
    $firstStatus = Wait-Http $desktopPort

    $marker = 'HUB_DESKTOP_RESTART_' + [Guid]::NewGuid().ToString('N')
    [IO.File]::AppendAllText((Join-Path $data 'logs\app.log'), $marker + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    $hub = Start-Process (Join-Path $app 'dsh-hub.exe') -WorkingDirectory $app -WindowStyle Minimized -PassThru
    $hubNode = Wait-ChildNode $hub.Id
    [void](Wait-Http (Get-ServicePort $hubNode))
    [void](Wait-Log ($marker + '[\s\S]*Opened independent DeepSeek Harness process'))
    $secondDesktopNode = Wait-ChildNode $desktop.Id $firstDesktopNode.ProcessId
    $secondStatus = Wait-Http (Get-ServicePort $secondDesktopNode)
    $hub.Refresh()
    $desktop.Refresh()
    $hubNodeAfter = Get-CimInstance Win32_Process -Filter "ProcessId = $($hubNode.ProcessId)" -ErrorAction SilentlyContinue

    if ($hub.HasExited) { throw 'HUB exited while restarting Desktop' }
    if ($desktop.HasExited) { throw 'Desktop host exited instead of restarting its owned service' }
    if (-not $hubNodeAfter) { throw 'HUB child Node service exited during Desktop restart' }
    if ($firstDesktopNode.ProcessId -eq $secondDesktopNode.ProcessId) { throw 'Desktop restart reused the stale Node process' }
    if ($desktopPort -ne (Get-ServicePort $secondDesktopNode)) { throw 'Desktop restart changed its configured port' }

    [pscustomobject]@{
        HubProcessId = $hub.Id
        HubNodeProcessId = $hubNode.ProcessId
        HubRemainedRunning = -not $hub.HasExited
        DesktopProcessId = $desktop.Id
        FirstDesktopNodeProcessId = $firstDesktopNode.ProcessId
        ReloadedDesktopNodeProcessId = $secondDesktopNode.ProcessId
        FirstHttpStatus = $firstStatus
        ReloadedHttpStatus = $secondStatus
        RestartRequestedThroughHubUi = $true
    }
}
finally {
    foreach ($process in @($hub, $desktop)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            try { $process.WaitForExit(10000) | Out-Null } catch {}
        }
    }
    foreach ($node in @($hubNode, $firstDesktopNode, $secondDesktopNode)) {
        if ($node) { Stop-Process -Id $node.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousDataDirectory
    $env:DSH_HOME = $previousHome
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $work); $attempt++) {
        try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
        catch { Start-Sleep -Milliseconds 250 }
    }
}
