param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [ValidateSet('dsh.exe', 'dsh-hub.exe')]
    [string]$LauncherName = 'dsh.exe',
    [string]$ExpectedSurface = '',
    [switch]$ExpectServiceRecovery,
    [switch]$ExpectAssetRecovery,
    [switch]$ExpectSlowProgress
)

$ErrorActionPreference = 'Stop'

if (@($ExpectServiceRecovery, $ExpectAssetRecovery, $ExpectSlowProgress).Where({ $_ }).Count -gt 1) {
    throw 'Service recovery, asset recovery, and slow-progress modes are mutually exclusive.'
}

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
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
$work = Join-Path $env:TEMP ('dsh-service-gate-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$data = Join-Path $work 'data'
$port = Get-FreePort
$node = (Get-Command node.exe -ErrorAction Stop).Source
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'SERVICE-GATE-' + [Guid]::NewGuid().ToString('N')
$app = $null

try {
    New-Item -ItemType Directory -Path (Join-Path $work 'lib'), $data -Force | Out-Null
    foreach ($name in @(
        'dsh.exe', 'dsh-hub.exe', 'dsh-config.exe',
        'Microsoft.Web.WebView2.Core.dll',
        'Microsoft.Web.WebView2.WinForms.dll',
        'WebView2Loader.dll'
    )) { Copy-Item -LiteralPath (Join-Path $launcher $name) -Destination $work }
    New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null

    $recoveryMode = if ($ExpectAssetRecovery) { 'asset' } elseif ($ExpectServiceRecovery) { 'service' } elseif ($ExpectSlowProgress) { 'slow-progress' } else { 'normal' }
    $fakeService = @'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const recoveryMode = '__RECOVERY_MODE__'
const portIndex = process.argv.indexOf('--port')
const port = Number(process.argv[portIndex + 1])
const root = process.cwd()
const mark = name => fs.writeFileSync(path.join(root, name), String(Date.now()))
const readCount = name => { try { return Number(fs.readFileSync(path.join(root, name), 'utf8')) || 0 } catch { return 0 } }
const serviceStartCount = readCount('service-start-count.txt') + 1
fs.writeFileSync(path.join(root, 'service-start-count.txt'), String(serviceStartCount))
let navigationCount = 0
let firstBootId = ''
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`)
  if (requestUrl.pathname !== '/') { response.writeHead(404); response.end('not found'); return }
  navigationCount += 1
  const totalNavigationCount = readCount('navigation-count.txt') + 1
  const bootId = requestUrl.searchParams.get('desktopBoot') || ''
  fs.writeFileSync(path.join(root, 'surface.txt'), requestUrl.searchParams.get('dshSurface') || '')
  if (totalNavigationCount === 1) { firstBootId = bootId; mark('page-requested.txt') }
  fs.writeFileSync(path.join(root, 'navigation-count.txt'), String(totalNavigationCount))
  const currentBootId = JSON.stringify(bootId)
  const staleBootId = JSON.stringify(firstBootId)
  const normal = navigationCount === 1
    ? `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'failed',retryable:true,failures:[{name:'delayed-consumer',state:'pending',missingServices:['slots']}],message:'pending test failure'}),100);`
    : `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId:${staleBootId},state:'ready',retryable:false,failures:[]});chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]}),250);`
  const serviceRecovery = serviceStartCount === 1
    ? (navigationCount === 1
      ? `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'failed',retryable:true,failures:[{name:'retained-market',state:'pending',missingServices:['slots','locale','theme']}],message:'retained plugin startup stalled'}),100);`
      : `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});`)
    : `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]}),250);`
  const assetRecovery = serviceStartCount === 1
    ? `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'failed',retryable:false,failures:[{name:'cb193bf4 (@dsh-external/dsh-ads)',state:'failed',missingServices:[]}],message:'failed to import loader entry cb193bf4 (@dsh-external/dsh-ads): client-modules: bundle script /plugins/@dsh-external/dsh-ads/client.js?rev=5852cb71b1a9 failed to load'}),100);`
    : `const bootId=${currentBootId};chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]}),250);`
  const slowProgress = `const bootId=${currentBootId};let elapsed=0;const heartbeat=setInterval(()=>{elapsed+=5000;chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[],message:'slow cold-start progress '+elapsed});if(elapsed>=50000){clearInterval(heartbeat);chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'ready',retryable:false,failures:[]})}},5000);chrome.webview.postMessage({type:'dsh-web-boot-status',bootId,state:'loading',retryable:false,failures:[],message:'slow cold-start progress 0'});`
  const script = recoveryMode === 'service' ? serviceRecovery : recoveryMode === 'asset' ? assetRecovery : recoveryMode === 'slow-progress' ? slowProgress : normal
  response.writeHead(200, {'content-type':'text/html; charset=utf-8'})
  response.end(`<!doctype html><title>Service gate</title><h1>Service gate</h1><script>${script}</script>`)
})
server.listen(port, '127.0.0.1', () => {
  mark('port-open.txt')
  setTimeout(() => { mark('ready-announced.txt'); console.log(`dsh web: http://127.0.0.1:${port}`) }, 3000)
})
const close = () => server.close(() => process.exit(0))
process.on('SIGINT', close)
process.on('SIGTERM', close)
'@
    $fakeService.Replace('__RECOVERY_MODE__', $recoveryMode) |
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
    if (Test-Path -LiteralPath (Join-Path $work 'page-requested.txt')) { throw 'WebView navigated before host readiness' }
    Wait-File (Join-Path $work 'ready-announced.txt') 10 'Fake service did not announce host readiness'
    Wait-File (Join-Path $work 'page-requested.txt') 20 'WebView did not navigate after host readiness'

    $announcedAt = [long](Get-Content -LiteralPath (Join-Path $work 'ready-announced.txt') -Raw)
    $requestedAt = [long](Get-Content -LiteralPath (Join-Path $work 'page-requested.txt') -Raw)
    if ($requestedAt -lt $announcedAt) { throw 'Page request preceded host readiness' }
    $logPath = Join-Path $data 'logs\app.log'
    $readyTimeout = if ($ExpectSlowProgress) { 70 } elseif ($ExpectServiceRecovery -or $ExpectAssetRecovery) { 60 } else { 20 }
    $log = Wait-LogPattern $logPath 'Web UI boot verified by structured ready status' $readyTimeout 'Launcher did not receive final ready status'
    if ($log -notmatch 'Plugin graph ready: http://127\.0\.0\.1:\d+') { throw 'Launcher did not record the settled plugin graph' }
    $controlledRetryCount = ($log | Select-String -Pattern 'Retrying Web UI boot once with a fresh navigation token' -AllMatches).Matches.Count
    $expectedControlledRetryCount = if ($ExpectAssetRecovery -or $ExpectSlowProgress) { 0 } else { 1 }
    if ($controlledRetryCount -ne $expectedControlledRetryCount) {
        throw "Expected $expectedControlledRetryCount controlled Web UI retries, observed $controlledRetryCount"
    }
    $navigationCount = [int](Get-Content -LiteralPath (Join-Path $work 'navigation-count.txt') -Raw)
    $serviceRecoveryCount = 0
    $assetRecoveryCount = 0
    if ($ExpectServiceRecovery) {
        if (($log | Select-String -Pattern 'Restarting local service once to recover Web UI plugin activation' -AllMatches).Matches.Count -ne 1) {
            throw 'Launcher did not perform exactly one bounded service recovery'
        }
        $serviceStartCount = [int](Get-Content -LiteralPath (Join-Path $work 'service-start-count.txt') -Raw)
        if ($serviceStartCount -ne 2) { throw "Expected two service starts, observed $serviceStartCount" }
        if ($navigationCount -ne 3) { throw "Expected three navigations, observed $navigationCount" }
        $serviceRecoveryCount = 1
    }
    elseif ($ExpectAssetRecovery) {
        if (($log | Select-String -Pattern 'Refreshing WebView plugin caches after a client bundle load failure' -AllMatches).Matches.Count -ne 1) {
            throw 'Launcher did not perform exactly one stale client asset recovery'
        }
        if (($log | Select-String -Pattern 'Cleared WebView plugin cache, cache storage, and service workers before restart' -AllMatches).Matches.Count -ne 1) {
            throw 'Launcher did not clear WebView plugin state before asset recovery'
        }
        if ($log -match 'Restarting local service once to recover Web UI plugin activation') {
            throw 'Asset failure incorrectly entered pending-only service recovery'
        }
        $serviceStartCount = [int](Get-Content -LiteralPath (Join-Path $work 'service-start-count.txt') -Raw)
        if ($serviceStartCount -ne 2) { throw "Expected two service starts, observed $serviceStartCount" }
        if ($navigationCount -ne 2) { throw "Expected two navigations, observed $navigationCount" }
        $assetRecoveryCount = 1
    }
    elseif ($ExpectSlowProgress) {
        $serviceStartCount = [int](Get-Content -LiteralPath (Join-Path $work 'service-start-count.txt') -Raw)
        if ($serviceStartCount -ne 1) { throw "Slow progress incorrectly restarted the service; observed $serviceStartCount starts" }
        if ($navigationCount -ne 1) { throw "Slow progress incorrectly retried navigation; observed $navigationCount navigations" }
        if ($log -match 'Web UI boot status timed out|Restarting local service once|Retrying Web UI boot once') {
            throw 'Slow progress entered a timeout or recovery path despite active heartbeats'
        }
    }
    elseif ($navigationCount -ne 2) { throw "Expected two navigations, observed $navigationCount" }

    $surfaceContent = Get-Content -LiteralPath (Join-Path $work 'surface.txt') -Raw -ErrorAction SilentlyContinue
    $surface = if ($null -eq $surfaceContent) { '' } else { $surfaceContent.Trim() }
    if (-not [string]::Equals($surface, $ExpectedSurface, [StringComparison]::Ordinal)) {
        throw "Expected dshSurface '$ExpectedSurface', observed '$surface'"
    }
    [pscustomobject]@{
        Launcher = $LauncherName
        Surface = $surface
        Port = $port
        GateDelayMilliseconds = $requestedAt - $announcedAt
        NavigatedOnlyAfterReady = $true
        ControlledRetryCount = $controlledRetryCount
        ServiceRecoveryCount = $serviceRecoveryCount
        AssetRecoveryCount = $assetRecoveryCount
        SlowProgressPreservedSingleLaunch = [bool]$ExpectSlowProgress
    }
}
catch {
    $logPath = Join-Path $data 'logs\app.log'
    if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Tail 100 | ForEach-Object { Write-Warning $_ } }
    throw
}
finally {
    if ($app -and -not $app.HasExited) {
        & taskkill.exe /PID $app.Id /T /F 2>$null | Out-Null
        try { $app.WaitForExit(5000) | Out-Null } catch {}
    }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $work + '*')
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $work); $attempt++) {
        try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
        catch { Start-Sleep -Milliseconds 250 }
    }
    if (Test-Path -LiteralPath $work) { Write-Warning "Service-gate smoke cleanup retained: $work" }
}
