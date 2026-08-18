param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('archive', 'folder', 'source')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$Destination,

    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [string]$ExpectedSha256 = '',
    [string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'
$destinationPath = [IO.Path]::GetFullPath($Destination)
$parent = Split-Path $destinationPath -Parent
if ([string]::IsNullOrWhiteSpace($parent) -or (Split-Path $destinationPath -Leaf) -ne 'runtime') {
    throw "Runtime destination must be an application runtime directory: $destinationPath"
}
New-Item -ItemType Directory -Path $parent -Force | Out-Null

$input = [IO.Path]::GetFullPath($InputPath)
if (-not (Test-Path $input)) { throw "Runtime input does not exist: $input" }

$operation = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$stage = Join-Path $parent ('.runtime-staging-' + $operation)
$backup = Join-Path $parent ('.runtime-backup-' + $operation)
$sourceWork = Join-Path $parent ('.runtime-source-' + $operation)
$installed = $false

function Get-Sha256Hex([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha256.ComputeHash($stream)
        return ([BitConverter]::ToString($bytes)).Replace('-', '')
    }
    finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}

function Remove-OwnedTree([string]$Path, [string[]]$AllowedPrefixes) {
    if (-not (Test-Path $Path)) { return }
    $resolved = [IO.Path]::GetFullPath($Path)
    $resolvedParent = Split-Path $resolved -Parent
    $leaf = Split-Path $resolved -Leaf
    if (-not $resolvedParent.Equals($parent, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the application directory: $resolved"
    }
    $allowed = $false
    foreach ($prefix in $AllowedPrefixes) {
        if ($leaf.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $allowed = $true
            break
        }
    }
    if (-not $allowed) { throw "Refusing to remove an unowned directory: $resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Expand-Zip([string]$Archive, [string]$Target) {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($tar) {
        & $tar.Source -xf $Archive -C $Target
        if ($LASTEXITCODE -ne 0) { throw "Archive extraction failed with exit code $LASTEXITCODE" }
    }
    else {
        Expand-Archive -LiteralPath $Archive -DestinationPath $Target -Force
    }
}

function Copy-DirectoryContents([string]$Source, [string]$Target) {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $Target -Recurse -Force
    }
}

function Find-PayloadRoot([string]$Root) {
    if (Test-Path (Join-Path $Root 'runtime-manifest.json')) { return $Root }
    $children = @(Get-ChildItem -LiteralPath $Root -Directory -Force | Where-Object {
        Test-Path (Join-Path $_.FullName 'runtime-manifest.json')
    })
    if ($children.Count -ne 1) {
        throw "Runtime input must contain one runtime-manifest.json at its root or in one top-level directory: $Root"
    }
    return $children[0].FullName
}

function Assert-Runtime([string]$Root) {
    $manifestPath = Join-Path $Root 'runtime-manifest.json'
    if (-not (Test-Path $manifestPath)) { throw "Runtime manifest is missing: $manifestPath" }
    $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1) { throw "Unsupported runtime manifest schema: $($manifest.schemaVersion)" }
    if ($manifest.platform -ne 'win-x64') { throw "Unsupported runtime platform: $($manifest.platform)" }

    $entry = [IO.Path]::GetFullPath((Join-Path $Root $manifest.entry))
    $node = [IO.Path]::GetFullPath((Join-Path $Root $manifest.node))
    $npm = [IO.Path]::GetFullPath((Join-Path $Root $manifest.packageManager.command))
    $npmCli = [IO.Path]::GetFullPath((Join-Path $Root $manifest.packageManager.cli))
    $pnpm = [IO.Path]::GetFullPath((Join-Path $Root $manifest.packageManager.pnpmCommand))
    $pnpmCli = [IO.Path]::GetFullPath((Join-Path $Root $manifest.packageManager.pnpmCli))
    $resolver = [IO.Path]::GetFullPath((Join-Path $Root $manifest.resolver))
    $prefix = [IO.Path]::GetFullPath($Root) + [IO.Path]::DirectorySeparatorChar
    if (-not $entry.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $entry)) {
        throw "Runtime entry is invalid or missing: $entry"
    }
    if (-not $node.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $node)) {
        throw "Bundled Node is invalid or missing: $node"
    }
    if (-not $npm.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $npm)) {
        throw "Bundled npm command is invalid or missing: $npm"
    }
    if (-not $npmCli.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $npmCli)) {
        throw "Bundled npm CLI is invalid or missing: $npmCli"
    }
    if (-not $pnpm.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $pnpm)) {
        throw "Bundled pnpm command is invalid or missing: $pnpm"
    }
    if (-not $pnpmCli.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $pnpmCli)) {
        throw "Bundled pnpm CLI is invalid or missing: $pnpmCli"
    }
    if (-not $resolver.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $resolver)) {
        throw "Runtime resolver is invalid or missing: $resolver"
    }

    $links = @(Get-ChildItem -LiteralPath $Root -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue)
    if ($links.Count -ne 0) { throw "Runtime contains $($links.Count) unsupported links or reparse points" }

    $nodeVersion = (& $node --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') {
        throw "Bundled Node did not report a valid version: $nodeVersion"
    }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 19)) {
        throw "Bundled Node $nodeVersion is older than 22.19.0"
    }
    $npmVersion = (& $node $npmCli --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $npmVersion -notmatch '^\d+\.\d+\.\d+') {
        throw "Bundled npm did not report a valid version: $npmVersion"
    }
    $pnpmVersion = (& $node $pnpmCli --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -notmatch '^\d+\.\d+\.\d+') {
        throw "Bundled pnpm did not report a valid version: $pnpmVersion"
    }
    return [pscustomobject]@{ Manifest = $manifest; NodeVersion = $nodeVersion; NpmVersion = $npmVersion; PnpmVersion = $pnpmVersion }
}

