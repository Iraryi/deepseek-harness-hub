param(
    [string]$OutputDirectory = "$PSScriptRoot\dist",
    [string]$LauncherDirectory = "$PSScriptRoot\..\launcher\dist",
    [string]$RuntimeArchive = "$PSScriptRoot\..\runtime\dist\DeepSeek-Harness-Runtime-win-x64.zip",
    [string]$ReleaseBaseUrl = 'https://github.com/Iraryi/deepseek-harness-hub/releases',
    [string]$InnoCompiler = ''
)

$ErrorActionPreference = 'Stop'
$setupRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $setupRoot '..\..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($setupRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must stay under $setupRoot"
}

$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$runtime = [IO.Path]::GetFullPath($RuntimeArchive)
$runtimeDirectory = Join-Path (Split-Path $runtime -Parent) 'runtime'
$webViewOffline = Join-Path $setupRoot 'cache\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
$webViewBootstrapper = Join-Path $setupRoot 'cache\MicrosoftEdgeWebview2Setup.exe'
$requiredLauncherFiles = @(
    'dsh.exe',
    'dsh-hub.exe',
    'dsh-config.exe',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll',
    'community-registry.json',
    'dshmk-catalog.json',
    'THIRD-PARTY-NOTICES.txt'
)
foreach ($name in $requiredLauncherFiles) {
    if (-not (Test-Path (Join-Path $launcher $name))) { throw "Launcher file missing: $name" }
}
if (-not (Test-Path $runtime)) { throw "Runtime archive missing: $runtime" }
if (-not (Test-Path $runtimeDirectory)) { throw "Runtime directory missing: $runtimeDirectory" }
if (-not (Test-Path $webViewOffline)) { throw "Offline WebView2 installer missing: $webViewOffline" }
if (-not (Test-Path $webViewBootstrapper)) { throw "WebView2 bootstrapper missing: $webViewBootstrapper" }

if ([string]::IsNullOrWhiteSpace($InnoCompiler)) {
    $candidates = @()
    foreach ($registryPath in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )) {
        $registry = Get-ItemProperty $registryPath -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like 'Inno Setup version 6*' }
        foreach ($entry in $registry) {
            if ($entry.InstallLocation) { $candidates += Join-Path $entry.InstallLocation 'ISCC.exe' }
        }
    }
    $candidates += @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    )
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $InnoCompiler = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}
if ([string]::IsNullOrWhiteSpace($InnoCompiler) -or -not (Test-Path $InnoCompiler)) {
    throw 'Inno Setup 6 compiler was not found. Install JRSoftware.InnoSetup or pass -InnoCompiler.'
}

$package = Get-Content (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$numeric = [regex]::Matches($version, '\d+') | ForEach-Object { [int]$_.Value }
while ($numeric.Count -lt 4) { $numeric = @($numeric) + 0 }
$numericVersion = '{0}.{1}.{2}.{3}' -f $numeric[0], $numeric[1], $numeric[2], $numeric[3]
$runtimeAssetName = "DeepSeek-Harness-Runtime-$version-win-x64.zip"
$runtimeSha256 = (Get-FileHash $runtime -Algorithm SHA256).Hash.ToLowerInvariant()
$runtimeArchiveBytes = (Get-Item -LiteralPath $runtime).Length
$runtimeInstalledBytes = (Get-ChildItem -LiteralPath $runtimeDirectory -File -Recurse | Measure-Object Length -Sum).Sum
$webViewOfflineBytes = (Get-Item -LiteralPath $webViewOffline).Length
$webViewBootstrapperBytes = (Get-Item -LiteralPath $webViewBootstrapper).Length

if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null

$defines = @(
    "/DAppVersion=$version",
    "/DAppNumericVersion=$numericVersion",
    "/DLauncherDir=$launcher",
    "/DOutputDir=$output",
    "/DRuntimeArchive=$runtime",
    "/DRuntimeAssetName=$runtimeAssetName",
    "/DRuntimeSha256=$runtimeSha256",
    "/DRuntimeArchiveBytes=$runtimeArchiveBytes",
    "/DRuntimeInstalledBytes=$runtimeInstalledBytes",
    "/DReleaseBaseUrl=$ReleaseBaseUrl",
    "/DWebViewOffline=$webViewOffline",
    "/DWebViewBootstrapper=$webViewBootstrapper",
    "/DWebViewOfflineBytes=$webViewOfflineBytes",
    "/DWebViewBootstrapperBytes=$webViewBootstrapperBytes",
    "/DRepositoryRoot=$repository"
)

foreach ($flavor in @('Full', 'Lite')) {
    & $InnoCompiler @defines (Join-Path $setupRoot "$flavor.iss")
    if ($LASTEXITCODE -ne 0) { throw "$flavor Setup compilation failed: $LASTEXITCODE" }
}

$expected = @(
    "DeepSeek-Harness-Setup-Full-$version-win-x64.exe",
    "DeepSeek-Harness-Setup-Lite-$version-win-x64.exe"
)
foreach ($name in $expected) {
    $path = Join-Path $output $name
    if (-not (Test-Path $path)) { throw "Setup output missing: $path" }
}

[pscustomobject]@{
    Version = $version
    RuntimeSha256 = $runtimeSha256
    RuntimeArchiveBytes = $runtimeArchiveBytes
    RuntimeInstalledBytes = $runtimeInstalledBytes
    Full = Join-Path $output $expected[0]
    Lite = Join-Path $output $expected[1]
}
