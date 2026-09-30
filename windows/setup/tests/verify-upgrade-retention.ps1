param([string]$FixtureParent = (Join-Path $PSScriptRoot '..\test-results'), [switch]$TransientOnly)

$ErrorActionPreference = 'Stop'
$parent = [IO.Path]::GetFullPath($FixtureParent)
if (-not $parent.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fixtures must stay on D:' }
$root = Join-Path $parent ('retention-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $root) { throw "Fixture already exists: $root" }
New-Item -ItemType Directory -Path $root | Out-Null
$setup = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$savedEnvironment = @{}
foreach ($name in @('LOCALAPPDATA', 'USERPROFILE', 'DSH_HOME', 'DEEPSEEK_HARNESS_DATA_DIR')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$checks = [Collections.Generic.List[string]]::new()

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $checks.Add($Message)
}

function Write-Fixture([string]$Path, [string]$Content) {
    New-Item -ItemType Directory -Path (Split-Path $Path -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-TreeState([string]$Path) {
    return (@(Get-ChildItem -LiteralPath $Path -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($Path.Length)
        if ($_.PSIsContainer) { "D $relative" } else { "F $relative $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)" }
    }) -join "`n")
}

function Invoke-SetupScript([string]$Script, [string[]]$Parameters, [bool]$ExpectSuccess = $true) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $setup $Script) @Parameters 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previousPreference }
    $logPath = Join-Path $root ('operation-' + [Guid]::NewGuid().ToString('N') + '.log')
    $output | Out-File -LiteralPath $logPath -Encoding utf8
    if ($ExpectSuccess -and $code -ne 0) { throw "Operation failed ($code): $logPath" }
    if (-not $ExpectSuccess -and $code -eq 0) { throw "Operation unexpectedly succeeded: $logPath" }
    return ($output -join "`n")
}

