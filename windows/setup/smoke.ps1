param(
    [string]$FullSetup = '',
    [string]$LiteSetup = '',
    [string]$RuntimeArchive = "$PSScriptRoot\..\runtime\dist\DeepSeek-Harness-Runtime-win-x64.zip",
    [string]$ResultPath = '',
    [switch]$SkipProcessLockChecks,
    [switch]$KeepArtifactsOnFailure
)

$ErrorActionPreference = 'Stop'
$package = Get-Content (Join-Path $PSScriptRoot '..\..\package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
if ([string]::IsNullOrWhiteSpace($FullSetup)) { $FullSetup = Join-Path $PSScriptRoot "dist\DeepSeek-Harness-Setup-Full-$version-win-x64.exe" }
if ([string]::IsNullOrWhiteSpace($LiteSetup)) { $LiteSetup = Join-Path $PSScriptRoot "dist\DeepSeek-Harness-Setup-Lite-$version-win-x64.exe" }
$dist = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$full = [IO.Path]::GetFullPath($FullSetup)
$lite = [IO.Path]::GetFullPath($LiteSetup)
$runtime = [IO.Path]::GetFullPath($RuntimeArchive)
foreach ($path in @($full, $lite, $runtime)) {
    if (-not (Test-Path $path)) { throw "Setup smoke input is missing: $path" }
}
$runtimeSha256 = (Get-FileHash -LiteralPath $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
$stagePath = if ([string]::IsNullOrWhiteSpace($ResultPath)) { '' } else { [IO.Path]::GetFullPath($ResultPath) + '.stages.log' }
if ($stagePath) { Remove-Item -LiteralPath $stagePath -Force -ErrorAction SilentlyContinue }

function Write-SmokeStage([string]$Stage) {
    if (-not $stagePath) { return }
    $directory = Split-Path $stagePath -Parent
    if ($directory) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    Add-Content -LiteralPath $stagePath -Value ((Get-Date).ToString('o') + ' ' + $Stage) -Encoding UTF8
}

$testRoot = Join-Path $dist ('smoke-install-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$testRootPath = [IO.Path]::GetFullPath($testRoot)
if (-not $testRootPath.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Setup smoke root must stay under $dist"
}
New-Item -ItemType Directory -Path $testRootPath | Out-Null

$previousLocalAppData = $env:LOCALAPPDATA
$shellFoldersPaths = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders'
)
$previousLocalAppDataShellFolders = @($shellFoldersPaths | ForEach-Object {
    $properties = Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue
    [pscustomobject]@{
        Path = $_
        Exists = $null -ne $properties -and $null -ne $properties.PSObject.Properties['Local AppData']
        Value = if ($null -ne $properties) { [string]$properties.'Local AppData' } else { '' }
    }
})
$fullApp = Join-Path $testRootPath '中文 Full 安装'
$shellSandboxRoot = Join-Path $dist '_smoke-shell-localappdata'
$fullLocal = Join-Path $shellSandboxRoot 'full'
$liteApp = Join-Path $testRootPath 'English Lite Install'
$liteLocal = Join-Path $shellSandboxRoot 'lite'
$windowControl = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '..\work\winctl.exe'
$windowControl = [IO.Path]::GetFullPath($windowControl)

function Invoke-Setup([string]$Setup, [string]$App, [string]$Language, [string]$DataMode,
    [string]$RuntimeMode, [string]$RuntimeZip, [string]$LogPath) {
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LANG=' + $Language +
        ' /DIR="' + $App + '" /TASKS="" /LOG="' + $LogPath + '"'
    if (-not [string]::IsNullOrWhiteSpace($DataMode)) {
        $arguments += ' /DATAMODE=' + $DataMode
    }
    if (-not [string]::IsNullOrWhiteSpace($RuntimeMode)) {
        $arguments += ' /RUNTIMEMODE=' + $RuntimeMode
    }
    if (-not [string]::IsNullOrWhiteSpace($RuntimeZip)) {
        $arguments += ' /RUNTIMEZIP="' + $RuntimeZip + '"'
    }
    $process = Start-Process $Setup -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Setup exited with code $($process.ExitCode). Log: $LogPath" }
}

function Invoke-Uninstall([string]$App, [string]$LogPath, [bool]$DeleteUserData = $false) {
    $uninstaller = Join-Path $App 'unins000.exe'
    if (-not (Test-Path $uninstaller)) { throw "Uninstaller is missing: $uninstaller" }
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="' + $LogPath + '"'
    if ($DeleteUserData) { $arguments += ' /DELETEUSERDATA=1' }
    $process = Start-Process $uninstaller -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller exited with code $($process.ExitCode). Log: $LogPath" }
}

function Test-InstalledRuntime([string]$App) {
    $manifestPath = Join-Path $App 'runtime\runtime-manifest.json'
    if (-not (Test-Path $manifestPath)) { throw "Installed runtime manifest is missing: $manifestPath" }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $node = Join-Path (Join-Path $App 'runtime') $manifest.node
    $npm = Join-Path (Join-Path $App 'runtime') $manifest.packageManager.command
    $npmCli = Join-Path (Join-Path $App 'runtime') $manifest.packageManager.cli
    $pnpm = Join-Path (Join-Path $App 'runtime') $manifest.packageManager.pnpmCommand
    $pnpmCli = Join-Path (Join-Path $App 'runtime') $manifest.packageManager.pnpmCli
    $entry = Join-Path (Join-Path $App 'runtime') $manifest.entry
    if (-not (Test-Path $node)) { throw "Installed bundled Node is missing: $node" }
    if (-not (Test-Path $npm)) { throw "Installed bundled npm command is missing: $npm" }
    if (-not (Test-Path $npmCli)) { throw "Installed bundled npm CLI is missing: $npmCli" }
    if (-not (Test-Path $pnpm)) { throw "Installed bundled pnpm command is missing: $pnpm" }
    if (-not (Test-Path $pnpmCli)) { throw "Installed bundled pnpm CLI is missing: $pnpmCli" }
    if (-not (Test-Path $entry)) { throw "Installed runtime entry is missing: $entry" }
    return [pscustomobject]@{
        Version = $manifest.version
        Node = (& $node --version)
        Npm = (& $node $npmCli --version)
        Pnpm = (& $node $pnpmCli --version)
        Entry = $entry
    }
}

function Start-BundledNodeLock([string]$App) {
    $node = Join-Path $App 'runtime\tools\node\node.exe'
    $process = Start-Process -FilePath $node -WorkingDirectory $App `
        -ArgumentList @('-e', 'setInterval(()=>{},1000)') -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 750
    $process.Refresh()
    if ($process.HasExited) { throw "Bundled Node lock process exited early with code $($process.ExitCode)" }
    return $process
}

function Assert-ProcessExited($Process, [string]$Operation) {
    if (-not $Process.WaitForExit(10000)) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        throw "$Operation did not stop bundled Node process $($Process.Id)"
    }
}

function Remove-SmokeRoot {
    if (-not (Test-Path -LiteralPath $testRootPath)) { return }
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            Remove-Item -LiteralPath $testRootPath -Recurse -Force -ErrorAction Stop
            return
        }
        catch {
            if ($attempt -eq 9) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}

function Reset-SmokeProductData([string]$LocalAppData) {
    $productData = Join-Path $LocalAppData 'DeepSeekHarness'
    if (Test-Path -LiteralPath $productData) {
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            try {
                Remove-Item -LiteralPath $productData -Recurse -Force -ErrorAction Stop
                break
            }
            catch {
                if ($attempt -eq 19) { throw }
                Start-Sleep -Milliseconds 250
            }
        }
    }
    New-Item -ItemType Directory -Path $LocalAppData -Force | Out-Null
}

function Stop-SmokeProcessTree($AppProcess, [string]$App, [string]$DataRoot = '') {
    $processId = 0
    if ($AppProcess) {
        if ($AppProcess -is [Diagnostics.Process]) {
            try { $AppProcess.Refresh() } catch {}
            $processId = $AppProcess.Id
            if (-not $AppProcess.HasExited) {
                try { $AppProcess.CloseMainWindow() | Out-Null } catch {}
                try { $AppProcess.WaitForExit(3000) | Out-Null } catch {}
            }
        }
        elseif ($AppProcess.PSObject.Properties['ProcessId']) {
            $processId = [int]$AppProcess.ProcessId
        }
        elseif ($AppProcess.PSObject.Properties['Id']) {
            $processId = [int]$AppProcess.Id
        }
    }
    if ($processId -gt 0) {
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
    }
    $prefixes = @($App)
    if (-not [string]::IsNullOrWhiteSpace($DataRoot)) { $prefixes += $DataRoot }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $commandLine = [string]$_.CommandLine
        $executablePath = [string]$_.ExecutablePath
        ($prefixes | Where-Object {
            $prefix = $_
            ($executablePath -and $executablePath.StartsWith($prefix + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) -or
            ($commandLine -and $commandLine.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0)
        }).Count -gt 0
    } | ForEach-Object {
        & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null
    }
    Start-Sleep -Milliseconds 500
}

function Set-SmokeLocalAppData([string]$Path) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    foreach ($registryPath in $shellFoldersPaths) {
        Set-ItemProperty -LiteralPath $registryPath -Name 'Local AppData' -Value $Path
    }
    $env:LOCALAPPDATA = $Path
}

function Restore-SmokeLocalAppData {
    foreach ($state in $previousLocalAppDataShellFolders) {
        if ($state.Exists) {
            Set-ItemProperty -LiteralPath $state.Path -Name 'Local AppData' -Value $state.Value
        }
        else {
            Remove-ItemProperty -LiteralPath $state.Path -Name 'Local AppData' -ErrorAction SilentlyContinue
        }
    }
    $env:LOCALAPPDATA = $previousLocalAppData
}

function Get-UserEnvironmentValue([string]$Name) {
    try { return [string](Get-ItemProperty -Path 'HKCU:\Environment' -Name $Name -ErrorAction Stop).$Name }
    catch { return $null }
}

function Path-ContainsEntry([string]$PathValue, [string]$Entry) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) { return $false }
    foreach ($part in ($PathValue -split ';')) {
        if ([string]::Equals($part.Trim().TrimEnd('\'), $Entry.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}

function New-HubPersistenceFixture([string]$DataRoot) {
    $setupId = 'hotfix-persisted-plugin'
    $hubRoot = Join-Path $DataRoot 'hub'
    $workspace = Join-Path $hubRoot ('library\' + $setupId)
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    $record = [ordered]@{
        id = $setupId
        name = 'Hotfix persistence fixture'
        version = '1.0.0'
        kind = 'plugin'
        sourceRepository = 'https://github.com/Iraryi/deepseek-harness-hub'
        installedAt = '2026-08-22T00:00:00.0000000Z'
        workspacePath = $workspace
        profile = 'web'
        packageNames = @('hotfix-persisted-plugin')
        removable = $true
        uninstallMethod = 'profile-package'
        activationState = 'activated'
    }
    New-Item -ItemType Directory -Path $hubRoot -Force | Out-Null
    ConvertTo-Json -InputObject @($record) -Depth 8 | Set-Content -LiteralPath (Join-Path $hubRoot 'installed.json') -Encoding UTF8
    @{ id = $setupId; version = '1.0.0'; kind = 'plugin' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspace 'setup.json') -Encoding UTF8
    'persisted receipt' | Set-Content -LiteralPath (Join-Path $workspace 'receipt.txt') -Encoding UTF8
    return $setupId
}

function Assert-HubPersistenceFixture([string]$DataRoot, [string]$SetupId, [string]$Label) {
    $hubRoot = Join-Path $DataRoot 'hub'
    $installedPath = Join-Path $hubRoot 'installed.json'
    $receiptPath = Join-Path $hubRoot ('library\' + $SetupId + '\receipt.txt')
    if (-not (Test-Path -LiteralPath $installedPath)) { throw "$Label removed hub/installed.json" }
    if (-not (Test-Path -LiteralPath $receiptPath)) { throw "$Label removed the installed Setup workspace" }
    $records = @(Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8 | ConvertFrom-Json)
    if (@($records | Where-Object { [string]$_.id -eq $SetupId }).Count -ne 1) { throw "$Label changed the installed Setup record" }
}

function Assert-FirstRunConfigRoute([string]$App, [string]$ConfigPath, [string]$Label) {
    $previousDataDirectory = $env:DEEPSEEK_HARNESS_DATA_DIR
    $previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
    $appProcess = $null
    $configProcess = $null
    try {
        $env:DEEPSEEK_HARNESS_DATA_DIR = Split-Path $ConfigPath -Parent
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'setup-first-run-' + [Guid]::NewGuid().ToString('N')
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        if ($config.FirstRunCompleted) { throw "$Label started with FirstRunCompleted=true" }
        $appProcess = Start-Process (Join-Path $App 'dsh.exe') -WorkingDirectory $App -PassThru
        $deadline = (Get-Date).AddSeconds(15)
        while ((Get-Date) -lt $deadline) {
            $configProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -eq 'dsh-config.exe' -and $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $App 'dsh-config.exe'), [StringComparison]::OrdinalIgnoreCase)
            } | Select-Object -First 1
            if ($configProcess) { break }
            if ($appProcess.HasExited -and -not $configProcess) { Start-Sleep -Milliseconds 150 }
            else { Start-Sleep -Milliseconds 100 }
        }
        if (-not $configProcess) {
            $state = if ($appProcess.HasExited) { "exited=$($appProcess.ExitCode)" } else { 'running' }
            throw "$Label did not route to dsh-config.exe ($state)"
        }
        $node = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($App + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
        } | Select-Object -First 1
        if ($node) { throw "$Label started a packaged Node.js process before CONFIG completed: $($node.ProcessId)" }
        [pscustomobject]@{ Label = $Label; ConfigProcessId = $configProcess.ProcessId; RoutedToConfig = $true; NodeStarted = $false }
    }
    finally {
        if ($configProcess) { & taskkill.exe /PID $configProcess.ProcessId /T /F 2>$null | Out-Null }
        if ($appProcess -and -not $appProcess.HasExited) { & taskkill.exe /PID $appProcess.Id /T /F 2>$null | Out-Null }
        try { if ($appProcess) { $appProcess.WaitForExit(5000) | Out-Null } } catch {}
        $env:DEEPSEEK_HARNESS_DATA_DIR = $previousDataDirectory
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
        Start-Sleep -Milliseconds 500
    }
}

function Invoke-ConfigSaveAndLaunch([string]$App, [string]$DataRoot, [string]$DshHome) {
    $helper = Join-Path $DataRoot 'config-save-and-launch.ps1'
    @'
param([string]$App,[string]$Data,[string]$DshHome)
$ErrorActionPreference = 'Stop'
$env:DEEPSEEK_HARNESS_DATA_DIR = $Data
$env:DSH_HOME = $DshHome
$assembly = [Reflection.Assembly]::LoadFrom((Join-Path $App 'dsh-config.exe'))
$type = $assembly.GetType('ConfigForm', $true)
$form = [Activator]::CreateInstance($type, [object[]]@($true, $false))
$method = $type.GetMethod('SaveAndClose', [Reflection.BindingFlags]'Instance,NonPublic')
$method.Invoke($form, [object[]]@($true)) | Out-Null
$launchAfterClose = $type.GetProperty('LaunchAfterClose', [Reflection.BindingFlags]'Instance,Public,NonPublic')
if ($null -eq $launchAfterClose -or -not [bool]$launchAfterClose.GetValue($form, $null)) { throw 'CONFIG did not record the post-close launch handoff' }
$form.Dispose()
$launchMethod = $type.GetMethod('LaunchApplicationAfterClose', [Reflection.BindingFlags]'Instance,Public,NonPublic')
if ($null -eq $launchMethod) { throw 'CONFIG post-close launch method is missing' }
$launchMethod.Invoke($form, $null) | Out-Null
'@ | Set-Content -LiteralPath $helper -Encoding UTF8
    & powershell.exe -NoProfile -Sta -ExecutionPolicy Bypass -File $helper -App $App -Data $DataRoot -DshHome $DshHome
    if ($LASTEXITCODE -ne 0) { throw "CONFIG save-and-run helper failed with code $LASTEXITCODE" }
}

function Start-InstalledAppSmoke([string]$App, [string]$ConfigPath) {
    $previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
    $previousDataDirectory = $env:DEEPSEEK_HARNESS_DATA_DIR
    $previousDshHome = $env:DSH_HOME
    $appProcess = $null
    try {
        $dataRoot = Split-Path $ConfigPath -Parent
        $env:DEEPSEEK_HARNESS_DATA_DIR = $dataRoot
        $dshHome = Join-Path $dataRoot 'cold-dsh-home'
        $webViewData = Join-Path $dataRoot 'WebView2'
        if (Test-Path -LiteralPath $dshHome) { Remove-Item -LiteralPath $dshHome -Recurse -Force }
        if (Test-Path -LiteralPath $webViewData) { Remove-Item -LiteralPath $webViewData -Recurse -Force }
        New-Item -ItemType Directory -Path $dshHome -Force | Out-Null
        $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
        if ($config.FirstRunCompleted) { throw 'Installed application smoke must begin with FirstRunCompleted=false' }
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
        try {
            $listener.Start()
            $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
        }
        finally {
            $listener.Stop()
        }
        $config.FirstRunCompleted = $false
        $config.Port = $port
        $config.Url = "http://127.0.0.1:$port"
        $config.LoadingStyle = 'whales'
        $config.CloseAction = 'exit'
        $config.LaunchMode = 'window'
        [IO.File]::WriteAllText($ConfigPath, ($config | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))

        $env:DSH_HOME = $dshHome
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'setup-smoke-config-handoff-' + [Guid]::NewGuid().ToString('N')
        $appLog = Join-Path $dataRoot 'logs\app.log'
        Remove-Item -LiteralPath $appLog -Force -ErrorAction SilentlyContinue
        Invoke-ConfigSaveAndLaunch $App $dataRoot $dshHome
        $expectedLauncher = Join-Path $App 'dsh.exe'
        $expectedNode = Join-Path $App 'runtime\tools\node\node.exe'
        $response = $null
        $nodeProcess = $null
        $appProcess = $null
        $lastWebError = $null
        $deadline = (Get-Date).AddSeconds(150)
        while ((Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $appProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -eq 'dsh.exe' -and $_.ExecutablePath -and $_.ExecutablePath.Equals($expectedLauncher, [StringComparison]::OrdinalIgnoreCase)
            } | Select-Object -First 1
            if ($appProcess) {
                $nodeProcess = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                    $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $appProcess.ProcessId
                } | Select-Object -First 1
            }
            try {
                $response = Invoke-WebRequest "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2
            }
            catch {
                $lastWebError = $_.Exception.Message
            }
            $logText = if (Test-Path -LiteralPath $appLog) { Get-Content -LiteralPath $appLog -Raw } else { '' }
            if ($logText.Contains('Web UI boot failed:') -or $logText.Contains('Web UI boot status timed out:')) {
                throw "Installed WebView2 failed during the first CONFIG save-and-run launch. Last HTTP error: $lastWebError`n$logText"
            }
            if ($response -and $response.StatusCode -eq 200 -and $logText.Contains('Web UI boot verified by structured ready status')) { break }
        }
        if (-not $appProcess) { throw 'CONFIG save-and-run did not start dsh.exe' }
        if (-not $nodeProcess) { throw 'CONFIG save-and-run did not start the bundled Node process' }
        if (-not $nodeProcess.ExecutablePath.Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Installed application used the wrong Node: $($nodeProcess.ExecutablePath)"
        }
        if ($nodeProcess.CommandLine -notmatch '--import.+runtime-resolver\.mjs') {
            throw "Installed application did not load the packaged Runtime resolver: $($nodeProcess.CommandLine)"
        }
        $logText = if (Test-Path -LiteralPath $appLog) { Get-Content -LiteralPath $appLog -Raw } else { '' }
        $startCount = ([regex]::Matches($logText, 'Starting server \(')).Count
        $restartCount = ([regex]::Matches($logText, 'Restarting local service')).Count
        if ($startCount -ne 1) { throw "First CONFIG save-and-run launch started the local service $startCount times" }
        if ($restartCount -ne 0) { throw "First CONFIG save-and-run launch unexpectedly restarted the local service $restartCount times" }
        if (-not $response -or $response.StatusCode -ne 200) { throw "Installed application did not reach HTTP 200 after one launch. Last error: $lastWebError" }
        if (-not $logText.Contains('Plugin graph ready: ')) { throw 'Installed launcher did not observe the settled plugin graph' }
        if (-not $logText.Contains('Page loaded: ')) { throw 'Installed launcher did not complete its WebView2 navigation' }
        if (-not $logText.Contains('Web UI boot verified by structured ready status')) { throw 'Installed WebView2 did not verify a successful plugin boot' }
        return [pscustomobject]@{
            HttpStatus = $response.StatusCode
            Port = $port
            BundledNode = $nodeProcess.ExecutablePath
            NodeWindowHandle = (Get-Process -Id $nodeProcess.ProcessId).MainWindowHandle
            DesktopPatch = $nodeProcess.CommandLine -match '--patch'
            RuntimeResolver = $nodeProcess.CommandLine -match '--import.+runtime-resolver\.mjs'
            PluginGraphReady = $true
            PageLoaded = $true
            WebUiPluginBootVerified = $true
            ConfigSaveAndRun = $true
            LaunchAttempts = 1
        }
    }
    finally {
        Stop-SmokeProcessTree $appProcess $App $dataRoot
        $env:DSH_HOME = $previousDshHome
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
        $env:DEEPSEEK_HARNESS_DATA_DIR = $previousDataDirectory
    }
}

