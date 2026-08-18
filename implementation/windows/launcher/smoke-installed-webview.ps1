param(
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,
    [ValidateSet('dsh.exe', 'dsh-hub.exe')]
    [string]$LauncherName = 'dsh.exe',
    [string]$DataDirectory = '',
    [int]$Runs = 10
)

$ErrorActionPreference = 'Stop'
$app = [IO.Path]::GetFullPath($AppDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$temporaryData = [string]::IsNullOrWhiteSpace($DataDirectory)
$data = if ($temporaryData) {
    Join-Path ([IO.Path]::GetTempPath()) ('dsh-installed-webview-' + [Guid]::NewGuid().ToString('N'))
} else {
    [IO.Path]::GetFullPath($DataDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
}
$launcherPath = Join-Path $app $LauncherName
$logPath = Join-Path $data 'logs\app.log'
$configPath = Join-Path $data 'config.json'
$hubConfigPath = Join-Path $data 'hub-config.json'
$stopScript = Join-Path $PSScriptRoot '..\setup\stop-installed-processes.ps1'
if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Launcher is missing: $launcherPath" }

function Get-InstalledProcesses {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($app + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    })
}

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

function Wait-FirstRunConfig {
    param([Diagnostics.Process]$Launcher)

    $deadline = (Get-Date).AddSeconds(30)
    do {
        $config = Get-InstalledProcesses | Where-Object { $_.Name -eq 'dsh-config.exe' } | Select-Object -First 1
        if ($config) {
            $process = Get-Process -Id $config.ProcessId -ErrorAction Stop
            $process.Refresh()
            if ($process.MainWindowHandle -ne 0) {
                $Launcher.Refresh()
                if ($Launcher.HasExited) {
                    $node = Get-InstalledProcesses | Where-Object { $_.Name -eq 'node.exe' }
                    if ($node) { throw 'First-run CONFIG started the application Node.js service before configuration completed' }
                    return
                }
            }
        }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw 'First-run CONFIG did not present a native window'
}

$hadConfig = Test-Path -LiteralPath $configPath
$savedConfig = if ($hadConfig) { [IO.File]::ReadAllBytes($configPath) } else { $null }
$hadHubConfig = Test-Path -LiteralPath $hubConfigPath
$savedHubConfig = if ($hadHubConfig) { [IO.File]::ReadAllBytes($hubConfigPath) } else { $null }
$hadLog = Test-Path -LiteralPath $logPath
$savedLog = if ($hadLog) { [IO.File]::ReadAllBytes($logPath) } else { $null }
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousDataDirectory = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousDshHome = $env:DSH_HOME
$results = @()
try {
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $data 'dsh-home'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -AppDirectory $app
    New-Item -ItemType Directory -Path (Split-Path $logPath -Parent) -Force | Out-Null

    if (-not $hadConfig) {
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'installed-first-run-smoke-' + [Guid]::NewGuid().ToString('N')
        $firstRunLauncher = Start-Process -FilePath $launcherPath -WorkingDirectory $app -PassThru -WindowStyle Minimized
        Wait-FirstRunConfig $firstRunLauncher
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -AppDirectory $app
        if (@(Get-InstalledProcesses).Count -ne 0) { throw 'First-run CONFIG processes did not stop cleanly' }
        $results += [pscustomobject]@{
            Run = 0
            Launcher = $LauncherName
            WebView2 = 'first-run-config-verified'
            RemainingInstalledProcesses = 0
        }
    }

    $port = Get-FreePort
    [ordered]@{
        ResolutionWidth = 1280
        ResolutionHeight = 800
        Language = 'en-US'
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
        ShowTrayButton = $true
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = ''
        DevTools = $false
        ExternalLinksInBrowser = $true
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $configPath -Encoding UTF8
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
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $hubConfigPath -Encoding UTF8

    for ($run = 1; $run -le $Runs; $run++) {
        $marker = 'CODEX_WEBVIEW_SMOKE_' + [Guid]::NewGuid().ToString('N')
        [IO.File]::AppendAllText($logPath, $marker + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'installed-webview-smoke-' + [Guid]::NewGuid().ToString('N')
        $launcher = Start-Process -FilePath $launcherPath -WorkingDirectory $app -PassThru -WindowStyle Minimized
        $outcome = 'timeout'
        $segment = ''
        for ($attempt = 0; $attempt -lt 180; $attempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-Path -LiteralPath $logPath) {
                $text = Get-Content -LiteralPath $logPath -Raw
                $markerIndex = $text.LastIndexOf($marker, [StringComparison]::Ordinal)
                if ($markerIndex -ge 0) { $segment = $text.Substring($markerIndex) }
                if ($segment.Contains('Web UI boot failed:')) {
                    $outcome = 'failed'
                    break
                }
                if ($segment.Contains('Web UI boot verified by structured ready status')) {
                    $outcome = 'verified'
                    break
                }
            }
            $launcher.Refresh()
            if ($launcher.HasExited) {
                $outcome = 'launcher-exited'
                break
            }
        }

        $launcher.Refresh()
        if (-not $launcher.HasExited) {
            Stop-Process -Id $launcher.Id -Force
            $launcher.WaitForExit()
        }
        Start-Sleep -Seconds 2
        $remaining = @(Get-InstalledProcesses)
        $results += [pscustomobject]@{
            Run = $run
            Launcher = $LauncherName
            WebView2 = $outcome
            RemainingInstalledProcesses = $remaining.Count
        }
        if ($outcome -ne 'verified') {
            throw "Run $run did not render the real Web UI ($outcome). Log segment:`n$segment"
        }
        if ($remaining.Count -ne 0) {
            $details = $remaining | ForEach-Object { "$($_.Name):$($_.ProcessId)" }
            throw "Run $run left installed processes: $($details -join ', ')"
        }
    }

    $results
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousDataDirectory
    $env:DSH_HOME = $previousDshHome
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript -AppDirectory $app
    if ($hadConfig) {
        [IO.File]::WriteAllBytes($configPath, $savedConfig)
    } else {
        Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    }
    if ($hadHubConfig) {
        [IO.File]::WriteAllBytes($hubConfigPath, $savedHubConfig)
    } else {
        Remove-Item -LiteralPath $hubConfigPath -Force -ErrorAction SilentlyContinue
    }
    if ($hadLog) {
        [IO.File]::WriteAllBytes($logPath, $savedLog)
    } else {
        Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    }
    if ($temporaryData -and (Test-Path -LiteralPath $data)) {
        Remove-Item -LiteralPath $data -Recurse -Force
    }
}
