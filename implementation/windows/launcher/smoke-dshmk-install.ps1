param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [string]$RuntimeDirectory = ''
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-LauncherDirectory', $LauncherDirectory)
    if (-not [string]::IsNullOrWhiteSpace($RuntimeDirectory)) { $arguments += @('-RuntimeDirectory', $RuntimeDirectory) }
    & $windowsPowerShell @arguments
    if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell DSHMK installation smoke failed: $LASTEXITCODE" }
    return
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$data = Join-Path ([IO.Path]::GetTempPath()) ('dsh-dshmk-install-smoke-' + [Guid]::NewGuid().ToString('N'))
$previousData = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousHome = $env:DSH_HOME
$resolve = $null
$succeeded = $false

try {
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $data 'dsh-home'
    $hubData = Join-Path $data 'hub'
    New-Item -ItemType Directory -Path $hubData -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $launcher 'dshmk-catalog.json') -Destination (Join-Path $hubData 'dshmk-catalog.json')
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
    $configType.GetProperty('FirstRunCompleted').SetValue($config, $true, $null)
    $configType.GetProperty('LoadingStyle').SetValue($config, 'off', $null)
    $repository = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $runtime = if ([string]::IsNullOrWhiteSpace($RuntimeDirectory)) {
        Join-Path $repository 'windows\runtime\dist\runtime'
    } else {
        [IO.Path]::GetFullPath($RuntimeDirectory)
    }
    $node = Join-Path $runtime 'tools\node\node.exe'
    if (-not (Test-Path -LiteralPath $runtime)) { throw "Packaged Runtime is missing: $runtime" }
    if (-not (Test-Path -LiteralPath $node)) { throw "Bundled Node.js is missing: $node" }
    $configType.GetProperty('RepoPath').SetValue($config, $runtime, $null)
    $configType.GetProperty('NodePath').SetValue($config, $node, $null)
    $constructor = $formType.GetConstructor([Reflection.BindingFlags]'Public,Instance', $null, @($configType, [bool], [bool]), $null)
    $form = $constructor.Invoke(@($config, $true, $true))
    try {
        [Threading.SynchronizationContext]::SetSynchronizationContext($null)
        $flags = [Reflection.BindingFlags]'NonPublic,Instance'
        $webViewField = $formType.GetField('_webView', $flags)
        if ($null -ne $webViewField.GetValue($form)) { throw 'DSHMK install smoke unexpectedly initialized WebView2' }
        $installMethod = $formType.GetMethod('InstallDshmkSetupAsync', $flags)
        $requestId = 'dshmk-install-smoke-' + [Guid]::NewGuid().ToString('N')
        $installTask = $installMethod.Invoke($form, @($requestId, 1326893710))
        [void]$installTask.GetAwaiter().GetResult()
        $result = $installTask.GetType().GetProperty('Result').GetValue($installTask, $null)
        if ([string]$result['status'] -ne 'activated') { throw "Unexpected activation status: $($result['status'])" }
        if (@($result['packageNames']) -notcontains 'dsh-better-sidebar') { throw 'DSH-better-sidebar was not reported as installed' }
        if (@($result['activeBundles']) -notcontains 'dsh-better-sidebar') { throw 'DSH-better-sidebar was not activated as a Bundle' }

        $retryRequestId = 'dshmk-install-retry-' + [Guid]::NewGuid().ToString('N')
        $retryTask = $installMethod.Invoke($form, @($retryRequestId, [int]1326893710))
        [void]$retryTask.GetAwaiter().GetResult()
        $retryResult = $retryTask.GetType().GetProperty('Result').GetValue($retryTask, $null)
        if ([string]$retryResult['status'] -ne 'activated') { throw "Unexpected retry activation status: $($retryResult['status'])" }

        $profilePath = Join-Path $env:DSH_HOME 'profiles\web\package.json'
        $profile = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($profile.dependencies.PSObject.Properties.Name -notcontains 'dsh-better-sidebar') { throw 'Web profile has no DSH-better-sidebar dependency' }
        if (@($profile.dsh.profile.bundles) -notcontains 'dsh-better-sidebar') { throw 'Web profile Bundle list has no DSH-better-sidebar entry' }

        $setupPath = Join-Path $data 'hub\library\dshmk-1326893710\setup.json'
        $setup = Get-Content -LiteralPath $setupPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $artifact = @($setup.artifacts)[0]
        if ([string]$artifact.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'DSHMK Setup record has no SHA-256 artifact digest' }
        if ([string]$setup.install.artifactId -ne [string]$artifact.id) { throw 'DSHMK Setup record does not install its verified artifact' }
        $installedPath = Join-Path $data 'hub\installed.json'
        $installed = @(Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8 | ConvertFrom-Json)
        if ($installed.Count -ne 1) { throw "Repeated installation created duplicate HUB records: $($installed.Count)" }

        $logPath = Join-Path $data 'logs\app.log'
        $log = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
        if ($log.Contains([char]0xfffd)) { throw 'Launcher log contains a Unicode replacement character from incorrect subprocess decoding' }
        if ($log -match 'pnpm failed|Starting DSHMK install candidate') { throw 'DSHMK install fell back to the legacy pnpm command path' }
        if ($log -notmatch 'Starting Setup installer through bundled CLI') { throw 'DSHMK install did not use the bundled Setup CLI' }

        [pscustomobject]@{
            Status = $result['status']
            RetryStatus = $retryResult['status']
            Package = 'dsh-better-sidebar'
            ActiveBundles = @($result['activeBundles']) -join ', '
            ArtifactSha256 = $artifact.sha256
            Profile = $profilePath
            SetupRecord = $setupPath
            LegacyPnpmUsed = $false
            UnicodeReplacementCharacters = 0
        }
        $succeeded = $true
    }
    finally {
        $form.Dispose()
    }
}
finally {
    if ($resolve) { [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolve) }
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousData
    $env:DSH_HOME = $previousHome
    if ($succeeded -and (Test-Path -LiteralPath $data)) { Remove-Item -LiteralPath $data -Recurse -Force }
    elseif (Test-Path -LiteralPath $data) { Write-Warning "Preserved failed DSHMK install smoke data at $data" }
}
