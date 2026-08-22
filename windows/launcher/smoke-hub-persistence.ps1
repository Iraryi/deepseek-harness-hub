param(
    [Parameter(Mandatory = $true)]
    [string]$LauncherDirectory,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedDataRoot,

    [string]$SetupId = 'hotfix-persisted-plugin',

    [switch]$VerifyBackupRecovery
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath @PSBoundParameters
    if ($LASTEXITCODE -ne 0) { throw "HUB persistence smoke failed: $LASTEXITCODE" }
    return
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$expectedRoot = [IO.Path]::GetFullPath($ExpectedDataRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
$previousData = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousHome = $env:DSH_HOME
$resolve = $null

try {
    $env:DEEPSEEK_HARNESS_DATA_DIR = $null
    $env:DSH_HOME = $null
    $resolve = [ResolveEventHandler] {
        param($sender, $eventArgs)
        $name = ([Reflection.AssemblyName]$eventArgs.Name).Name + '.dll'
        $candidate = Join-Path $launcher $name
        if (Test-Path -LiteralPath $candidate) { return [Reflection.Assembly]::LoadFrom($candidate) }
        return $null
    }
    [AppDomain]::CurrentDomain.add_AssemblyResolve($resolve)
    $assembly = [Reflection.Assembly]::LoadFrom((Join-Path $launcher 'dsh-hub.exe'))
    $configType = $assembly.GetType('AppConfig', $true)
    $formType = $assembly.GetType('MainForm', $true)
    $config = [Activator]::CreateInstance($configType, $true)
    $constructor = $formType.GetConstructor([Reflection.BindingFlags]'Public,Instance', $null, @($configType, [bool], [bool]), $null)
    $form = $constructor.Invoke(@($config, $true, $true))
    try {
        $snapshotMethod = $formType.GetMethod('BuildHubSnapshot', [Reflection.BindingFlags]'NonPublic,Instance')
        $snapshot = $snapshotMethod.Invoke($form, @())
        $libraryPath = [IO.Path]::GetFullPath([string]$snapshot['libraryPath']).TrimEnd([IO.Path]::DirectorySeparatorChar)
        $expectedLibraryPath = Join-Path $expectedRoot 'hub\library'
        if (-not $libraryPath.Equals([IO.Path]::GetFullPath($expectedLibraryPath).TrimEnd([IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
            throw "HUB selected the wrong data root. Expected $expectedRoot, got $libraryPath"
        }
        $record = @($snapshot['installed'] | Where-Object { [string]$_['id'] -eq $SetupId })
        if ($record.Count -ne 1) { throw "Persisted HUB Setup record was not loaded: $SetupId" }
        $workspace = [string]$record[0]['workspacePath']
        if (-not (Test-Path -LiteralPath (Join-Path $workspace 'receipt.txt'))) {
            throw "Persisted HUB Setup workspace was not loaded: $workspace"
        }
        $backupRecovered = $false
        if ($VerifyBackupRecovery) {
            $installedPath = Join-Path $expectedRoot 'hub\installed.json'
            $backupPath = $installedPath + '.backup'
            $parsedRecords = Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $records = @()
            if ($parsedRecords -is [Array]) { $records += $parsedRecords } else { $records += $parsedRecords }
            $targetRecord = @($records | Where-Object { [string]$_.id -eq $SetupId })
            if ($targetRecord.Count -ne 1) { throw 'Backup recovery fixture record is missing' }
            $targetRecord[0].workspacePath = Join-Path $expectedRoot 'legacy-location\missing-workspace'
            ConvertTo-Json -InputObject $records -Depth 8 | Set-Content -LiteralPath $installedPath -Encoding UTF8
            Copy-Item -LiteralPath $installedPath -Destination $backupPath -Force
            [IO.File]::WriteAllText($installedPath, '{invalid-json', [Text.UTF8Encoding]::new($false))
            $recoveredSnapshot = $snapshotMethod.Invoke($form, @())
            $recovered = @($recoveredSnapshot['installed'] | Where-Object { [string]$_['id'] -eq $SetupId })
            if ($recovered.Count -ne 1) { throw 'HUB did not recover the installed record backup' }
            if (-not ([string]$recovered[0]['workspacePath']).Equals($workspace, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'HUB did not rebase the recovered workspace to the active library root'
            }
            $backupRecovered = $true
        }
        [pscustomobject]@{
            DataRoot = $expectedRoot
            LibraryPath = $libraryPath
            SetupId = $SetupId
            InstalledRecords = @($snapshot['installed']).Count
            WorkspaceReceipt = $true
            BackupRecovered = $backupRecovered
        }
    }
    finally {
        $form.Dispose()
    }
}
finally {
    if ($resolve) { [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolve) }
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousData
    $env:DSH_HOME = $previousHome
}
