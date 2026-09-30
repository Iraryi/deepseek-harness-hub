Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:OverlayId = 'DSH.Overlay.6E4AA8A1-93AD-47D7-AD79-75FA9A01DCBE'

function Get-OverlayPath {
    param([Parameter(Mandatory)][string]$Path)
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f"<>|?*]' -or $Path.Substring(2).Contains(':')) {
        throw "Use an explicit local absolute path, without shell/device syntax: $Path"
    }
    foreach ($segment in $Path.Substring(3).Replace('/', '\').Split('\')) {
        if ($segment.EndsWith('.') -or $segment.EndsWith(' ') -or $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') {
            throw "Ambiguous Windows path: $Path"
        }
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if ($full.Length -le 3) { throw 'A drive root is not an application or data directory.' }
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Linked path/ancestor is not supported: $ancestor"
            }
        }
        $ancestor = [IO.Path]::GetDirectoryName($ancestor)
    }
    return $full
}

function Test-OverlayOverlap {
    param([string]$First, [string]$Second)
    return $First.Equals($Second, [StringComparison]::OrdinalIgnoreCase) -or
        $First.StartsWith($Second + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $Second.StartsWith($First + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Read-OverlayJson {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing JSON: $Path" }
    if ((Get-Item -LiteralPath $Path).Length -gt 16MB) { throw "JSON exceeds inspection limit: $Path" }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-OverlayHash {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-OverlayRuntime {
    param([string]$RuntimeRoot, [string]$NodePath)
    $runtime = Get-OverlayPath $RuntimeRoot
    $node = Get-OverlayPath $NodePath
    if (-not (Test-Path -LiteralPath $runtime -PathType Container)) { throw 'Runtime directory does not exist.' }
    if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or [IO.Path]::GetFileName($node) -ine 'node.exe') {
        throw 'Select an existing node.exe explicitly.'
    }
    $nodeVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($node).ProductVersion
    if ($nodeVersion -notmatch '^(\d+)\.(\d+)\.(\d+)') { throw 'Node has no inspectable Windows product version.' }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if (-not (($major -eq 22 -and $minor -ge 19) -or $major -ge 24)) { throw "Unsupported Node version: $nodeVersion" }
    $layouts = @(
        @{ Adapter = 'packaged-cli-v1'; Package = 'node_modules\@deepseek-ai\dsh'; Entry = 'node_modules\@deepseek-ai\dsh\lib\bin.js' },
        @{ Adapter = 'package-cli-v1'; Package = ''; Entry = 'lib\bin.js' },
        @{ Adapter = 'legacy-repo-v1'; Package = 'apps\cli'; Entry = 'apps\cli\lib\bin.js' }
    )
    $layout = $layouts | Where-Object { Test-Path -LiteralPath (Join-Path $runtime $_.Entry) -PathType Leaf } | Select-Object -First 1
    if (-not $layout) { throw 'No supported compiled DSH CLI. Source-only and opaque Electron/ASAR runtimes are not supported.' }
    $packagePath = Join-Path (Join-Path $runtime $layout.Package) 'package.json'
    $package = Read-OverlayJson $packagePath
    if ($package.name -ne '@deepseek-ai/dsh' -or $package.version -ne '0.1.3-alpha.2' -or $package.bin.dsh -ne 'lib/bin.js') {
        throw 'Unqualified CLI identity/version/bin. This adapter supports @deepseek-ai/dsh 0.1.3-alpha.2 only; add and test an adapter for newer versions.'
    }
    $entry = Join-Path $runtime $layout.Entry
    $resolver = Join-Path $runtime 'runtime-resolver.mjs'
    if (Test-Path -LiteralPath (Join-Path $runtime 'runtime-manifest.json')) {
        $null = Read-OverlayJson (Join-Path $runtime 'runtime-manifest.json')
        if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) { throw 'Packaged Runtime resolver is missing.' }
    }
    $resolverHash = $null
    if (Test-Path -LiteralPath $resolver -PathType Leaf) { $resolverHash = Get-OverlayHash $resolver }
    return [ordered]@{
        Adapter = $layout.Adapter; Root = $runtime; NodePath = $node; NodeVersion = $nodeVersion
        CliVersion = $package.version; CliEntry = $entry; CliSha256 = Get-OverlayHash $entry
        PackageSha256 = Get-OverlayHash $packagePath; NodeSha256 = Get-OverlayHash $node; ResolverSha256 = $resolverHash
        Verification = 'static-layout-only; no runtime execution, dependency, session or plugin activation qualification'
    }
}

function New-OverlayPlan {
    param(
        [Parameter(Mandatory)][string]$HostRoot,
        [Parameter(Mandatory)][string]$RuntimeRoot,
        [Parameter(Mandatory)][string]$NodePath,
        [Parameter(Mandatory)][string]$DshHome,
        [Parameter(Mandatory)][string]$StateRoot,
        [Parameter(Mandatory)][string]$InstallRoot,
        [string]$Version = '0.1.0'
    )
    if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Overlay Version must be major.minor.patch.' }
    $paths = [ordered]@{}
    foreach ($name in @('HostRoot', 'RuntimeRoot', 'NodePath', 'DshHome', 'StateRoot', 'InstallRoot')) {
        $paths[$name] = Get-OverlayPath (Get-Variable -Name $name -ValueOnly)
    }
    foreach ($name in @('HostRoot', 'RuntimeRoot', 'DshHome')) {
        if (-not (Test-Path -LiteralPath $paths[$name] -PathType Container)) { throw "$name must already exist; Setup never creates a base/home." }
    }
    foreach ($name in @('HostRoot', 'RuntimeRoot', 'NodePath', 'DshHome', 'StateRoot')) {
        if (Test-OverlayOverlap $paths.InstallRoot $paths[$name]) { throw "Overlay install directory overlaps $name." }
    }
    foreach ($name in @('HostRoot', 'RuntimeRoot', 'NodePath', 'DshHome')) {
        if (Test-OverlayOverlap $paths.StateRoot $paths[$name]) { throw "Overlay state directory overlaps $name." }
    }
    $runtime = Get-OverlayRuntime $paths.RuntimeRoot $paths.NodePath
    $hostEvidence = @()
    foreach ($candidate in @('package.json', 'resources\app\package.json')) {
        $manifestPath = Join-Path $paths.HostRoot $candidate
        if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
            $manifest = Read-OverlayJson $manifestPath
            $hostEvidence += [ordered]@{ File = $candidate; Name = $manifest.name; Version = $manifest.version; Sha256 = Get-OverlayHash $manifestPath }
        }
    }
    foreach ($executable in @(Get-ChildItem -LiteralPath $paths.HostRoot -Filter '*.exe' -File)) {
        $hostEvidence += [ordered]@{ File = $executable.Name; Version = $executable.VersionInfo.ProductVersion }
    }
    if ($hostEvidence.Count -eq 0) { throw 'Host is not inspectable: select a directory containing package.json or a host EXE.' }
    $receipt = Join-Path $paths.InstallRoot 'overlay-binding.json'
    foreach ($relative in @('overlay-binding.json', 'Overlay.psm1', 'launch.ps1', 'plan.ps1', 'resolver.mjs', 'README.md', 'README.zh.md', 'INTEGRATION.md', 'TESTING.md', 'payload-manifest.json', 'payload', 'unins000.exe', 'unins000.dat')) {
        $null = Get-OverlayPath (Join-Path $paths.InstallRoot $relative)
    }
    if (Test-Path -LiteralPath (Join-Path $paths.InstallRoot 'payload') -PathType Container) {
        $null = Get-OverlayTree (Join-Path $paths.InstallRoot 'payload')
    }
    $action = 'install'
    if (Test-Path -LiteralPath $receipt -PathType Leaf) {
        $previous = Read-OverlayJson $receipt
        if ($previous.Schema -ne 1 -or $previous.AppId -ne $script:OverlayId) { throw 'Foreign Overlay identity/schema.' }
        foreach ($name in $paths.Keys) {
            if ($paths[$name] -ine $previous.Paths.$name) { throw "Retain identity on update/repair: $name differs. Use a separate installation instead of rebinding." }
        }
        if ([version]$Version -lt [version]$previous.Version) { throw 'Overlay downgrade is not supported.' }
        $action = if ($Version -eq $previous.Version) { 'repair' } else { 'update' }
    } elseif (Test-Path -LiteralPath $paths.InstallRoot) {
        if (@(Get-ChildItem -LiteralPath $paths.InstallRoot -Force).Count -gt 0) { throw 'Refusing a nonempty, unowned installation directory.' }
    }
    $stateOwnerPath = Join-Path $paths.StateRoot 'overlay-state.json'
    foreach ($relative in @('overlay-state.json', 'config.json', 'hub-config.json')) {
        $null = Get-OverlayPath (Join-Path $paths.StateRoot $relative)
    }
    if (Test-Path -LiteralPath $paths.StateRoot) {
        if (-not (Test-Path -LiteralPath $paths.StateRoot -PathType Container)) { throw 'StateRoot must be a directory.' }
        if (@(Get-ChildItem -LiteralPath $paths.StateRoot -Force).Count -gt 0) {
            $owner = Read-OverlayJson $stateOwnerPath
            if ($owner.AppId -ne $script:OverlayId -or $owner.Schema -ne 1) { throw 'StateRoot is not owned by this Overlay.' }
            foreach ($name in $paths.Keys) {
                if ($paths[$name] -ine $owner.Paths.$name) { throw "Retained state identity differs: $name" }
            }
        }
    }
    return [pscustomobject][ordered]@{
        Schema = 1; AppId = $script:OverlayId; Version = $Version; Action = $action; Paths = $paths
        Runtime = $runtime; HostEvidence = $hostEvidence
        Profile = @{ Home = $paths.DshHome; Verification = 'explicit existing home; contents not parsed or migrated; runtime activation unverified' }
        Writes = @('owned files in InstallRoot', 'per-user Overlay uninstall registration', 'dedicated Overlay HUB/CONFIG shortcuts')
        Preserves = @('base application and runtime', 'DSH home and profiles', 'sessions and credentials', 'external Overlay state on uninstall')
        Limitations = @('No upstream Desktop integration or format migration', 'No runtime downloads, PATH or DSH_HOME registration', 'No automatic process termination or base repair')
    }
}

function Get-OverlayLaunchPlan {
    param([Parameter(Mandatory)][object]$Binding, [ValidateSet('DESKTOP', 'HUB', 'CONFIG')][string]$Target = 'HUB')
    $parameters = @{}
    foreach ($name in @('HostRoot', 'RuntimeRoot', 'NodePath', 'DshHome', 'StateRoot', 'InstallRoot')) { $parameters[$name] = [string]$Binding.Paths.$name }
    $parameters.Version = $Binding.Version
    $current = New-OverlayPlan @parameters
    foreach ($field in @('CliSha256', 'PackageSha256', 'NodeSha256', 'ResolverSha256')) {
        if ($current.Runtime[$field] -ne $Binding.Runtime.$field) { throw "Runtime changed ($field). Inspect and repair Overlay to accept new evidence; no fallback runtime is allowed." }
    }
    $configPath = Join-Path $Binding.Paths.StateRoot 'config.json'
    $firstRun = $true
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $config = Read-OverlayJson $configPath
        if ($config.RepoPath -ine $Binding.Paths.RuntimeRoot -or $config.NodePath -ine $Binding.Paths.NodePath) {
            throw 'Retained CONFIG runtime paths differ from the binding; no config overwrite or fallback is allowed.'
        }
        $firstRun = -not $config.FirstRunCompleted
    }
    $executable = if ($Target -eq 'CONFIG' -or $firstRun) { 'dsh-config.exe' } elseif ($Target -eq 'DESKTOP') { 'dsh.exe' } else { 'dsh-hub.exe' }
    $arguments = @('--dsh-data-dir', $Binding.Paths.StateRoot, '--dsh-home', $Binding.Paths.DshHome, '--dsh-instance-scope', $script:OverlayId)
    if ($executable -eq 'dsh-config.exe' -and $Target -ne 'DESKTOP') { $arguments = @('--hub') + $arguments }
    return [pscustomobject]@{ FilePath = Join-Path $Binding.Paths.InstallRoot "payload\$executable"; Arguments = $arguments; FirstRun = $firstRun }
}

function Test-OverlayPayload {
    param([Parameter(Mandatory)][string]$InstallRoot)
    $manifest = Read-OverlayJson (Join-Path $InstallRoot 'payload-manifest.json')
    if ($manifest.Schema -ne 1) { throw 'Unsupported payload manifest.' }
    $null = Get-OverlayTree (Join-Path $InstallRoot 'payload')
    foreach ($property in $manifest.Files.PSObject.Properties) {
        $name = $property.Name
        if ([IO.Path]::IsPathRooted($name) -or ($name -split '[\\/]') -contains '..') { throw 'Unsafe payload inventory path.' }
        $file = Get-OverlayPath (Join-Path $InstallRoot "payload\$name")
        if ((Get-OverlayHash $file) -ne $property.Value) { throw "Overlay payload changed/missing: $name. Repair Overlay." }
    }
}

function Get-OverlayTree {
    param([Parameter(Mandatory)][string]$Root)
    $rootPath = Get-OverlayPath $Root
    $pending = [Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($rootPath)
    while ($pending.Count -gt 0) {
        foreach ($item in Get-ChildItem -LiteralPath $pending.Dequeue() -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Payload links are not supported: $($item.FullName)" }
            if ($item.PSIsContainer) { $pending.Enqueue($item.FullName) } else { $item }
        }
    }
}

function Write-OverlayNewJson {
    param([string]$Path, [object]$Value)
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 16) + "`n")
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

function Initialize-OverlayState {
    param([Parameter(Mandatory)][object]$Binding)
    $null = Get-OverlayLaunchPlan $Binding CONFIG
    $root = $Binding.Paths.StateRoot
    $null = [IO.Directory]::CreateDirectory($root)
    $owner = Join-Path $root 'overlay-state.json'
    if (-not (Test-Path -LiteralPath $owner)) { Write-OverlayNewJson $owner $Binding }
    $config = Join-Path $root 'config.json'
    if (-not (Test-Path -LiteralPath $config)) {
        Write-OverlayNewJson $config ([ordered]@{ RepoPath = $Binding.Paths.RuntimeRoot; NodePath = $Binding.Paths.NodePath; FirstRunCompleted = $false })
    }
}

function ConvertTo-OverlayArgument {
    param([AllowEmptyString()][string]$Value)
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

Export-ModuleMember -Function Get-OverlayPath, Test-OverlayOverlap, Read-OverlayJson, Get-OverlayHash, Get-OverlayRuntime, New-OverlayPlan, Get-OverlayLaunchPlan, Initialize-OverlayState, Test-OverlayPayload, Get-OverlayTree, Write-OverlayNewJson, ConvertTo-OverlayArgument
