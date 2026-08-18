param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [ValidateSet('dsh.exe', 'dsh-hub.exe')]
    [string]$LauncherName = 'dsh.exe',
    [string]$ExpectedSurface = '',
    [switch]$ExpectServiceRecovery
)

$ErrorActionPreference = 'Stop'

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

function Wait-File([string]$Path, [int]$Seconds, [string]$Failure) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) { return }
        Start-Sleep -Milliseconds 100
    }
    throw $Failure
}

function Wait-LogPattern([string]$Path, [string]$Pattern, [int]$Seconds, [string]$Failure) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Path -LiteralPath $Path) {
            $text = Get-Content -LiteralPath $Path -Raw
            if ($text -match $Pattern) { return $text }
        }
        Start-Sleep -Milliseconds 100
    }
    throw $Failure
}

$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$work = Join-Path $env:TEMP ('dsh-ready-gate-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$data = Join-Path $work 'data'
$port = Get-FreePort
$node = (Get-Command node.exe -ErrorAction Stop).Source
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'READY-GATE-' + [Guid]::NewGuid().ToString('N')
$app = $null

try {
    New-Item -ItemType Directory -Path (Join-Path $work 'lib'), $data | Out-Null
    foreach ($name in @(
        'dsh.exe',
        'dsh-hub.exe',
        'dsh-config.exe',
        'Microsoft.Web.WebView2.Core.dll',
        'Microsoft.Web.WebView2.WinForms.dll',
        'WebView2Loader.dll'
    )) {
        Copy-Item -LiteralPath (Join-Path $launcher $name) -Destination $work
    }
    New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null

    $recoveryLiteral = if ($ExpectServiceRecovery) { 'true' } else { 'false' }
    $fakeService = @'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const recoveryMode = __RECOVERY_MODE__
const portIndex = process.argv.indexOf('--port')
const port = Number(process.argv[portIndex + 1])
const root = process.cwd()
const mark = (name) => fs.writeFileSync(path.join(root, name), String(Date.now()))
const readCount = (name) => {
  try { return Number(fs.readFileSync(path.join(root, name), 'utf8')) || 0 } catch { return 0 }
}
const serviceStartCount = readCount('service-start-count.txt') + 1
fs.writeFileSync(path.join(root, 'service-start-count.txt'), String(serviceStartCount))
let navigationCount = 0
let firstBootId = ''
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`)
  if (requestUrl.pathname !== '/') {
    response.writeHead(404)
    response.end('not found')
    return
  }
  navigationCount += 1
  const totalNavigationCount = readCount('navigation-count.txt') + 1
  const bootId = requestUrl.searchParams.get('desktopBoot') || ''
  fs.writeFileSync(path.join(root, 'surface.txt'), requestUrl.searchParams.get('dshSurface') || '')
  if (totalNavigationCount === 1) {
    firstBootId = bootId
    mark('page-requested.txt')
  }
  fs.writeFileSync(path.join(root, 'navigation-count.txt'), String(totalNavigationCount))
  const currentBootId = JSON.stringify(bootId)
  const staleBootId = JSON.stringify(firstBootId)
  const standardScript = navigationCount === 1
    ? `const bootId=${currentBootId};
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});
setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'failed',retryable:true,failures:[{name:'delayed-consumer',state:'pending',missingServices:['slots']}],message:'pending test failure'}),100);`
    : `const bootId=${currentBootId};
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId:${staleBootId},state:'ready',retryable:false,failures:[]});
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});
setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]}),250);`
  const recoveryScript = serviceStartCount === 1
    ? (navigationCount === 1
      ? `const bootId=${currentBootId};
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});
setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'failed',retryable:true,failures:[{name:'retained-market',state:'pending',missingServices:['slots','locale','theme']}],message:'retained plugin startup stalled'}),100);`
      : `const bootId=${currentBootId};
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});`)
    : `const bootId=${currentBootId};
chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});
setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]}),250);`
  const script = recoveryMode ? recoveryScript : standardScript
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><title>Ready gate</title><h1>READY GATED PAGE</h1><script>${script}</script>`)
})

server.listen(port, '127.0.0.1', () => {
  mark('port-open.txt')
  setTimeout(() => {
    mark('ready-announced.txt')
    console.log(`dsh web: http://127.0.0.1:${port}`)
  }, 3000)
})

