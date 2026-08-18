param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('zh-CN', 'en-US')]
    [string]$Language,

    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,

    [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$app = [IO.Path]::GetFullPath($AppDirectory)
$data = if ($Portable) { Join-Path $app 'data' } else { Join-Path $env:LOCALAPPDATA 'DeepSeekHarness' }
$configPath = Join-Path $data 'config.json'
New-Item -ItemType Directory -Path $data -Force | Out-Null
$created = $false

function New-DefaultConfig {
    param([string]$SelectedLanguage)

    $config = [ordered]@{
        ResolutionWidth = 1280
        ResolutionHeight = 800
        Language = $SelectedLanguage
        FirstRunCompleted = $false
        LaunchMode = 'window'
        Url = 'http://127.0.0.1:3080'
        Port = 3080
        NodePath = ''
        RepoPath = ''
        ToolbarAutoHide = $true
        ToolbarEdgeReveal = $false
        ToolbarHotkey = 'F8'
        FullscreenHotkey = 'F11'
        LoadingStyle = 'whales'
        CloseAction = 'tray'
        ShowTrayButton = $true
        FullscreenShowToolbar = $false
        FullscreenShowTaskbar = $false
        EnableExtensions = $false
        Extensions = @()
        InjectCss = ''
        InjectJs = ''
        DevTools = $true
        ExternalLinksInBrowser = $true
    }
    return $config
}

if (Test-Path $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -eq $config.PSObject.Properties['Language']) {
            $config | Add-Member -NotePropertyName Language -NotePropertyValue $Language
        } else {
            $config.Language = $Language
        }
        if ($null -eq $config.PSObject.Properties['FirstRunCompleted']) {
            $config | Add-Member -NotePropertyName FirstRunCompleted -NotePropertyValue $false
        } else {
            $config.FirstRunCompleted = $false
        }
    } catch {
        $backupPath = $configPath + '.invalid-' + (Get-Date -Format 'yyyyMMddHHmmss')
        Copy-Item -LiteralPath $configPath -Destination $backupPath -Force
        $config = New-DefaultConfig -SelectedLanguage $Language
    }
} else {
    $config = New-DefaultConfig -SelectedLanguage $Language
    $created = $true
}

$json = $config | ConvertTo-Json -Compress
[IO.File]::WriteAllText($configPath, $json, [Text.UTF8Encoding]::new($false))

[pscustomobject]@{
    Config = $configPath
    Created = $created
    FirstRunReset = $true
    Portable = [bool]$Portable
} | ConvertTo-Json -Compress
