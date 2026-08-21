param(
    [string]$Archive = "$PSScriptRoot\dist\DeepSeek-Harness-Runtime-win-x64.zip",
    [int]$ExpectedEntryCount = 39
)

$ErrorActionPreference = 'Stop'
$dist = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'dist'))
$archivePath = [IO.Path]::GetFullPath($Archive)
if (-not (Test-Path -LiteralPath $archivePath)) { throw "Runtime archive not found: $archivePath" }

$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$extractPath = [IO.Path]::GetFullPath((Join-Path $dist "first-index-extract-$suffix"))
$homePath = [IO.Path]::GetFullPath((Join-Path $dist "first-index-home-$suffix"))
$process = $null
$previousDshHome = $env:DSH_HOME

function Remove-OwnedDirectory([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($dist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a smoke directory outside Runtime dist: $resolved"
    }
    if ((Split-Path $resolved -Leaf) -notmatch '^first-index-(extract|home)-[0-9a-f]{8}$') {
        throw "Refusing to remove an unexpected first-index smoke directory: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Get-BootEntryCount([string]$Html) {
    $match = [regex]::Match(
        $Html,
        'window\.__DSH_BOOT__\s*=\s*(\{.*?\})\s*</script>',
        [Text.RegularExpressions.RegexOptions]::Singleline
    )
    if (-not $match.Success) { throw 'The index response does not contain window.__DSH_BOOT__' }
    $manifest = $match.Groups[1].Value | ConvertFrom-Json
    return @($manifest.entries).Count
}

function Test-LoopbackPort([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.ConnectAsync([Net.IPAddress]::Loopback, $Port)
        return $connect.Wait(100) -and $client.Connected
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

try {
    New-Item -ItemType Directory -Path $extractPath, $homePath | Out-Null
    & tar.exe -xf $archivePath -C $extractPath
    if ($LASTEXITCODE -ne 0) { throw "Runtime archive extraction failed: $LASTEXITCODE" }

    $manifest = Get-Content -LiteralPath (Join-Path $extractPath 'runtime-manifest.json') -Raw | ConvertFrom-Json
    $node = Join-Path $extractPath $manifest.node
    $entry = Join-Path $extractPath $manifest.entry
    $resolver = Join-Path $extractPath $manifest.resolver
    $resolverUrl = [Uri]::new($resolver).AbsoluteUri

    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }

    $patch = Join-Path $extractPath 'desktop-first-index.patch.yml'
    @'
- id: directory-picker
  disabled: true
- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: ui-directory-picker-browse
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
'@ | Set-Content -LiteralPath $patch -Encoding UTF8

    $stdout = Join-Path $extractPath 'stdout.log'
    $stderr = Join-Path $extractPath 'stderr.log'
    $env:DSH_HOME = $homePath
    $process = Start-Process $node `
        -ArgumentList @('--import', $resolverUrl, $entry, 'web', '--patch', $patch, '--port', $port) `
        -WorkingDirectory $extractPath `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru

    $startup = [Diagnostics.Stopwatch]::StartNew()
    while (-not (Test-LoopbackPort $port)) {
        $process.Refresh()
        if ($process.HasExited) {
            throw "Runtime exited before opening the HTTP port.`nSTDOUT:`n$(Get-Content $stdout -Raw -ErrorAction SilentlyContinue)`nSTDERR:`n$(Get-Content $stderr -Raw -ErrorAction SilentlyContinue)"
        }
        if ($startup.ElapsedMilliseconds -ge 120000) { throw 'Runtime did not open its HTTP port within 120 seconds' }
        Start-Sleep -Milliseconds 20
    }
    $portOpenedMilliseconds = $startup.ElapsedMilliseconds

    $http = [Net.Http.HttpClient]::new()
    $http.Timeout = [TimeSpan]::FromSeconds(120)
    try {
        $firstRequest = [Diagnostics.Stopwatch]::StartNew()
        $firstHtml = $http.GetStringAsync("http://127.0.0.1:$port/").GetAwaiter().GetResult()
        $firstRequest.Stop()
        $firstEntries = Get-BootEntryCount $firstHtml

        $secondHtml = $http.GetStringAsync("http://127.0.0.1:$port/").GetAwaiter().GetResult()
        $secondEntries = Get-BootEntryCount $secondHtml
    }
    finally {
        $http.Dispose()
    }

    if ($firstEntries -ne $ExpectedEntryCount) {
        throw "First index contained $firstEntries entries; expected $ExpectedEntryCount"
    }
    if ($secondEntries -ne $firstEntries) {
        throw "First and settled index manifests differ: first=$firstEntries second=$secondEntries"
    }

    [pscustomobject]@{
        Archive = $archivePath
        FreshHome = $homePath
        Port = $port
        PortOpenedMilliseconds = $portOpenedMilliseconds
        FirstResponseMilliseconds = $firstRequest.ElapsedMilliseconds
        FirstManifestEntries = $firstEntries
        SecondManifestEntries = $secondEntries
        Stdout = Get-Content $stdout -Raw -ErrorAction SilentlyContinue
        Stderr = Get-Content $stderr -Raw -ErrorAction SilentlyContinue
    }
}
finally {
    $env:DSH_HOME = $previousDshHome
    if ($process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit()
    }
    if (Test-Path -LiteralPath $extractPath) { Remove-OwnedDirectory $extractPath }
    if (Test-Path -LiteralPath $homePath) { Remove-OwnedDirectory $homePath }
}
