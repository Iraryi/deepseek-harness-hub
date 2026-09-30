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
$destinationPath = [IO.Path]::GetFullPath($Destination).TrimEnd('\', '/')
$parent = Split-Path $destinationPath -Parent
if ([string]::IsNullOrWhiteSpace($parent) -or (Split-Path $destinationPath -Leaf) -ne 'runtime') {
    throw "Runtime destination must be an application runtime directory: $destinationPath"
}

$input = [IO.Path]::GetFullPath($InputPath)
if (-not (Test-Path $input)) { throw "Runtime input does not exist: $input" }

$operation = [Guid]::NewGuid().ToString('N').Substring(0, 12)
$stage = Join-Path $parent ('.runtime-staging-' + $operation)
$backup = Join-Path $parent ('.runtime-backup-' + $operation)
$sourceWork = Join-Path $parent ('.runtime-source-' + $operation)
$installed = $false
$transactionPath = Join-Path $parent '.runtime-transaction.json'
$ownsTransaction = $false
$script:runtimeMoveRetries = 0

function Move-RuntimeDirectory([string]$Source, [string]$Target) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($true) {
        Assert-NoLinkedAncestors $Source
        Assert-NoLinkedAncestors $Target
        try {
            [IO.Directory]::Move($Source, $Target)
            return
        } catch {
            $failure = $_.Exception
            while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
            $nativeCode = $failure.HResult -band 65535
            if ($nativeCode -notin @(5, 32, 33) -or $clock.ElapsedMilliseconds -ge 10000 -or
                (Test-Path -LiteralPath $Target) -or -not (Test-Path -LiteralPath $Source -PathType Container)) {
                throw "Runtime directory switch failed (Windows error $nativeCode): '$Source' -> '$Target'. Existing files were not overwritten. $($failure.Message)"
            }
            $script:runtimeMoveRetries++
            Start-Sleep -Milliseconds 500
        }
    }
}

function Assert-NoLinkedAncestors([string]$Path) {
    $cursor = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrWhiteSpace($cursor)) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Runtime operation refuses linked paths: $cursor"
            }
        }
        $cursor = Split-Path $cursor -Parent
    }
}

function Assert-NoLinksInTree([string]$Path) {
    Assert-NoLinkedAncestors $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        foreach ($child in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Runtime operation refuses linked paths: $($child.FullName)"
            }
            if ($child.PSIsContainer) { $pending.Push($child.FullName) }
        }
    }
}

Assert-NoLinkedAncestors $destinationPath
foreach ($userPath in @($env:DSH_HOME, $env:DEEPSEEK_HARNESS_DATA_DIR)) {
    if ([string]::IsNullOrWhiteSpace($userPath)) { continue }
    $resolvedUserPath = [IO.Path]::GetFullPath($userPath).TrimEnd('\', '/')
    if ($resolvedUserPath.Equals($destinationPath, [StringComparison]::OrdinalIgnoreCase) -or
        $resolvedUserPath.StartsWith($destinationPath.TrimEnd('\', '/') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "User data overlaps the replaceable Runtime. No Runtime files were changed: $resolvedUserPath"
    }
}
if (Test-Path -LiteralPath $transactionPath) {
    throw "An unfinished Runtime update requires recovery. Preserve the current Runtime and the backup recorded in: $transactionPath"
}
New-Item -ItemType Directory -Path $parent -Force | Out-Null

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
    Assert-NoLinksInTree $resolved
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
    Assert-NoLinksInTree $Source
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

    Assert-NoLinkedAncestors $destinationPath
    if (Test-Path -LiteralPath $backup) { throw "Runtime backup already exists: $backup" }
    $transaction = [IO.File]::Open($transactionPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $ownsTransaction = $true
    try {
        $record = [pscustomobject]@{ Destination = $destinationPath; Backup = $backup; Payload = $payload; Version = $runtime.Manifest.version }
        $bytes = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
        $transaction.Write($bytes, 0, $bytes.Length)
        $transaction.Flush($true)
    } finally { $transaction.Dispose() }
    if (Test-Path $destinationPath) { Move-RuntimeDirectory $destinationPath $backup }
    try {
        Move-RuntimeDirectory $payload $destinationPath
        $installed = $true
    }
    catch {
        if ((Test-Path $backup) -and -not (Test-Path $destinationPath)) {
            Move-RuntimeDirectory $backup $destinationPath
        }
        throw
    }

    [pscustomobject]@{
        Mode = $Mode
        Destination = $destinationPath
        Version = $runtime.Manifest.version
        Node = $runtime.NodeVersion
        PreviousRuntime = $(if (Test-Path -LiteralPath $backup) { $backup } else { $null })
        MoveRetries = $script:runtimeMoveRetries
    } | ConvertTo-Json -Compress
}
finally {
    if (-not $installed -and (Test-Path $backup) -and -not (Test-Path $destinationPath)) {
        Move-RuntimeDirectory $backup $destinationPath
    }
    if ($ownsTransaction -and ($installed -or -not (Test-Path -LiteralPath $backup))) {
        [IO.File]::Delete($transactionPath)
    }
    foreach ($temporaryTree in @($stage, $sourceWork)) {
        try {
            Remove-OwnedTree $temporaryTree @('.runtime-staging-', '.runtime-source-')
        } catch {
            Write-Warning "Temporary build files retained for inspection: $temporaryTree. $($_.Exception.Message)"
        }
    }
}