try {
    $env:LOCALAPPDATA = Join-Path $root 'local'
    $env:USERPROFILE = Join-Path $root 'user'
    $env:DSH_HOME = Join-Path $root 'external-home'
    $env:DEEPSEEK_HARNESS_DATA_DIR = $null
    $payload = Join-Path $root 'payload'
    New-Item -ItemType Directory -Path $payload | Out-Null
    $compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $fixtureSource = (Resolve-Path (Join-Path $PSScriptRoot 'RuntimeVersionFixture.cs')).Path
    & $compiler /nologo /target:exe ('/out:' + (Join-Path $payload 'node.exe')) $fixtureSource
    if ($LASTEXITCODE -ne 0) { throw 'Cannot build Runtime version fixture' }
    foreach ($leaf in @('main.js', 'npm.cmd', 'npm.js', 'pnpm.cmd', 'pnpm.js', 'resolver.js')) {
        Write-Fixture (Join-Path $payload $leaf) 'fixture only; not an application Runtime'
    }
    $manifest = @{
        schemaVersion = 1; platform = 'win-x64'; version = 'retention-fixture'
        entry = 'main.js'; node = 'node.exe'; resolver = 'resolver.js'
        packageManager = @{ command = 'npm.cmd'; cli = 'npm.js'; pnpmCommand = 'pnpm.cmd'; pnpmCli = 'pnpm.js' }
    } | ConvertTo-Json
    Write-Fixture (Join-Path $payload 'runtime-manifest.json') $manifest
    $archive = Join-Path $root 'runtime.zip'
    Compress-Archive -LiteralPath $payload -DestinationPath $archive
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash

    $modes = if ($TransientOnly) { @() } else { @('standard', 'portable', 'custom') }
    foreach ($mode in $modes) {
        $app = Join-Path $root $mode
        $env:DEEPSEEK_HARNESS_DATA_DIR = if ($mode -eq 'custom') { Join-Path $root 'custom-data' } else { $null }
        $data = if ($mode -eq 'custom') { $env:DEEPSEEK_HARNESS_DATA_DIR } elseif ($mode -eq 'portable') { Join-Path $app 'data' } else { Join-Path $env:LOCALAPPDATA 'DeepSeekHarness' }
        $seedArguments = @('-Language', 'en-US', '-AppDirectory', $app)
        if ($mode -eq 'portable') { $seedArguments += '-Portable' }
        $seedResult = Invoke-SetupScript 'seed-config.ps1' $seedArguments | ConvertFrom-Json
        Assert-Condition $seedResult.Created "$mode creates first-run settings"
        Write-Fixture (Join-Path $data 'config.json') '{ "Language":"zh-CN", "FirstRunCompleted":true, "UnknownFutureSetting":{"one":{"two":{"three":[1,2,3]}}} }'
        Write-Fixture (Join-Path $data 'hub\installed.json') '[{"id":"existing-setup","workspace":"keep-original-path"}]'
        Write-Fixture (Join-Path $data 'hub\library\existing-setup\user-source.txt') 'user edits'
        foreach ($profileHome in @((Join-Path $data 'dsh'), $env:DSH_HOME, (Join-Path $env:USERPROFILE '.dsh'))) {
            Write-Fixture (Join-Path $profileHome 'profiles\web\package.json') '{"dependencies":{"external-plugin":"1.0.0"}}'
            Write-Fixture (Join-Path $profileHome 'profiles\web\node_modules\external-plugin\index.js') 'external plugin code'
            Write-Fixture (Join-Path $profileHome 'sessions\existing.jsonl') '{"fixture":"existing session bytes"}'
            Write-Fixture (Join-Path $profileHome 'sessions\index.sqlite-wal') 'fixture sidecar bytes'
        }
        $unicodeName = 'workspace\' + [char]0x9644 + [char]0x4ef6 + '.txt'
        Write-Fixture (Join-Path $data $unicodeName) ([string][char]0x4fdd + [char]0x7559)
        Write-Fixture (Join-Path $data 'workspace\.hidden') 'hidden'
        [IO.File]::SetAttributes((Join-Path $data 'workspace\.hidden'), [IO.FileAttributes]::Hidden)
        Write-Fixture (Join-Path $data 'workspace\empty.txt') ''
        [IO.File]::WriteAllBytes((Join-Path $data 'workspace\binary.bin'), [byte[]](0, 255, 1, 128))
        New-Item -ItemType Directory -Path (Join-Path $data 'empty-folder') -Force | Out-Null
        $before = Get-TreeState $data
        $externalBefore = Get-TreeState $env:DSH_HOME
        $upstreamBefore = Get-TreeState (Join-Path $env:USERPROFILE '.dsh')
        $destination = Join-Path $app 'runtime'
        Write-Fixture (Join-Path $destination 'user-custom-plugin.txt') 'modified legacy Runtime'
        foreach ($operation in @('update', 'repair')) {
            $oldRuntime = Get-TreeState $destination
            $runtimeArguments = if ($operation -eq 'update') {
                @('-Mode', 'folder', '-Destination', $destination, '-InputPath', $payload)
            } else {
                @('-Mode', 'archive', '-Destination', $destination, '-InputPath', $archive, '-ExpectedSha256', $archiveHash)
            }
            $result = Invoke-SetupScript 'install-runtime.ps1' $runtimeArguments | ConvertFrom-Json
            Assert-Condition ((Get-TreeState $result.PreviousRuntime) -ceq $oldRuntime) "$mode $operation retains entire old Runtime"
            $seedResult = Invoke-SetupScript 'seed-config.ps1' $seedArguments | ConvertFrom-Json
            Assert-Condition (-not $seedResult.Created -and -not $seedResult.FirstRunReset) "$mode $operation keeps onboarding"
            Assert-Condition ((Get-TreeState $data) -ceq $before) "$mode $operation preserves all user bytes and directories"
        }
        $runtimeBefore = Get-TreeState $destination
        $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'archive', '-Destination', $destination, '-InputPath', $archive, '-ExpectedSha256', ('0' * 64)) $false
        Assert-Condition ((Get-TreeState $destination) -ceq $runtimeBefore) "$mode hash mismatch leaves live Runtime intact"
        Write-Fixture (Join-Path $payload 'runtime-manifest.json') '{}'
        $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', $destination, '-InputPath', $payload) $false
        Assert-Condition ((Get-TreeState $destination) -ceq $runtimeBefore) "$mode bad payload leaves live Runtime intact"
        Write-Fixture (Join-Path $payload 'runtime-manifest.json') $manifest
        Write-Fixture (Join-Path $app '.runtime-transaction.json') '{"Backup":"unresolved recovery"}'
        $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', $destination, '-InputPath', $payload) $false
        Assert-Condition ((Get-TreeState $destination) -ceq $runtimeBefore) "$mode interrupted transaction blocks replacement"
        [IO.File]::Delete((Join-Path $app '.runtime-transaction.json'))
        $savedHome = $env:DSH_HOME
        $env:DSH_HOME = $destination
        $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', ($destination + '\'), '-InputPath', $payload) $false
        $env:DSH_HOME = $savedHome
        Assert-Condition ((Get-TreeState $destination) -ceq $runtimeBefore) "$mode overlapping user home blocks replacement"
        $locked = [IO.File]::Open((Join-Path $destination 'main.js'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        try {
            $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', $destination, '-InputPath', $payload) $false
        } finally { $locked.Dispose() }
        Assert-Condition ((Get-TreeState $destination) -ceq $runtimeBefore) "$mode locked Runtime leaves original intact"
        Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $app '.runtime-transaction.json'))) "$mode graceful failure clears transaction marker"
        $null = Invoke-SetupScript 'seed-config.ps1' $seedArguments
        Assert-Condition ((Get-TreeState $data) -ceq $before) "$mode retained-data config seeding is byte preserving"
        Assert-Condition ((Get-TreeState $env:DSH_HOME) -ceq $externalBefore) "$mode external home unchanged"
        Assert-Condition ((Get-TreeState (Join-Path $env:USERPROFILE '.dsh')) -ceq $upstreamBefore) "$mode upstream home unchanged"
        Write-Fixture (Join-Path $data 'config.json') '{broken JSON'
        $invalidBefore = Get-TreeState $data
        $null = Invoke-SetupScript 'seed-config.ps1' $seedArguments $false
        Assert-Condition ((Get-TreeState $data) -ceq $invalidBefore) "$mode invalid config stops without default reset"
    }
    $env:DEEPSEEK_HARNESS_DATA_DIR = $null
    $transientTarget = Join-Path $root 'transient-lock\runtime'
    Write-Fixture (Join-Path $transientTarget 'old-user-plugin.txt') 'retain this Runtime customization'
    $transientBefore = Get-TreeState $transientTarget
    $watcherStart = [Diagnostics.ProcessStartInfo]::new((Join-Path $payload 'node.exe'), ('--watch-stage "' + (Split-Path $transientTarget -Parent) + '" "' + (Join-Path $root 'lock-ready') + '"'))
    $watcherStart.UseShellExecute = $false
    $watcherStart.CreateNoWindow = $true
    $watcher = [Diagnostics.Process]::Start($watcherStart)
    try {
        $promotion = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', $transientTarget, '-InputPath', $payload) | ConvertFrom-Json
        if (-not $watcher.WaitForExit(20000)) { $watcher.Kill(); throw 'Fixture lock watcher timed out' }
        Assert-Condition ($watcher.ExitCode -eq 0) 'fixture watcher held and released a staging file'
    } finally {
        if (-not $watcher.HasExited) { $watcher.Kill(); $watcher.WaitForExit() }
        $watcher.Dispose()
    }
    Assert-Condition ($promotion.MoveRetries -gt 0) 'temporary staging lock is retried instead of aborting upgrade'
    Assert-Condition ((Get-TreeState $promotion.PreviousRuntime) -ceq $transientBefore) 'temporary staging lock preserves old Runtime backup'
    Assert-Condition (Test-Path -LiteralPath (Join-Path $transientTarget 'runtime-manifest.json')) 'temporary staging lock eventually promotes validated Runtime'
    $sentinel = Join-Path $root 'outside-sentinel'
    Write-Fixture (Join-Path $sentinel 'keep.txt') 'must not be traversed or removed'
    $sentinelBefore = Get-TreeState $sentinel
    $linkedApp = Join-Path $root 'linked-app'
    New-Item -ItemType Directory -Path $linkedApp | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $linkedApp 'runtime') -Target $sentinel | Out-Null
    $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', (Join-Path $linkedApp 'runtime'), '-InputPath', $payload) $false
    Assert-Condition ((Get-TreeState $sentinel) -ceq $sentinelBefore) 'linked destination never changes its target'
    New-Item -ItemType Junction -Path (Join-Path $payload 'external-link') -Target $sentinel | Out-Null
    $null = Invoke-SetupScript 'install-runtime.ps1' @('-Mode', 'folder', '-Destination', (Join-Path $root 'reject-links\runtime'), '-InputPath', $payload) $false
    Assert-Condition ((Get-TreeState $sentinel) -ceq $sentinelBefore) 'linked source never copies or cleans its target'
    $installer = Get-Content -LiteralPath (Join-Path $setup 'DeepSeekHarness.iss') -Raw
    Assert-Condition ($installer.Contains("Result := GetEnv('DEEPSEEK_HARNESS_DATA_DIR')")) 'installer wiring selects custom data root'
    Assert-Condition ($installer.Contains("DshHome := AddBackslash(SelectedDataDirectory) + 'dsh'")) 'installer wiring derives default home from selected data'
    Assert-Condition ($installer.Contains("Result := CustomMessage('DataModeChangeBlocked')")) 'installer wiring blocks implicit storage-mode migration'
    $preparation = $installer.Substring($installer.IndexOf('function PrepareToInstall('))
    Assert-Condition ($preparation.IndexOf('if not SeedFirstRunConfig') -ge 0 -and $preparation.IndexOf('if not SeedFirstRunConfig') -lt $preparation.IndexOf('if not InstallSelectedRuntime')) 'installer wiring validates config before Runtime replacement'
    [pscustomobject]@{ Checks = $checks.Count; Passed = $checks; Fixture = $root; Scope = 'Production Setup helpers with a version-only Runtime fixture and static Inno wiring checks; no installer, application boot or session-format migration executed.' } |
        ConvertTo-Json -Depth 5 | Tee-Object -FilePath (Join-Path $root 'results.json')
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
