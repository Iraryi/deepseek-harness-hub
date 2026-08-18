param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-desktop-reload-' + [Guid]::NewGuid().ToString('N'))
$packagedRuntime = Join-Path $launcher 'runtime'
$usePackagedRuntime = (Test-Path -LiteralPath (Join-Path $packagedRuntime 'runtime-manifest.json')) -and
    (Test-Path -LiteralPath (Join-Path $packagedRuntime 'tools\node\node.exe'))
$app = if ($usePackagedRuntime) { $launcher } else { $work }
$data = Join-Path $work 'data'
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousDataDirectory = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousDshHome = $env:DSH_HOME
$desktop = $null
$signal = $null
$firstNode = $null
$secondNode = $null

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

function Wait-ChildNode([int]$ParentProcessId, [int]$ExcludeProcessId = 0) {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        $node = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $ParentProcessId -and $_.ProcessId -ne $ExcludeProcessId
        } | Select-Object -First 1
        if ($node) { return $node }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw "Child node.exe missing for Desktop process $ParentProcessId"
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
        catch { Start-Sleep -Milliseconds 400 }
    } while ((Get-Date) -lt $deadline)
    throw "HTTP service did not become ready on port $Port"
}

try {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'RELOAD-' + [Guid]::NewGuid().ToString('N')
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $data 'dsh-home'
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    if (-not $usePackagedRuntime) {
        foreach ($name in @('dsh.exe', 'dsh-config.exe')) { Copy-Item -LiteralPath (Join-Path $launcher $name) -Destination $work }
        Copy-Item -Path (Join-Path $launcher '*.dll') -Destination $work
        New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null
    }

    $port = Get-FreePort
    [ordered]@{
        ResolutionWidth = 1000
        ResolutionHeight = 700
        Language = 'en-US'
        FirstRunCompleted = $true
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$port"
        Port = $port
        NodePath = if ($usePackagedRuntime) { '' } else { (Get-Command node.exe -ErrorAction Stop).Source }
        RepoPath = if ($usePackagedRuntime) { '' } else { $repository }
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

    $desktop = Start-Process (Join-Path $app 'dsh.exe') -WorkingDirectory $app -WindowStyle Minimized -PassThru
    $firstNode = Wait-ChildNode $desktop.Id
    $firstPort = Get-ServicePort $firstNode
    $firstStatus = Wait-Http $firstPort

    $signal = Start-Process (Join-Path $app 'dsh.exe') -ArgumentList '--reload-silent' -WorkingDirectory $app -WindowStyle Hidden -PassThru
    if (-not $signal.WaitForExit(10000)) { throw 'Reload signal process did not exit after notifying the existing Desktop' }
    $secondNode = Wait-ChildNode $desktop.Id $firstNode.ProcessId
    $secondPort = Get-ServicePort $secondNode
    $secondStatus = Wait-Http $secondPort
    $desktop.Refresh()

    if ($desktop.HasExited) { throw 'Desktop host exited instead of restarting its service' }
    if ($firstNode.ProcessId -eq $secondNode.ProcessId) { throw 'Desktop reload reused the stale Node process' }
    if ($firstPort -ne $port -or $secondPort -ne $port) { throw 'Desktop reload changed the configured service port' }

    [pscustomobject]@{
        DesktopProcessId = $desktop.Id
        FirstNodeProcessId = $firstNode.ProcessId
        ReloadedNodeProcessId = $secondNode.ProcessId
        Port = $port
        FirstHttpStatus = $firstStatus
        ReloadedHttpStatus = $secondStatus
        ReloadSignalExited = $signal.HasExited
        RuntimeMode = if ($usePackagedRuntime) { 'packaged' } else { 'source-fallback' }
    }
}
finally {
    foreach ($process in @($signal, $desktop)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            try { $process.WaitForExit(10000) | Out-Null } catch {}
        }
    }
    foreach ($node in @($firstNode, $secondNode)) {
        if ($node) { Stop-Process -Id $node.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousDataDirectory
    $env:DSH_HOME = $previousDshHome
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $work); $attempt++) {
        try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
        catch { Start-Sleep -Milliseconds 250 }
    }
}