const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
'@
    $fakeService.Replace('__RECOVERY_MODE__', $recoveryLiteral) |
        Set-Content -LiteralPath (Join-Path $work 'lib\bin.js') -Encoding UTF8

    [ordered]@{
        ResolutionWidth = 1100
        ResolutionHeight = 720
        Language = 'en-US'
        FirstRunCompleted = $true
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$port"
        Port = $port
        NodePath = $node
        RepoPath = $work
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

    $app = Start-Process (Join-Path $work $LauncherName) -WorkingDirectory $work -PassThru
    Wait-File (Join-Path $work 'port-open.txt') 20 'Fake service did not open its port'
    Start-Sleep -Milliseconds 1200
    if (Test-Path -LiteralPath (Join-Path $work 'page-requested.txt')) {
        throw 'WebView navigated when only the TCP port was ready'
    }

    Wait-File (Join-Path $work 'ready-announced.txt') 10 'Fake service did not announce Loader settlement'
    Wait-File (Join-Path $work 'page-requested.txt') 20 'WebView did not navigate after Loader settlement'

    $announcedAt = [long](Get-Content -LiteralPath (Join-Path $work 'ready-announced.txt') -Raw)
    $requestedAt = [long](Get-Content -LiteralPath (Join-Path $work 'page-requested.txt') -Raw)
    if ($requestedAt -lt $announcedAt) { throw 'Page request preceded the ready announcement' }

    $logPath = Join-Path $data 'logs\app.log'
    $readyTimeout = if ($ExpectServiceRecovery) { 60 } else { 20 }
    $log = Wait-LogPattern $logPath 'Web UI boot verified by structured ready status' $readyTimeout 'Launcher did not receive the final ready status'
    if ($log -notmatch 'Plugin graph ready: http://127\.0\.0\.1:\d+') {
        throw 'Launcher did not record the settled plugin graph'
    }
    if (($log | Select-String -Pattern 'Retrying Web UI boot once with a fresh navigation token' -AllMatches).Matches.Count -ne 1) {
        throw 'Launcher did not perform exactly one controlled Web UI retry'
    }
    $navigationCount = [int](Get-Content -LiteralPath (Join-Path $work 'navigation-count.txt') -Raw)
    $serviceRecoveryCount = 0
    if ($ExpectServiceRecovery) {
        if (($log | Select-String -Pattern 'Restarting local service once to recover Web UI plugin activation' -AllMatches).Matches.Count -ne 1) {
            throw 'Launcher did not perform exactly one bounded local-service recovery'
        }
        $serviceStartCount = [int](Get-Content -LiteralPath (Join-Path $work 'service-start-count.txt') -Raw)
        if ($serviceStartCount -ne 2) { throw "Expected exactly two fake service starts, observed $serviceStartCount" }
        if ($navigationCount -ne 3) { throw "Expected three Web UI navigations across recovery, observed $navigationCount" }
        $serviceRecoveryCount = 1
    }
    else {
        if ($log -notmatch 'Ignored stale Web UI boot status for [0-9a-f]{32}') {
            throw 'Launcher did not reject the stale bootId status'
        }
        if ($navigationCount -ne 2) { throw "Expected exactly two Web UI navigations, observed $navigationCount" }
    }
    $surfaceContent = Get-Content -LiteralPath (Join-Path $work 'surface.txt') -Raw
    $surface = if ($null -eq $surfaceContent) { '' } else { [string]$surfaceContent }
    $expectedSurfaceValue = if ($null -eq $ExpectedSurface) { '' } else { [string]$ExpectedSurface }
    if (-not [string]::Equals($surface, $expectedSurfaceValue, [StringComparison]::Ordinal)) {
        throw "Expected dshSurface '$expectedSurfaceValue' from $LauncherName, observed '$surface'"
    }

    [pscustomobject]@{
        Launcher = $LauncherName
        Surface = $surface
        Port = $port
        GateDelayMilliseconds = $requestedAt - $announcedAt
        NavigatedOnlyAfterReady = $true
        ControlledRetryCount = 1
        StaleBootStatusIgnored = -not $ExpectServiceRecovery
        ServiceRecoveryCount = $serviceRecoveryCount
    }
}
catch {
    $logPath = Join-Path $data 'logs\app.log'
    if (Test-Path -LiteralPath $logPath) {
        Write-Warning 'Ready-gate launcher log tail:'
        Get-Content -LiteralPath $logPath -Tail 120 | ForEach-Object { Write-Warning $_ }
    }
    foreach ($marker in @('service-start-count.txt', 'navigation-count.txt', 'surface.txt')) {
        $markerPath = Join-Path $work $marker
        if (Test-Path -LiteralPath $markerPath) {
            Write-Warning ("{0}: {1}" -f $marker, (Get-Content -LiteralPath $markerPath -Raw))
        }
    }
    throw
}
finally {
    if ($app -and -not $app.HasExited) {
        & taskkill.exe /PID $app.Id /T /F 2>$null | Out-Null
        try { $app.WaitForExit(5000) | Out-Null } catch {}
    }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $work + '*')
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $work); $attempt++) {
        try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path -LiteralPath $work) { Write-Warning "Ready-gate smoke cleanup retained: $work" }
}
