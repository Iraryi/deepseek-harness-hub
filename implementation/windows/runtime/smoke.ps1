param(
    [string]$Archive = "$PSScriptRoot\dist\DeepSeek-Harness-Runtime-win-x64.zip",
    [switch]$CleanupOnly
)

$ErrorActionPreference = 'Stop'
$dist = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))

function Remove-SmokeDirectory([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a smoke directory outside Runtime dist: $resolved"
    }
    if ((Split-Path $resolved -Leaf) -notmatch '^smoke-(extract|home)-[0-9a-f]{8}$') {
        throw "Refusing to remove an unexpected Runtime smoke directory: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($CleanupOnly) {
    Get-ChildItem -LiteralPath $dist -Directory -ErrorAction SilentlyContinue |
        Where-Object Name -Match '^smoke-(extract|home)-[0-9a-f]{8}$' |
        ForEach-Object { Remove-SmokeDirectory $_.FullName }
    return
}

$archivePath = [IO.Path]::GetFullPath($Archive)
if (-not (Test-Path $archivePath)) { throw "Runtime archive not found: $archivePath" }

$extract = Join-Path $dist ('smoke-extract-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$extractPath = [IO.Path]::GetFullPath($extract)
$homePath = [IO.Path]::GetFullPath((Join-Path $dist ('smoke-home-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))))
if (-not $extractPath.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Smoke extraction must stay under $dist"
}

New-Item -ItemType Directory -Path $extractPath | Out-Null
$process = $null
$ready = $false
$previousDshHome = $env:DSH_HOME
try {
    & tar.exe -xf $archivePath -C $extractPath
    if ($LASTEXITCODE -ne 0) { throw "Runtime archive extraction failed: $LASTEXITCODE" }

    $manifestPath = Join-Path $extractPath 'runtime-manifest.json'
    if (-not (Test-Path $manifestPath)) { throw 'Runtime manifest is missing after extraction' }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    $node = Join-Path $extractPath $manifest.node
    $npm = Join-Path $extractPath $manifest.packageManager.command
    $npmCli = Join-Path $extractPath $manifest.packageManager.cli
    $pnpm = Join-Path $extractPath $manifest.packageManager.pnpmCommand
    $pnpmCli = Join-Path $extractPath $manifest.packageManager.pnpmCli
    $entry = Join-Path $extractPath $manifest.entry
    $resolver = Join-Path $extractPath $manifest.resolver
    if (-not (Test-Path $node)) { throw "Bundled node is missing: $node" }
    if (-not (Test-Path $npm)) { throw "Bundled npm command is missing: $npm" }
    if (-not (Test-Path $npmCli)) { throw "Bundled npm CLI is missing: $npmCli" }
    if (-not (Test-Path $pnpm)) { throw "Bundled pnpm command is missing: $pnpm" }
    if (-not (Test-Path $pnpmCli)) { throw "Bundled pnpm CLI is missing: $pnpmCli" }
    if (-not (Test-Path $entry)) { throw "Runtime entry is missing: $entry" }
    if (-not (Test-Path $resolver)) { throw "Runtime resolver is missing: $resolver" }

    $links = @(Get-ChildItem $extractPath -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
    if ($links.Count -ne 0) { throw "Extracted runtime contains $($links.Count) reparse points" }

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }

    $patch = Join-Path $extractPath 'desktop-smoke.patch.yml'
    @'
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
'@ | Set-Content $patch -Encoding UTF8

    $stdout = Join-Path $extractPath 'stdout.log'
    $stderr = Join-Path $extractPath 'stderr.log'
    New-Item -ItemType Directory -Path $homePath | Out-Null
    $env:DSH_HOME = $homePath
    $resolverUrl = [Uri]::new($resolver).AbsoluteUri

    $fixtureRoot = Join-Path $extractPath 'setup-package-fixture'
    $fixturePackage = Join-Path $fixtureRoot 'package'
    New-Item -ItemType Directory -Path $fixturePackage -Force | Out-Null
    [ordered]@{
        name = 'dsh-runtime-smoke-bundle'
        version = '1.0.0'
        dsh = [ordered]@{ bundle = [ordered]@{ patch = 'cordis.patch.yml' } }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $fixturePackage 'package.json') -Encoding UTF8
    "[]`n" | Set-Content -LiteralPath (Join-Path $fixturePackage 'cordis.patch.yml') -Encoding UTF8
    $fixtureArchive = Join-Path $extractPath 'runtime-smoke.tgz'
    & tar.exe -czf $fixtureArchive -C $fixtureRoot package
    if ($LASTEXITCODE -ne 0) { throw "Setup fixture archive creation failed: $LASTEXITCODE" }
    $fixtureHash = (Get-FileHash -LiteralPath $fixtureArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    $cacheDirectory = Join-Path $homePath "setup-cache\artifacts\$fixtureHash"
    New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
    Copy-Item -LiteralPath $fixtureArchive -Destination (Join-Path $cacheDirectory 'runtime-smoke.tgz')
    $setupManifestPath = Join-Path $extractPath 'runtime-smoke.setup.json'
    [ordered]@{
        schemaVersion = 1
        id = 'dsh-runtime-smoke-bundle'
        name = 'Runtime Smoke Bundle'
        description = 'Offline package installation smoke fixture'
        version = '1.0.0'
        kind = 'virtual'
        categories = @('test')
        tags = @('offline')
        source = [ordered]@{
            repository = 'https://github.com/deepseek-ai/deepseek-harness'
            ref = 'runtime-smoke'
            commit = '0000000000000000000000000000000000000000'
        }
        compatibility = [ordered]@{ dsh = '>=0.1.0-rc.5 <0.2.0'; surfaces = @('desktop'); platforms = @('windows-x64') }
        license = [ordered]@{ identifier = 'MIT'; name = 'MIT License'; redistributable = $true }
        signature = [ordered]@{ status = 'unsigned' }
        audit = [ordered]@{ status = 'unreviewed'; checks = @('runtime smoke') }
        artifacts = @([ordered]@{
            id = 'package'
            kind = 'package'
            url = 'https://example.invalid/runtime-smoke.tgz'
            sha256 = $fixtureHash
            platform = 'any'
        })
        install = [ordered]@{ mode = 'profile'; source = 'package'; artifactId = 'package'; profile = 'setup-smoke' }
        permissions = @('modify the selected DSH profile')
        network = @()
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $setupManifestPath -Encoding UTF8

    $previousPath = $env:PATH
    try {
        $env:PATH = Join-Path $env:SystemRoot 'System32'
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $setupOutput = & $node '--import' $resolverUrl $entry 'setup' 'install' $setupManifestPath '--accept-source' 2>&1
            $setupExitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($setupExitCode -ne 0) { throw "Bundled npm Setup smoke failed:`n$($setupOutput -join [Environment]::NewLine)" }
    }
    finally {
        $env:PATH = $previousPath
    }
    $profileManifestPath = Join-Path $homePath 'profiles\setup-smoke\package.json'
    if (-not (Test-Path $profileManifestPath)) { throw 'Bundled npm Setup smoke did not create a profile manifest' }
    $profileManifest = Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json
    if (-not ($profileManifest.dsh.profile.bundles -contains 'dsh-runtime-smoke-bundle')) {
        throw 'Bundled npm Setup smoke did not activate the installed bundle'
    }

    $process = Start-Process $node `
        -ArgumentList @('--import', $resolverUrl, $entry, 'web', '--patch', $patch, '--port', $port) `
        -WorkingDirectory $extractPath `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru

    $response = $null
    for ($attempt = 0; $attempt -lt 180; $attempt++) {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) { break }
        try {
            $response = Invoke-WebRequest "http://127.0.0.1:$port" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        }
        catch {
        }
    }

    $result = [pscustomobject]@{
        Archive = $archivePath
        ArchiveBytes = (Get-Item $archivePath).Length
        ExtractedBytes = (Get-ChildItem $extractPath -File -Recurse | Measure-Object Length -Sum).Sum
        RuntimeVersion = $manifest.version
        BundledNode = (& $node --version)
        BundledNpm = (& $node $npmCli --version)
        OfflineSetupPackage = $profileManifest.dependencies.'dsh-runtime-smoke-bundle'
        EntryExists = Test-Path $entry
        ResolverExists = Test-Path $resolver
        ExternalProfileHome = $homePath
        ReparsePoints = $links.Count
        Ready = $ready
        HttpStatus = if ($ready) { $response.StatusCode } else { $null }
        NodeWindowHandle = $process.MainWindowHandle
        Stdout = Get-Content $stdout -Raw -ErrorAction SilentlyContinue
        Stderr = Get-Content $stderr -Raw -ErrorAction SilentlyContinue
    }
    $result
    if (-not $ready) {
        throw "Extracted runtime HTTP smoke failed.`nSTDOUT:`n$($result.Stdout)`nSTDERR:`n$($result.Stderr)`nPreserved: $extractPath"
    }
}
finally {
    $env:DSH_HOME = $previousDshHome
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
    if (Test-Path $extractPath) { Remove-SmokeDirectory $extractPath }
    if (Test-Path $homePath) { Remove-SmokeDirectory $homePath }
}
