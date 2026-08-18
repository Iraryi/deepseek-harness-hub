param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -LauncherDirectory $LauncherDirectory
    if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell HUB data smoke failed: $LASTEXITCODE" }
    return
}

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$data = Join-Path ([IO.Path]::GetTempPath()) ('dsh-hub-data-smoke-' + [Guid]::NewGuid().ToString('N'))
$previousData = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousHome = $env:DSH_HOME

try {
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DSH_HOME = Join-Path $data 'dsh-home'
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
    $bundledRuntime = Join-Path $repository 'windows\runtime\dist\runtime'
    $bundledNode = Join-Path $bundledRuntime 'tools\node\node.exe'
    if (Test-Path -LiteralPath $bundledRuntime) { $configType.GetProperty('RepoPath').SetValue($config, $bundledRuntime, $null) }
    if (Test-Path -LiteralPath $bundledNode) { $configType.GetProperty('NodePath').SetValue($config, $bundledNode, $null) }
    $constructor = $formType.GetConstructor([Reflection.BindingFlags]'Public,Instance', $null, @($configType, [bool], [bool]), $null)
    $form = $constructor.Invoke(@($config, $true, $true))
    try {
        [Threading.SynchronizationContext]::SetSynchronizationContext($null)
        $flags = [Reflection.BindingFlags]'NonPublic,Instance'
        $webViewField = $formType.GetField('_webView', $flags)
        if ($null -ne $webViewField.GetValue($form)) { throw 'HUB data smoke unexpectedly initialized WebView2' }
        $serializer = [System.Web.Script.Serialization.JavaScriptSerializer]::new()
        $snapshotMethod = $formType.GetMethod('BuildHubSnapshot', $flags)
        $registryMethod = $formType.GetMethod('LoadCommunityRegistryAsync', $flags)
        $prepareMethod = $formType.GetMethod('PrepareCommunitySetupAsync', $flags)
        $installMethod = $formType.GetMethod('InstallSetupManifestAsync', $flags)
        $trustMethod = $formType.GetMethod('ClassifySetupTrust', [Reflection.BindingFlags]'NonPublic,Static')
        $searchMethod = $formType.GetMethod('SearchGitHubAsync', $flags)
        $draftMethod = $formType.GetMethod('CreateSetupDraft', $flags)
        $snapshot = $snapshotMethod.Invoke($form, @())
        if (-not (Test-Path -LiteralPath $snapshot['libraryPath'])) { throw 'HUB library directory was not created' }
        if (-not (Test-Path -LiteralPath $snapshot['offlinePath'])) { throw 'HUB offline directory was not created' }

        $registryTask = $registryMethod.Invoke($form, @())
        [void]$registryTask.GetAwaiter().GetResult()
        $registry = $registryTask.GetType().GetProperty('Result').GetValue($registryTask, $null)
        if ($registry['plugins'].Count -lt 100) { throw "Community registry returned too few entries: $($registry['plugins'].Count)" }
        if (@('live', 'cache', 'bundled') -notcontains $registry['sourceMode']) { throw "Unexpected community registry source: $($registry['sourceMode'])" }
        $installable = @($registry['plugins'] | Where-Object {
            -not [string]::IsNullOrWhiteSpace([string]$_['npm']) -and ([string]$_['url']) -notmatch '/tree/'
        } | Select-Object -First 1)
        if ($installable.Count -ne 1) { throw 'Community registry contains no npm-backed Setup candidate' }
        $prepareTask = $prepareMethod.Invoke($form, @([string]$installable[0]['url']))
        [void]$prepareTask.GetAwaiter().GetResult()
        $manifest = $prepareTask.GetType().GetProperty('Result').GetValue($prepareTask, $null)
        $artifact = @($manifest['artifacts'])[0]
        if ([string]$manifest['install']['source'] -ne 'package') { throw 'Prepared community Setup does not use a verified package artifact' }
        if ([string]$artifact['sha256'] -notmatch '^[0-9a-f]{64}$') { throw 'Prepared community Setup has no SHA-256 digest' }
        $cachedArtifact = Join-Path $env:DSH_HOME ("setup-cache\artifacts\$($artifact['sha256'])\$($artifact['fileName'])")
        if (-not (Test-Path -LiteralPath $cachedArtifact)) { throw "Prepared Setup artifact was not cached: $cachedArtifact" }
        $trust = [string]$trustMethod.Invoke($null, @($manifest))
        $requestId = 'hub-data-smoke-' + [Guid]::NewGuid().ToString('N')
        $installTask = $installMethod.Invoke($form, @($serializer.Serialize($manifest), $trust, $requestId))
        [void]$installTask.GetAwaiter().GetResult()
        $installMessage = [string]$installTask.GetType().GetProperty('Result').GetValue($installTask, $null)
        $profileManifest = Join-Path $env:DSH_HOME 'profiles\web\package.json'
        if (-not (Test-Path -LiteralPath $profileManifest)) { throw 'One-click Setup did not create the web profile manifest' }
        $profile = Get-Content -LiteralPath $profileManifest -Raw | ConvertFrom-Json
        if ($profile.dependencies.PSObject.Properties.Name -notcontains [string]$installable[0]['npm']) { throw 'One-click Setup did not add the curated npm package to the profile' }

        $task = $searchMethod.Invoke($form, @(''))
        [void]$task.GetAwaiter().GetResult()
        $repositories = $task.GetType().GetProperty('Result').GetValue($task, $null)
        if ($repositories.Count -lt 1) { throw 'GitHub discovery returned no deepseek-harness repositories' }

        $draft = $draftMethod.Invoke($form, @($null, $serializer))
        if (-not (Test-Path -LiteralPath (Join-Path $draft['path'] 'setup.json'))) { throw 'Setup draft manifest was not created' }
        if (-not (Test-Path -LiteralPath (Join-Path $draft['path'] 'options.schema.json'))) { throw 'Setup options schema was not created' }
        if (-not (Test-Path -LiteralPath (Join-Path $draft['path'] 'README-AI.md'))) { throw 'Setup AI editing guide was not created' }

        $updated = $snapshotMethod.Invoke($form, @())
        if ($updated['library'].Count -ne 1) { throw "Expected one Setup draft, got $($updated['library'].Count)" }
        [pscustomobject]@{
            GitHubRepositories = $repositories.Count
            CommunityEntries = $registry['plugins'].Count
            CommunitySource = $registry['sourceMode']
            PreparedSetup = $manifest['id']
            InstallMessage = $installMessage
            LibraryItems = $updated['library'].Count
            LibraryPath = $updated['libraryPath']
            OfflinePath = $updated['offlinePath']
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
    if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
}
