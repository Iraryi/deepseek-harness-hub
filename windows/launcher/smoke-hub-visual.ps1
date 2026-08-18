param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [string]$OutputDirectory = "$PSScriptRoot\visual-output",
    [string]$RuntimeDirectory = ''
)

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$output = [IO.Path]::GetFullPath($OutputDirectory)
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtime = if ([string]::IsNullOrWhiteSpace($RuntimeDirectory)) { '' } else { [IO.Path]::GetFullPath($RuntimeDirectory) }
$windowControl = Join-Path (Split-Path $repository -Parent) 'work\winctl.exe'
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousOffline = $env:DEEPSEEK_HARNESS_OFFLINE
New-Item -ItemType Directory -Path $output -Force | Out-Null

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
}

function Wait-MainWindow([Diagnostics.Process]$Process) {
    $deadline = (Get-Date).AddSeconds(30)
    do {
        $Process.Refresh()
        if ($Process.MainWindowHandle -ne 0) { return }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    throw "HUB main window missing for process $($Process.Id)"
}

function Wait-ChildNode([int]$ParentProcessId) {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        $node = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $ParentProcessId
        } | Select-Object -First 1
        if ($node) { return $node }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw "HUB child node.exe missing for process $ParentProcessId"
}

function Wait-WebUiReady([string]$DataDirectory) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $logs = Get-ChildItem (Join-Path $DataDirectory 'logs') -File -ErrorAction SilentlyContinue
        foreach ($log in $logs) {
            if ((Get-Content -LiteralPath $log.FullName -Raw -ErrorAction SilentlyContinue) -match 'Web UI boot verified') { return }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw 'HUB Web UI did not report structured readiness'
}

function Invoke-HubFrame([string]$Name, [string]$Theme, [int]$Width, [int]$Height, [string]$DetailMode, [bool]$OpenDetail, [bool]$OpenFilters) {
    $work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-hub-visual-' + [Guid]::NewGuid().ToString('N'))
    $app = $null
    try {
        New-Item -ItemType Directory -Path (Join-Path $work 'data') -Force | Out-Null
        foreach ($file in @('dsh-hub.exe', 'dsh.exe', 'dsh-config.exe', 'community-registry.json', 'dshmk-catalog.json', 'THIRD-PARTY-NOTICES.txt')) {
            Copy-Item -LiteralPath (Join-Path $launcher $file) -Destination $work
        }
        Copy-Item -Path (Join-Path $launcher '*.dll') -Destination $work
        New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null
        $inject = ''
        if ($OpenDetail -or $OpenFilters) {
            $inject = Join-Path $work 'open-detail.js'
            $openDetailValue = if ($OpenDetail) { 'true' } else { 'false' }
            $openFiltersValue = if ($OpenFilters) { 'true' } else { 'false' }
            @"
(() => {
  const openDetail = $openDetailValue
  const openFilters = $openFiltersValue
  let attempts = 0
  let detailOpened = !openDetail
  let filtersOpened = !openFilters
  const timer = setInterval(() => {
    attempts += 1
    const buttons = Array.from(document.querySelectorAll('button'))
    const details = buttons.find(button => button.textContent?.includes('项目详情'))
    const filters = buttons.find(button => button.getAttribute('aria-label') === '筛选' || button.textContent?.includes('筛选'))
    if (!detailOpened && details instanceof HTMLButtonElement) {
      detailOpened = true
      details.click()
    }
    if (!filtersOpened && filters instanceof HTMLButtonElement) {
      filtersOpened = true
      filters.scrollIntoView({ block: 'center' })
      filters.click()
    }
    if (detailOpened && filtersOpened) {
      clearInterval(timer)
    } else if (attempts > 120) {
      clearInterval(timer)
    }
  }, 250)
})()
"@ | Set-Content -LiteralPath $inject -Encoding UTF8
        }

        $port = Get-FreePort
        [ordered]@{
            ResolutionWidth = $Width
            ResolutionHeight = $Height
            Language = 'zh-CN'
            FirstRunCompleted = $true
            LaunchMode = 'window'
            Url = "http://127.0.0.1:$port"
            Port = $port
            NodePath = if ([string]::IsNullOrWhiteSpace($runtime)) { (Get-Command node.exe -ErrorAction Stop).Source } else { Join-Path $runtime 'tools\node\node.exe' }
            RepoPath = if ([string]::IsNullOrWhiteSpace($runtime)) { $repository } else { $runtime }
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
            InjectJs = $inject
            DevTools = $false
            ExternalLinksInBrowser = $true
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $work 'data\config.json') -Encoding UTF8
        [ordered]@{
            Theme = $Theme
            StartPage = 'github'
            DiscoverySource = 'dshmk'
            PageSize = 24
            DetailEntry = 'button'
            DetailMode = $DetailMode
            DetailContent = 'native'
            LoadingStyle = 'off'
            CloseAction = 'exit'
            ShowTrayButton = $true
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $work 'data\hub-config.json') -Encoding UTF8

        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'VISUAL-' + [Guid]::NewGuid().ToString('N')
        $env:DEEPSEEK_HARNESS_OFFLINE = '1'
        $app = Start-Process (Join-Path $work 'dsh-hub.exe') -WorkingDirectory $work -PassThru
        Wait-MainWindow $app
        [void](Wait-ChildNode $app.Id)
        Wait-WebUiReady (Join-Path $work 'data')
        $isolatedProfile = Join-Path $work 'data\hub\runtime-home\profiles\web\package.json'
        if (-not (Test-Path -LiteralPath $isolatedProfile)) { throw "HUB did not initialize its isolated Web Profile: $isolatedProfile" }
        & $windowControl resize $app.Id $Width $Height | Out-Null
        Start-Sleep -Seconds $(if ($OpenDetail -or $OpenFilters) { 4 } else { 1 })
        $image = Join-Path $output ($Name + '.png')
        & $windowControl screen $app.Id $image | Out-Null
        $info = & $windowControl info $app.Id
        [pscustomobject]@{ Name = $Name; Theme = $Theme; Width = $Width; Height = $Height; DetailMode = $DetailMode; Image = $image; Window = $info }
    }
    finally {
        if ($app -and -not $app.HasExited) {
            Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
            try { $app.WaitForExit(10000) | Out-Null } catch {}
        }
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $work + '*')
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        for ($attempt = 0; $attempt -lt 20 -and (Test-Path -LiteralPath $work); $attempt++) {
            try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
            catch { Start-Sleep -Milliseconds 250 }
        }
    }
}

try {
    @(
        Invoke-HubFrame 'hub-light-catalog' 'light' 1280 800 'side' $false $false
        Invoke-HubFrame 'hub-dark-modal' 'dark' 1180 780 'modal' $true $false
        Invoke-HubFrame 'hub-narrow-catalog' 'light' 900 720 'side' $false $false
        Invoke-HubFrame 'hub-filter-popover' 'light' 1180 780 'side' $false $true
    )
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_OFFLINE = $previousOffline
}
