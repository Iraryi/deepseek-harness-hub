param(
    [ValidateSet('Full', 'Lite', 'Portable', 'Runtime')]
    [string]$Package = 'Full',
    [string]$Version = 'latest',
    [string]$Destination = (Get-Location).Path,
    [switch]$Launch
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repository = 'Iraryi/deepseek-harness-hub'
$headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'DeepSeek-Harness-Desktop-Downloader'
}

if ($Version -eq 'latest') {
    $releases = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repository/releases?per_page=20"
    $release = @($releases | Where-Object { -not $_.draft }) | Select-Object -First 1
    if (-not $release) { throw 'No published release is available.' }
}
else {
    $tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
    $release = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$repository/releases/tags/$tag"
}

$patterns = @{
    Full = '^DeepSeek-Harness-Setup-Full-.+-win-x64\.exe$'
    Lite = '^DeepSeek-Harness-Setup-Lite-.+-win-x64\.exe$'
    Portable = '^DeepSeek-Harness-Portable-.+-win-x64\.zip$'
    Runtime = '^DeepSeek-Harness-Runtime-.+-win-x64\.zip$'
}
$asset = @($release.assets | Where-Object { $_.name -match $patterns[$Package] }) | Select-Object -First 1
$checksums = @($release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' }) | Select-Object -First 1
if (-not $asset) { throw "$Package asset is missing from release $($release.tag_name)." }
if (-not $checksums) { throw "SHA256SUMS.txt is missing from release $($release.tag_name)." }

$destinationPath = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$assetPath = Join-Path $destinationPath $asset.name
$checksumPath = Join-Path $destinationPath 'SHA256SUMS.txt'
Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $assetPath -UseBasicParsing
Invoke-WebRequest -Headers $headers -Uri $checksums.browser_download_url -OutFile $checksumPath -UseBasicParsing

$line = Get-Content -LiteralPath $checksumPath | Where-Object { $_ -match ('  ' + [regex]::Escape($asset.name) + '$') } | Select-Object -First 1
if (-not $line) { throw "No checksum is recorded for $($asset.name)." }
$expected = ($line -split '\s+', 2)[0]
$actual = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash
if (-not $actual.Equals($expected, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $assetPath -Force
    throw "SHA-256 verification failed for $($asset.name)."
}

if ($Launch) {
    if ([IO.Path]::GetExtension($assetPath) -ne '.exe') { throw '-Launch is only valid for Setup packages.' }
    Start-Process -FilePath $assetPath
}

[pscustomobject]@{
    Release = $release.tag_name
    Package = $Package
    Path = $assetPath
    Sha256 = $actual.ToLowerInvariant()
}
