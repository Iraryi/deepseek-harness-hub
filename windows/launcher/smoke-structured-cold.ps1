param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [int]$Runs = 3
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

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$node = (Get-Command node.exe -ErrorAction Stop).Source
$tempRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'dsh-structured-boot-smoke'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$results = @()

for ($run = 1; $run -le $Runs; $run++) {
    $data = [IO.Path]::GetFullPath((Join-Path $tempRoot ([Guid]::NewGuid().ToString('N'))))
    if (-not $data.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cold-start data escaped the smoke root: $data"
    }
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $port = Get-FreePort
    [ordered]@{
        ResolutionWidth = 1180
        ResolutionHeight = 760
        Language = 'en-US'
        FirstRunCompleted = $true
        LaunchMode = 'window'
        Url = "http://127.0.0.1:$port"
        Port = $port
        NodePath = $node
        RepoPath = $repository
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

    try {
        $result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'smoke-installed-webview.ps1') `
            -AppDirectory $launcher -DataDirectory $data -Runs 1
        $results += $result
        Remove-Item -LiteralPath $data -Recurse -Force
    }
    catch {
        Write-Warning "Cold-start data retained for diagnosis: $data"
        throw
    }
}

$results