function Resolve-NodeForSourceBuild {
    if (-not [string]::IsNullOrWhiteSpace($NodePath)) {
        $candidate = [IO.Path]::GetFullPath($NodePath)
        if (Test-Path $candidate) { return $candidate }
        throw "Selected node.exe does not exist: $candidate"
    }
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { throw 'Source ZIP mode requires Node.js 22.19+ in PATH or -NodePath' }
    return $command.Source
}

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null

    if ($Mode -eq 'archive') {
        if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
            $actual = Get-Sha256Hex $input
            if (-not $actual.Equals($ExpectedSha256, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Runtime archive SHA-256 mismatch. Expected $ExpectedSha256, got $actual"
            }
        }
        Expand-Zip $input $stage
    }
    elseif ($Mode -eq 'folder') {
        if (-not (Get-Item $input).PSIsContainer) { throw "Runtime folder mode requires a directory: $input" }
        Copy-DirectoryContents $input $stage
    }
    else {
        if ((Get-Item $input).PSIsContainer) { throw "Source mode requires a source ZIP: $input" }
        Expand-Zip $input $sourceWork
        $sourceRoots = @(Get-ChildItem -LiteralPath $sourceWork -Directory -Recurse -Force | Where-Object {
            (Test-Path (Join-Path $_.FullName 'pnpm-workspace.yaml')) -and
            (Test-Path (Join-Path $_.FullName 'windows\runtime\build.mjs'))
        })
        if ((Test-Path (Join-Path $sourceWork 'pnpm-workspace.yaml')) -and
            (Test-Path (Join-Path $sourceWork 'windows\runtime\build.mjs'))) {
            $sourceRoots = @((Get-Item $sourceWork)) + $sourceRoots
        }
        if ($sourceRoots.Count -ne 1) { throw 'Source ZIP must contain one DeepSeek Harness repository root' }
        $sourceRoot = $sourceRoots[0].FullName
        $node = Resolve-NodeForSourceBuild
        $nodeVersion = (& $node --version).Trim()
        if ($nodeVersion -notmatch '^v(\d+)\.(\d+)\.(\d+)$') { throw "Invalid Node version: $nodeVersion" }
        if ([int]$Matches[1] -lt 22 -or ([int]$Matches[1] -eq 22 -and [int]$Matches[2] -lt 19)) {
            throw "Source ZIP mode requires Node.js 22.19+, found $nodeVersion"
        }
        $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
        if (-not $pnpm) { throw 'Source ZIP mode requires pnpm in PATH' }
        $previousCI = $env:CI
        try {
            $env:CI = 'true'
            Invoke-Checked $pnpm.Source @('install', '--frozen-lockfile') $sourceRoot
            Invoke-Checked $pnpm.Source @('run', 'build') $sourceRoot
            Invoke-Checked $node @('windows/runtime/build.mjs', '--skip-build') $sourceRoot
        }
        finally {
            $env:CI = $previousCI
        }
        $builtRuntime = Join-Path $sourceRoot 'windows\runtime\dist\runtime'
        if (-not (Test-Path $builtRuntime)) { throw "Source build did not produce a runtime: $builtRuntime" }
        Copy-DirectoryContents $builtRuntime $stage
    }

    $payload = Find-PayloadRoot $stage
    $runtime = Assert-Runtime $payload
    if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        [IO.File]::WriteAllText(
            (Join-Path $payload '.source-sha256'),
            $ExpectedSha256.ToLowerInvariant(),
            [Text.UTF8Encoding]::new($false)
        )
    }

    if (Test-Path $backup) { Remove-OwnedTree $backup @('.runtime-backup-') }
    if (Test-Path $destinationPath) { Move-Item -LiteralPath $destinationPath -Destination $backup }
    try {
        Move-Item -LiteralPath $payload -Destination $destinationPath
        $installed = $true
    }
    catch {
        if ((Test-Path $backup) -and -not (Test-Path $destinationPath)) {
            Move-Item -LiteralPath $backup -Destination $destinationPath
        }
        throw
    }

    if (Test-Path $backup) { Remove-OwnedTree $backup @('.runtime-backup-') }
    [pscustomobject]@{
        Mode = $Mode
        Destination = $destinationPath
        Version = $runtime.Manifest.version
        Node = $runtime.NodeVersion
    } | ConvertTo-Json -Compress
}
finally {
    if (Test-Path $stage) { Remove-OwnedTree $stage @('.runtime-staging-') }
    if (Test-Path $sourceWork) { Remove-OwnedTree $sourceWork @('.runtime-source-') }
    if (-not $installed -and (Test-Path $backup) -and -not (Test-Path $destinationPath)) {
        Move-Item -LiteralPath $backup -Destination $destinationPath
    }
}
