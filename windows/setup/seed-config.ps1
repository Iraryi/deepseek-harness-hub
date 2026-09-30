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
$data = if (-not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_HARNESS_DATA_DIR)) {
    [IO.Path]::GetFullPath($env:DEEPSEEK_HARNESS_DATA_DIR)
} elseif ($Portable) { Join-Path $app 'data' } else { Join-Path $env:LOCALAPPDATA 'DeepSeekHarness' }
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
        if ($null -eq $config -or $config -isnot [pscustomobject]) {
            throw 'Existing configuration must be a JSON object'
        }
    } catch {
        throw "Existing configuration was not changed. Repair the JSON or restore a backup before retrying: $configPath. $($_.Exception.Message)"
    }
    [pscustomobject]@{ Config = $configPath; Created = $false; FirstRunReset = $false; Portable = [bool]$Portable } | ConvertTo-Json -Compress
    return
} else {
    $config = New-DefaultConfig -SelectedLanguage $Language
    $created = $true
}

$json = $config | ConvertTo-Json -Depth 100 -Compress
$temporary = $configPath + '.new-' + [Guid]::NewGuid().ToString('N')
[IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
try {
    [IO.File]::Move($temporary, $configPath)
} finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
}

[pscustomobject]@{
    Config = $configPath
    Created = $created
    FirstRunReset = $true
    Portable = [bool]$Portable
} | ConvertTo-Json -Compress
