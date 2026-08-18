param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
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

$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$work = Join-Path $env:TEMP ('dsh-setup-bridge-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$data = Join-Path $work 'data'
$port = Get-FreePort
$node = (Get-Command node.exe -ErrorAction Stop).Source
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'SETUP-BRIDGE-' + [Guid]::NewGuid().ToString('N')
$app = $null

try {
    New-Item -ItemType Directory -Path (Join-Path $work 'lib'), $data | Out-Null
    foreach ($name in @(
        'dsh.exe',
        'dsh-config.exe',
        'Microsoft.Web.WebView2.Core.dll',
        'Microsoft.Web.WebView2.WinForms.dll',
        'WebView2Loader.dll'
    )) {
        Copy-Item -LiteralPath (Join-Path $launcher $name) -Destination $work
    }
    New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null

    @'
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const root = process.cwd()
const mode = process.argv[2]
if (mode === 'setup') {
  const manifestPath = process.argv[4]
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  fs.writeFileSync(path.join(root, 'setup-invoked.json'), JSON.stringify({ args: process.argv.slice(2), manifest }))
  console.log('bridge setup accepted')
  process.exit(0)
}

const portIndex = process.argv.indexOf('--port')
const port = Number(process.argv[portIndex + 1])
const manifest = {
  schemaVersion: 1,
  id: 'bridge-smoke',
  name: { default: 'Bridge Smoke', zh: '桥接烟测', en: 'Bridge Smoke' },
  description: 'Certified local bridge smoke manifest',
  version: '1.0.0',
  kind: 'virtual',
  categories: ['test'],
  tags: ['bridge'],
  source: { repository: 'https://github.com/deepseek-ai/deepseek-harness', ref: 'smoke', commit: '0000000000000000000000000000000000000000' },
  compatibility: { dsh: '>=0.1.0', surfaces: ['desktop'] },
  license: { identifier: 'MIT', name: 'MIT License', redistributable: true },
  signature: { status: 'valid', type: 'other', signer: 'Bridge smoke fixture' },
  audit: { status: 'certified', auditor: 'Bridge smoke fixture', checks: ['message round trip'] },
  artifacts: [{ id: 'fixture', kind: 'in-box', component: '@example/bridge-smoke' }],
  install: { mode: 'profile', source: 'in-box', bundle: '@example/bridge-smoke' },
  permissions: [],
  network: []
}

const page = `<!doctype html><meta charset="utf-8"><title>Setup bridge smoke</title><body>READY</body><script>
chrome.webview.addEventListener('message', event => {
  if (event.data && event.data.type === 'dsh-setup-result') {
    fetch('/result?value=' + encodeURIComponent(JSON.stringify(event.data)))
  }
})
chrome.webview.postMessage({ type: 'dsh-setup-install', requestId: crypto.randomUUID(), manifest: ${JSON.stringify(manifest)}, trust: 'certified' })
</script>`

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  if (url.pathname === '/result') {
    fs.writeFileSync(path.join(root, 'setup-result.json'), url.searchParams.get('value'))
    response.writeHead(204)
    response.end()
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(page)
})
server.listen(port, '127.0.0.1', () => console.log(`dsh web: http://127.0.0.1:${port}`))
'@ | Set-Content -LiteralPath (Join-Path $work 'lib\bin.js') -Encoding UTF8

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

    $app = Start-Process (Join-Path $work 'dsh.exe') -WorkingDirectory $work -PassThru -WindowStyle Minimized
    Wait-File (Join-Path $work 'setup-invoked.json') 30 'WebView2 did not invoke the bundled Setup CLI'
    Wait-File (Join-Path $work 'setup-result.json') 30 'WebView2 did not receive the Setup result'

    $invocation = Get-Content -LiteralPath (Join-Path $work 'setup-invoked.json') -Raw | ConvertFrom-Json
    $result = Get-Content -LiteralPath (Join-Path $work 'setup-result.json') -Raw | ConvertFrom-Json
    if ($invocation.args[0] -ne 'setup' -or $invocation.args[1] -ne 'install') {
        throw "Unexpected CLI invocation: $($invocation.args -join ' ')"
    }
    if ($invocation.manifest.id -ne 'bridge-smoke') { throw 'The bridge changed or lost the Setup manifest' }
    if ($result.type -ne 'dsh-setup-result' -or -not $result.ok) {
        throw "Setup bridge returned failure: $($result | ConvertTo-Json -Compress)"
    }

    [pscustomobject]@{
        Port = $port
        ManifestId = $invocation.manifest.id
        Result = $result.message
        RoundTrip = $true
    }
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
    if (Test-Path -LiteralPath $work) { Write-Warning "Setup bridge smoke cleanup retained: $work" }
}
