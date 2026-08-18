param(
    [string]$ReleaseDirectory = "$PSScriptRoot\dist"
)

$ErrorActionPreference = 'Stop'
$releaseRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $releaseRoot '..\..'))
$release = [IO.Path]::GetFullPath($ReleaseDirectory)
if (-not $release.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "ReleaseDirectory must stay under $releaseRoot"
}

$package = Get-Content (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$portableArchive = Join-Path $release "DeepSeek-Harness-Portable-$version-win-x64.zip"
$checksumsPath = Join-Path $release 'SHA256SUMS.txt'
$manifestPath = Join-Path $release 'release-manifest.json'
foreach ($path in @($portableArchive, $checksumsPath, $manifestPath)) {
    if (-not (Test-Path $path)) { throw "Release smoke input is missing: $path" }
}

foreach ($line in Get-Content -LiteralPath $checksumsPath) {
    if ($line -notmatch '^([0-9a-f]{64})  (.+)$') { throw "Invalid checksum line: $line" }
    $assetPath = Join-Path $release $Matches[2]
    if (-not (Test-Path $assetPath)) { throw "Checksummed asset is missing: $assetPath" }
    $actual = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash
    if (-not $actual.Equals($Matches[1], [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release checksum mismatch: $assetPath"
    }
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $version -or $manifest.tag -ne "v$version" -or $manifest.platform -ne 'win-x64') {
    throw 'Release manifest metadata does not match the repository version'
}

$smokeRoot = Join-Path $release ('portable-smoke-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$smokePath = [IO.Path]::GetFullPath($smokeRoot)
if (-not $smokePath.StartsWith($release + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    -not (Split-Path $smokePath -Leaf).StartsWith('portable-smoke-', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Portable smoke directory is unsafe: $smokePath"
}

$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
$appProcess = $null
$nodeProcess = $null
try {
    New-Item -ItemType Directory -Path $smokePath | Out-Null
    & tar.exe -xf $portableArchive -C $smokePath
    if ($LASTEXITCODE -ne 0) { throw "Portable extraction failed with exit code $LASTEXITCODE" }

    $required = @(
        'dsh.exe',
        'dsh-hub.exe',
        'dsh-config.exe',
        'portable.mode',
        'runtime\runtime-manifest.json',
        'runtime\tools\node\node.exe',
        'runtime\tools\node\npm.cmd',
        'runtime\tools\node\node_modules\npm\bin\npm-cli.js'
    )
    foreach ($relativePath in $required) {
        if (-not (Test-Path (Join-Path $smokePath $relativePath))) {
            throw "Portable asset is missing: $relativePath"
        }
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repository 'windows\setup\seed-config.ps1') `
        -Language en-US -AppDirectory $smokePath -Portable
    if ($LASTEXITCODE -ne 0) { throw "Portable config seed failed with exit code $LASTEXITCODE" }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }

    $configPath = Join-Path $smokePath 'data\config.json'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $config.FirstRunCompleted = $true
    $config.Port = $port
    $config.Url = "http://127.0.0.1:$port"
    $config.LoadingStyle = 'off'
    $config.CloseAction = 'exit'
    $config.LaunchMode = 'window'
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))

    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'portable-release-smoke-' + [Guid]::NewGuid().ToString('N')
    $appProcess = Start-Process (Join-Path $smokePath 'dsh.exe') -WorkingDirectory $smokePath -PassThru
    $response = $null
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        Start-Sleep -Milliseconds 500
        $appProcess.Refresh()
        if ($appProcess.HasExited) { break }
        $nodeProcess = Get-CimInstance Win32_Process | Where-Object {
            $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $appProcess.Id
        } | Select-Object -First 1
        try {
            $response = Invoke-WebRequest "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { break }
        }
        catch {
        }
    }

    if (-not $response -or $response.StatusCode -ne 200) {
        throw "Portable application did not reach HTTP 200 on port $port"
    }
    if (-not $nodeProcess) { throw 'Portable application did not start bundled Node.js' }
    $expectedNode = Join-Path $smokePath 'runtime\tools\node\node.exe'
    if (-not $nodeProcess.ExecutablePath.Equals($expectedNode, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Portable application used the wrong Node.js: $($nodeProcess.ExecutablePath)"
    }

    [pscustomobject]@{
        Version = $version
        HttpStatus = $response.StatusCode
        Port = $port
        BundledNode = $nodeProcess.ExecutablePath
        DesktopPatch = $nodeProcess.CommandLine -match '--patch'
    }
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    if ($appProcess -and -not $appProcess.HasExited) {
        $appProcess.CloseMainWindow() | Out-Null
        if (-not $appProcess.WaitForExit(10000)) {
            & taskkill.exe /PID $appProcess.Id /T /F | Out-Null
        }
    }
    if ($nodeProcess) {
        $remainingNode = Get-CimInstance Win32_Process -Filter "ProcessId = $($nodeProcess.ProcessId)" -ErrorAction SilentlyContinue
        if ($remainingNode -and $remainingNode.ExecutablePath -and
            $remainingNode.ExecutablePath.StartsWith($smokePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $remainingNode.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($smokePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    for ($attempt = 0; $attempt -lt 20 -and (Test-Path $smokePath); $attempt++) {
        try {
            Remove-Item -LiteralPath $smokePath -Recurse -Force -ErrorAction Stop
        }
        catch {
            if ($attempt -eq 19) {
                Write-Warning "Portable smoke directory could not be removed: $smokePath ($($_.Exception.Message))"
                break
            }
            Start-Sleep -Milliseconds 500
        }
    }
}
