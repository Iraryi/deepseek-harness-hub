param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$previousOffline = $env:DEEPSEEK_HARNESS_OFFLINE
$previousHome = $env:DSH_HOME

function Get-FreePort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally { $listener.Stop() }
}

function Wait-HubLog([string]$DataDirectory, [string]$Pattern) {
    $deadline = (Get-Date).AddSeconds(90)
    do {
        $logs = Get-ChildItem (Join-Path $DataDirectory 'logs') -File -ErrorAction SilentlyContinue
        foreach ($log in $logs) {
            $content = Get-Content -LiteralPath $log.FullName -Raw -ErrorAction SilentlyContinue
            if ($content -match $Pattern) { return $content }
        }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    throw "HUB log did not contain: $Pattern"
}

function Invoke-ProfileMode([bool]$AllowDesktopPlugins) {
    $name = if ($AllowDesktopPlugins) { 'shared' } else { 'isolated' }
    $work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-hub-profile-' + $name + '-' + [Guid]::NewGuid().ToString('N'))
    $app = $null
    try {
        $data = Join-Path $work 'data'
        $desktopHome = Join-Path $work 'desktop-home'
        New-Item -ItemType Directory -Path $data -Force | Out-Null
        New-Item -ItemType Directory -Path $desktopHome -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $desktopHome 'desktop-only.marker') -Value 'desktop profile marker' -Encoding UTF8
        foreach ($file in @('dsh-hub.exe', 'dsh.exe', 'dsh-config.exe', 'community-registry.json', 'dshmk-catalog.json', 'THIRD-PARTY-NOTICES.txt')) {
            Copy-Item -LiteralPath (Join-Path $launcher $file) -Destination $work
        }
        Copy-Item -Path (Join-Path $launcher '*.dll') -Destination $work
        New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null

        $port = Get-FreePort
        [ordered]@{
            ResolutionWidth = 1000
            ResolutionHeight = 720
            Language = 'zh-CN'
            FirstRunCompleted = $true
            LaunchMode = 'window'
            Url = "http://127.0.0.1:$port"
            Port = $port
            NodePath = (Get-Command node.exe -ErrorAction Stop).Source
            RepoPath = $repository
            LoadingStyle = 'off'
            CloseAction = 'exit'
            ShowTrayButton = $false
            EnableExtensions = $false
            Extensions = @()
            InjectCss = ''
            InjectJs = ''
            DevTools = $false
            ExternalLinksInBrowser = $true
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'config.json') -Encoding UTF8
        [ordered]@{
            Theme = 'light'
            StartPage = 'home'
            DiscoverySource = 'dshmk'
            PageSize = 24
            DetailEntry = 'button'
            DetailMode = 'side'
            DetailContent = 'native'
            LoadingStyle = 'off'
            CloseAction = 'exit'
            ShowTrayButton = $false
            AllowDesktopPlugins = $AllowDesktopPlugins
        } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $data 'hub-config.json') -Encoding UTF8

        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'PROFILE-' + $name + '-' + [Guid]::NewGuid().ToString('N')
        $env:DEEPSEEK_HARNESS_OFFLINE = '1'
        $env:DSH_HOME = $desktopHome
        $app = Start-Process (Join-Path $work 'dsh-hub.exe') -WorkingDirectory $work -PassThru
        $expectedLog = if ($AllowDesktopPlugins) { 'sharing the Desktop Web Profile' } else { 'using isolated Web Profile home' }
        $log = Wait-HubLog $data $expectedLog
        if ($log -notmatch 'Web UI boot verified') { [void](Wait-HubLog $data 'Web UI boot verified') }

        $desktopProfile = Join-Path $desktopHome 'profiles\web\package.json'
        $hubProfile = Join-Path $data 'hub\runtime-home\profiles\web\package.json'
        if ($AllowDesktopPlugins) {
            if (-not (Test-Path -LiteralPath $desktopProfile)) { throw "Shared HUB profile was not initialized: $desktopProfile" }
            if (Test-Path -LiteralPath $hubProfile) { throw "Shared HUB unexpectedly created an isolated profile: $hubProfile" }
        }
        else {
            if (-not (Test-Path -LiteralPath $hubProfile)) { throw "Isolated HUB profile was not initialized: $hubProfile" }
            if (Test-Path -LiteralPath $desktopProfile) { throw "Default HUB startup modified the Desktop profile: $desktopProfile" }
        }
        if (-not (Test-Path -LiteralPath (Join-Path $desktopHome 'desktop-only.marker'))) { throw 'Desktop profile marker was modified' }

        [pscustomobject]@{
            Mode = $name
            AllowDesktopPlugins = $AllowDesktopPlugins
            DesktopProfileCreated = Test-Path -LiteralPath $desktopProfile
            HubProfileCreated = Test-Path -LiteralPath $hubProfile
            Ready = $true
        }
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
        Invoke-ProfileMode $false
        Invoke-ProfileMode $true
    )
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    $env:DEEPSEEK_HARNESS_OFFLINE = $previousOffline
    $env:DSH_HOME = $previousHome
}