$fullResult = $null
$liteResult = $null
$smokeSucceeded = $false
$initialUserPath = Get-UserEnvironmentValue 'Path'
$initialDshHome = Get-UserEnvironmentValue 'DSH_HOME'
try {
    Write-SmokeStage 'start'
    Reset-SmokeProductData $fullLocal
    Reset-SmokeProductData $liteLocal
    Set-SmokeLocalAppData $fullLocal
    $fullInstallLog = Join-Path $testRootPath 'full-install.log'
    Invoke-Setup $full $fullApp 'chinesesimp' '' '' '' $fullInstallLog
    Write-SmokeStage 'full-installed'
    foreach ($launcherName in @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe')) {
        if (-not (Test-Path (Join-Path $fullApp $launcherName))) {
            throw "Full Setup did not install $launcherName"
        }
    }
    $fullRuntime = Test-InstalledRuntime $fullApp
    $fullRuntimeSource = (Get-Content -LiteralPath (Join-Path $fullApp 'runtime\.source-sha256') -Raw).Trim()
    if (-not $fullRuntimeSource.Equals($runtimeSha256, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Full Setup did not record the installed Runtime archive identity'
    }
    $fullConfigPath = Join-Path $fullLocal 'DeepSeekHarness\config.json'
    $fullConfig = Get-Content $fullConfigPath -Raw | ConvertFrom-Json
    if ($fullConfig.Language -ne 'zh-CN' -or $fullConfig.FirstRunCompleted) {
        throw 'Full Setup did not seed the expected Chinese first-run configuration'
    }
    $freshFirstRun = Assert-FirstRunConfigRoute $fullApp $fullConfigPath 'Fresh Full Setup'
    Write-SmokeStage 'full-first-run-route'
    $installedUserPath = Get-UserEnvironmentValue 'Path'
    if (-not (Path-ContainsEntry $installedUserPath $fullApp)) { throw 'Full Setup did not register its application directory in the per-user PATH' }
    if ([string]::IsNullOrWhiteSpace($initialDshHome)) {
        $expectedDshHome = Join-Path $fullLocal 'DeepSeekHarness\dsh'
        if (-not [string]::Equals((Get-UserEnvironmentValue 'DSH_HOME'), $expectedDshHome, [StringComparison]::OrdinalIgnoreCase)) { throw 'Full Setup did not register the owned DSH_HOME value' }
    }
    if (Test-Path (Join-Path $fullApp 'portable.mode')) { throw 'Recommended Full Setup created portable.mode' }

    'standard user data' | Set-Content (Join-Path $fullLocal 'DeepSeekHarness\user-keep.txt') -Encoding UTF8
    'user-owned root file' | Set-Content (Join-Path $fullApp 'user-owned.txt') -Encoding UTF8
    $fullHubSetupId = New-HubPersistenceFixture (Join-Path $fullLocal 'DeepSeekHarness')

    if (-not (Test-Path (Join-Path $fullApp 'setup\stop-installed-processes.ps1'))) {
        throw 'Full Setup did not install its uninstall process-cleanup helper'
    }
    'stale-runtime-for-upgrade-regression' | Set-Content (Join-Path $fullApp 'runtime\.source-sha256') -Encoding ASCII
    $upgradeLock = if ($SkipProcessLockChecks) { $null } else { Start-BundledNodeLock $fullApp }
    $fullUpgradeLog = Join-Path $testRootPath 'full-upgrade.log'
    Invoke-Setup $full $fullApp 'chinesesimp' '' '' '' $fullUpgradeLog
    Write-SmokeStage 'full-updated'
    if ($upgradeLock) { Assert-ProcessExited $upgradeLock 'Full upgrade' }
    $fullUpgradeRuntimeSource = (Get-Content -LiteralPath (Join-Path $fullApp 'runtime\.source-sha256') -Raw).Trim()
    if (-not $fullUpgradeRuntimeSource.Equals($runtimeSha256, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Full upgrade did not replace the stale packaged Runtime'
    }
    if (-not (Test-Path (Join-Path $fullLocal 'DeepSeekHarness\user-keep.txt'))) { throw 'Full upgrade removed standard user data' }
    Assert-HubPersistenceFixture (Join-Path $fullLocal 'DeepSeekHarness') $fullHubSetupId 'Full upgrade'
    $fullUpgradeHubSmoke = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $PSScriptRoot '..\launcher\smoke-hub-persistence.ps1') -LauncherDirectory $fullApp `
        -ExpectedDataRoot (Join-Path $fullLocal 'DeepSeekHarness') -SetupId $fullHubSetupId -VerifyBackupRecovery
    if ($LASTEXITCODE -ne 0) { throw "Full upgrade HUB persistence smoke failed with code $LASTEXITCODE" }
    Write-SmokeStage 'full-hub-after-update'
    $fullAppSmoke = Start-InstalledAppSmoke $fullApp $fullConfigPath
    Write-SmokeStage 'full-app-smoke'
    $processJobSmoke = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $PSScriptRoot '..\launcher\smoke-process-job.ps1') -AppDirectory $fullApp -Runs 3
    if ($LASTEXITCODE -ne 0) { throw "Full process-job smoke failed with code $LASTEXITCODE" }
    Write-SmokeStage 'full-process-job'

    $uninstallLock = if ($SkipProcessLockChecks) { $null } else { Start-BundledNodeLock $fullApp }
    $fullUninstallLog = Join-Path $testRootPath 'full-uninstall.log'
    Invoke-Uninstall $fullApp $fullUninstallLog
    Write-SmokeStage 'full-uninstalled-keep'
    if ($uninstallLock) { Assert-ProcessExited $uninstallLock 'Full uninstall' }
    if (Test-Path (Join-Path $fullApp 'runtime')) { throw 'Full uninstall left the packaged Runtime behind' }
    Assert-HubPersistenceFixture (Join-Path $fullLocal 'DeepSeekHarness') $fullHubSetupId 'Full uninstall with data retention'
    $reinstallLog = Join-Path $testRootPath 'full-reinstall.log'
    Invoke-Setup $full $fullApp 'chinesesimp' '' '' '' $reinstallLog
    Write-SmokeStage 'full-reinstalled'
    $reinstallConfig = Get-Content $fullConfigPath -Raw | ConvertFrom-Json
    if ($reinstallConfig.Language -ne 'zh-CN' -or $reinstallConfig.FirstRunCompleted) { throw 'Full reinstall did not reset onboarding before launching Desktop' }
    Assert-HubPersistenceFixture (Join-Path $fullLocal 'DeepSeekHarness') $fullHubSetupId 'Full reinstall'
    $fullReinstallHubSmoke = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $PSScriptRoot '..\launcher\smoke-hub-persistence.ps1') -LauncherDirectory $fullApp `
        -ExpectedDataRoot (Join-Path $fullLocal 'DeepSeekHarness') -SetupId $fullHubSetupId
    if ($LASTEXITCODE -ne 0) { throw "Full reinstall HUB persistence smoke failed with code $LASTEXITCODE" }
    Write-SmokeStage 'full-hub-after-reinstall'
    $reinstallFirstRun = Assert-FirstRunConfigRoute $fullApp $fullConfigPath 'Uninstall then reinstall Full Setup'
    $reinstallLock = if ($SkipProcessLockChecks) { $null } else { Start-BundledNodeLock $fullApp }
    $secondUninstallLog = Join-Path $testRootPath 'full-second-uninstall.log'
    Invoke-Uninstall $fullApp $secondUninstallLog
    Write-SmokeStage 'full-final-uninstall'
    if ($reinstallLock) { Assert-ProcessExited $reinstallLock 'Full reinstall uninstall' }
    if (Test-Path (Join-Path $fullApp 'runtime')) { throw 'Full reinstall uninstall left the packaged Runtime behind' }
    $remainingUserPath = Get-UserEnvironmentValue 'Path'
    if (Path-ContainsEntry $remainingUserPath $fullApp) { throw 'Full uninstall left its application directory in the per-user PATH' }
    if ([string]::IsNullOrWhiteSpace($initialDshHome) -and (Get-UserEnvironmentValue 'DSH_HOME')) { throw 'Full uninstall left its owned DSH_HOME value' }
    $fullResult = [pscustomobject]@{
        Language = 'zh-CN'
        RecommendedDefaults = $true
        PortableMarker = Test-Path (Join-Path $fullApp 'portable.mode')
        RuntimeVersion = $fullRuntime.Version
        RuntimeRemoved = -not (Test-Path (Join-Path $fullApp 'runtime'))
        UserDataPreserved = Test-Path (Join-Path $fullLocal 'DeepSeekHarness\user-keep.txt')
        UserRootFilePreserved = Test-Path (Join-Path $fullApp 'user-owned.txt')
        FreshFirstRun = $freshFirstRun
        ReinstallFirstRun = $reinstallFirstRun
        AppSmoke = $fullAppSmoke
        ProcessJobSmoke = $processJobSmoke
        UpgradeStoppedLockedNode = if ($upgradeLock) { $upgradeLock.HasExited } else { $null }
        UpgradeReplacedStaleRuntime = $fullUpgradeRuntimeSource.Equals($runtimeSha256, [StringComparison]::OrdinalIgnoreCase)
        HubPreservedOnUpgrade = $true
        HubPreservedOnReinstall = $true
        HubSmokeAfterUpgrade = $fullUpgradeHubSmoke
        HubSmokeAfterReinstall = $fullReinstallHubSmoke
        UninstallStoppedLockedNode = if ($uninstallLock) { $uninstallLock.HasExited } else { $null }
        ReinstallStoppedLockedNode = if ($reinstallLock) { $reinstallLock.HasExited } else { $null }
    }

    Set-SmokeLocalAppData $liteLocal
    $liteInstallLog = Join-Path $testRootPath 'lite-install.log'
    Invoke-Setup $lite $liteApp 'english' 'portable' 'archive' $runtime $liteInstallLog
    Write-SmokeStage 'lite-installed'
    foreach ($launcherName in @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe')) {
        if (-not (Test-Path (Join-Path $liteApp $launcherName))) {
            throw "Lite Setup did not install $launcherName"
        }
    }
    $liteRuntime = Test-InstalledRuntime $liteApp
    $liteConfigPath = Join-Path $liteApp 'data\config.json'
    $liteConfig = Get-Content $liteConfigPath -Raw | ConvertFrom-Json
    if ($liteConfig.Language -ne 'en-US' -or $liteConfig.FirstRunCompleted) {
        throw 'Lite Setup did not seed the expected English first-run configuration'
    }
    if (-not (Test-Path (Join-Path $liteApp 'portable.mode'))) { throw 'Lite portable install did not create portable.mode' }
    'portable user data' | Set-Content (Join-Path $liteApp 'data\user-keep.txt') -Encoding UTF8
    $liteHubSetupId = New-HubPersistenceFixture (Join-Path $liteApp 'data')
    $liteUpdateLog = Join-Path $testRootPath 'lite-update.log'
    Invoke-Setup $lite $liteApp 'english' 'portable' 'archive' $runtime $liteUpdateLog
    Write-SmokeStage 'lite-updated'
    Assert-HubPersistenceFixture (Join-Path $liteApp 'data') $liteHubSetupId 'Lite upgrade'
    $liteUpdateHubSmoke = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $PSScriptRoot '..\launcher\smoke-hub-persistence.ps1') -LauncherDirectory $liteApp `
        -ExpectedDataRoot (Join-Path $liteApp 'data') -SetupId $liteHubSetupId
    if ($LASTEXITCODE -ne 0) { throw "Lite upgrade HUB persistence smoke failed with code $LASTEXITCODE" }
    Write-SmokeStage 'lite-hub-after-update'

    $liteUninstallLog = Join-Path $testRootPath 'lite-uninstall.log'
    Invoke-Uninstall $liteApp $liteUninstallLog
    Write-SmokeStage 'lite-uninstalled-keep'
    if (Test-Path (Join-Path $liteApp 'runtime')) { throw 'Lite uninstall left the packaged Runtime behind' }
    Assert-HubPersistenceFixture (Join-Path $liteApp 'data') $liteHubSetupId 'Lite uninstall with data retention'
    Remove-Item -LiteralPath (Join-Path $liteApp 'portable.mode') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $liteApp 'data\.dsh-portable-data') -Force -ErrorAction SilentlyContinue
    $liteReinstallLog = Join-Path $testRootPath 'lite-reinstall.log'
    Invoke-Setup $lite $liteApp 'english' '' 'archive' $runtime $liteReinstallLog
    Write-SmokeStage 'lite-reinstalled-from-legacy-data'
    Assert-HubPersistenceFixture (Join-Path $liteApp 'data') $liteHubSetupId 'Lite reinstall'
    if (-not (Test-Path (Join-Path $liteApp 'portable.mode'))) { throw 'Lite reinstall did not recover portable mode from retained legacy data' }
    if (-not (Test-Path (Join-Path $liteApp 'data\.dsh-portable-data'))) { throw 'Lite reinstall did not restore the portable data identity marker' }
    $liteReinstallHubSmoke = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
        (Join-Path $PSScriptRoot '..\launcher\smoke-hub-persistence.ps1') -LauncherDirectory $liteApp `
        -ExpectedDataRoot (Join-Path $liteApp 'data') -SetupId $liteHubSetupId -VerifyBackupRecovery
    if ($LASTEXITCODE -ne 0) { throw "Lite reinstall HUB persistence smoke failed with code $LASTEXITCODE" }
    Write-SmokeStage 'lite-hub-after-reinstall'
    $liteFinalUninstallLog = Join-Path $testRootPath 'lite-final-uninstall.log'
    Invoke-Uninstall $liteApp $liteFinalUninstallLog
    Write-SmokeStage 'lite-final-uninstall'
    Assert-HubPersistenceFixture (Join-Path $liteApp 'data') $liteHubSetupId 'Lite repeated uninstall with data retention'
    if (Path-ContainsEntry (Get-UserEnvironmentValue 'Path') $liteApp) { throw 'Lite uninstall left its application directory in the per-user PATH' }
    if ([string]::IsNullOrWhiteSpace($initialDshHome) -and (Get-UserEnvironmentValue 'DSH_HOME')) { throw 'Lite uninstall left its owned DSH_HOME value' }
    $liteResult = [pscustomobject]@{
        Language = 'en-US'
        PortableMarker = Test-Path (Join-Path $liteApp 'portable.mode')
        RuntimeVersion = $liteRuntime.Version
        RuntimeRemoved = -not (Test-Path (Join-Path $liteApp 'runtime'))
        UserDataPreserved = Test-Path (Join-Path $liteApp 'data\user-keep.txt')
        HubPreservedOnUpgrade = $true
        HubPreservedOnReinstall = $true
        LegacyPortableDataRecovered = $true
        HubSmokeAfterUpgrade = $liteUpdateHubSmoke
        HubSmokeAfterReinstall = $liteReinstallHubSmoke
    }

    $summary = [pscustomobject]@{
        Root = $testRootPath
        Full = $fullResult
        Lite = $liteResult
    }
    if (-not [string]::IsNullOrWhiteSpace($ResultPath)) {
        $resolvedResultPath = [IO.Path]::GetFullPath($ResultPath)
        $resultDirectory = Split-Path $resolvedResultPath -Parent
        if (-not [string]::IsNullOrWhiteSpace($resultDirectory)) {
            New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
        }
        [IO.File]::WriteAllText($resolvedResultPath, ($summary | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    }
    $summary
    $smokeSucceeded = $true
    Write-SmokeStage 'passed'
}
catch {
    Write-SmokeStage ('failed: ' + ($_ | Out-String).Trim())
    throw
}
finally {
    Restore-SmokeLocalAppData
    if ($KeepArtifactsOnFailure -and -not $smokeSucceeded) {
        Write-Warning "Setup smoke failed; preserving artifacts under $testRootPath"
    }
    else {
        Reset-SmokeProductData $fullLocal
        Reset-SmokeProductData $liteLocal
        Remove-SmokeRoot
    }
}
