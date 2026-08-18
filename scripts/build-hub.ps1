param(
    [string]$OutputDirectory = "$PSScriptRoot\..\dist"
)

$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$implementation = Join-Path $repository 'implementation'
$output = [IO.Path]::GetFullPath($OutputDirectory)

if (-not (Test-Path -LiteralPath (Join-Path $implementation 'package.json'))) {
    throw "HUB implementation source is missing: $implementation"
}

foreach ($command in @('node.exe', 'pnpm.cmd')) {
    if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "$command is required to build HUB from source."
    }
}

$launcherOutput = Join-Path $implementation 'windows\launcher\dist-hub-source'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $implementation 'windows\launcher\build.ps1') -OutputDirectory $launcherOutput
if ($LASTEXITCODE -ne 0) { throw "HUB launcher build failed with code $LASTEXITCODE" }

if (Test-Path -LiteralPath $output) {
    throw "Output directory already exists; move or remove it before rebuilding: $output"
}
New-Item -ItemType Directory -Path $output | Out-Null

$files = @(
    'dsh-hub.exe',
    'dsh-config.exe',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll',
    'community-registry.json',
    'dshmk-catalog.json',
    'THIRD-PARTY-NOTICES.txt'
)
foreach ($name in $files) {
    $source = Join-Path $launcherOutput $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Missing HUB build output: $source" }
    Copy-Item -LiteralPath $source -Destination (Join-Path $output $name)
}

Write-Host "HUB source build staged at $output"
