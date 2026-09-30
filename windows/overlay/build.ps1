[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$LauncherDirectory,
    [string]$OverlayPackagesDirectory = '',
    [string]$Version = '0.1.0',
    [string]$IsccPath = '',
    [string]$BuildRoot = ''
)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Overlay.psm1" -Force
if (-not $BuildRoot) { $BuildRoot = Join-Path $PSScriptRoot 'artifacts' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Version must be major.minor.patch.' }
$root = Get-OverlayPath $BuildRoot
if (-not $root.StartsWith((Get-OverlayPath $PSScriptRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildRoot must stay under windows/overlay; no shared outputs.'
}
$source = Get-OverlayPath $LauncherDirectory
if (Test-OverlayOverlap $root $source) { throw 'Build output must not overlap launcher input.' }
if (-not $IsccPath) {
    $repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $candidates = @((Join-Path $repo '.tools\inno\ISCC.exe'), "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates = @($command.Source) + $candidates }
    $IsccPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $IsccPath) { throw 'Inno Setup 6 is required. Pass -IsccPath; this script never downloads or installs build tools.' }
$run = Join-Path $root ([guid]::NewGuid().ToString('N').Substring(0, 8))
$stage = Join-Path $run 'stage'
$output = Join-Path $run 'output'
$null = New-Item -ItemType Directory -Path "$stage\payload", $output
$files = @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'community-registry.json', 'dshmk-catalog.json', 'THIRD-PARTY-NOTICES.txt')
foreach ($file in $files) {
    $inputPath = Get-OverlayPath (Join-Path $source $file)
    if (-not (Test-Path -LiteralPath $inputPath -PathType Leaf)) { throw "Missing compiled launcher payload: $inputPath" }
    if ($file -in @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe')) {
        $strings = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($inputPath))
        foreach ($required in @('--dsh-data-dir', '--dsh-home', '--dsh-instance-scope', 'overlay-binding.json')) {
            if (-not $strings.Contains($required)) { throw "Launcher lacks explicit path/scope support: $file / $required" }
        }
    }
}
foreach ($file in @(Get-OverlayTree $source)) {
    $relative = $file.FullName.Substring($source.Length + 1)
    $destination = Join-Path "$stage\payload" $relative
    $null = [IO.Directory]::CreateDirectory((Split-Path $destination))
    Copy-Item -LiteralPath $file.FullName -Destination $destination
}
if ($OverlayPackagesDirectory) {
    $packageSource = Get-OverlayPath $OverlayPackagesDirectory
    if (Test-Path -LiteralPath "$stage\payload\overlay-packages") { throw 'Pass either embedded overlay-packages or an external package directory, not both.' }
    foreach ($file in @(Get-OverlayTree $packageSource)) {
        $relative = $file.FullName.Substring($packageSource.Length + 1)
        $destination = Join-Path "$stage\payload\overlay-packages" $relative
        $null = [IO.Directory]::CreateDirectory((Split-Path $destination))
        Copy-Item -LiteralPath $file.FullName -Destination $destination
    }
}
$modules = "$stage\payload\overlay-packages\node_modules"
if (-not (Test-Path -LiteralPath $modules -PathType Container)) { throw 'Updated HUB packages required: supply overlay-packages/node_modules in launcher output or -OverlayPackagesDirectory.' }
$packages = @()
foreach ($directory in Get-ChildItem -LiteralPath $modules -Directory) {
    $packageDirectories = if ($directory.Name.StartsWith('@')) { @(Get-ChildItem -LiteralPath $directory.FullName -Directory) } else { @($directory) }
    foreach ($packageDirectory in $packageDirectories) {
        $package = Read-OverlayJson (Join-Path $packageDirectory.FullName 'package.json')
        $expectedName = $packageDirectory.FullName.Substring($modules.Length + 1).Replace('\', '/')
        if ($package.name -ne $expectedName -or $package.name -eq '@deepseek-ai/dsh') { throw "Invalid/CLI replacement package: $expectedName" }
        $repositoryDirectory = $null
        if ($package.PSObject.Properties.Name -contains 'repository' -and $package.repository.PSObject.Properties.Name -contains 'directory') {
            $repositoryDirectory = [string]$package.repository.directory
            if ($repositoryDirectory -notmatch '^(packages|apps|vendor)/[a-zA-Z0-9_/-]+$' -or $repositoryDirectory.Contains('..')) { throw 'Unsafe repository directory in overlay package.' }
        }
        $packages += [ordered]@{ Name = $package.name; Version = $package.version; RepositoryDirectory = $repositoryDirectory }
    }
}
foreach ($required in @('dsh-client-ui-setup-hub', 'dsh-client-ui-settings-general', 'dsh-client-ui-sidebar', 'dsh-client-ui-workspace')) {
    if ("@deepseek-ai/$required" -notin $packages.Name) { throw "Updated package missing: $required; launching the old frontend is not activation." }
    foreach ($entry in @('lib\index.js', 'lib\client.js')) {
        if (-not (Test-Path -LiteralPath (Join-Path "$modules\@deepseek-ai\$required" $entry) -PathType Leaf)) { throw "Missing built package entry: $required/$entry" }
    }
}
$hashes = [ordered]@{}
foreach ($file in @(Get-OverlayTree "$stage\payload")) { $hashes[$file.FullName.Substring("$stage\payload".Length + 1)] = Get-OverlayHash $file.FullName }
foreach ($file in @('Overlay.psm1', 'launch.ps1', 'plan.ps1', 'prepare.ps1', 'resolver.mjs', 'README.md', 'README.zh.md', 'INTEGRATION.md', 'TESTING.md')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $stage $file)
}
Write-OverlayNewJson "$stage\payload-manifest.json" ([ordered]@{ Schema = 1; Version = $Version; Source = $source; Files = $hashes; Packages = $packages })
foreach ($file in @(Get-OverlayTree $stage)) {
    if ($file.FullName.Length -ge 259) { throw "Inno source path too long; choose a shorter BuildRoot under windows/overlay: $($file.FullName)" }
}
try {
    $ErrorActionPreference = 'Continue'
    & $IsccPath "/DStageDir=$stage" "/DOutputDir=$output" "/DOverlayVersion=$Version" "$PSScriptRoot\DSHOverlay.iss" 2>&1 | Tee-Object -FilePath "$run\compile.log"
} finally { $ErrorActionPreference = 'Stop' }
if ($LASTEXITCODE -ne 0) { throw "Inno compilation failed. See $run\compile.log" }
$setup = Join-Path $output "DSH-Overlay-Setup-$Version.exe"
Write-OverlayNewJson "$run\build-result.json" ([ordered]@{ Setup = $setup; Sha256 = Get-OverlayHash $setup; Bytes = (Get-Item -LiteralPath $setup).Length; LauncherSource = $source; ExecutedInstaller = $false })
Write-Output "Built only (NOT installed): $setup"
