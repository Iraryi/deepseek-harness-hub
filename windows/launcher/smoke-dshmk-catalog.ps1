param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -LauncherDirectory $LauncherDirectory
    if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell DSHMK catalog smoke failed: $LASTEXITCODE" }
    return
}

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$data = Join-Path ([IO.Path]::GetTempPath()) ('dshmk-catalog-smoke-' + [Guid]::NewGuid().ToString('N'))
$previousData = $env:DEEPSEEK_HARNESS_DATA_DIR
$previousOffline = $env:DEEPSEEK_HARNESS_OFFLINE
$resolve = $null
$form = $null

try {
    $env:DEEPSEEK_HARNESS_DATA_DIR = $data
    $env:DEEPSEEK_HARNESS_OFFLINE = '1'
    $staleCache = Join-Path $data 'hub\dshmk-catalog.json'
    New-Item -ItemType Directory -Path (Split-Path $staleCache -Parent) -Force | Out-Null
    @{
        schemaVersion = 1
        generatedAt = '2026-08-14T00:00:00Z'
        repositories = @(@{ repositoryId = 1; url = 'https://github.com/example/stale-catalog'; install = @{ candidate = @{} } })
    } | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $staleCache -Encoding UTF8
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
    $constructor = $formType.GetConstructor([Reflection.BindingFlags]'Public,Instance', $null, @($configType, [bool]), $null)
    $form = $constructor.Invoke(@($config, $true))
    [Threading.SynchronizationContext]::SetSynchronizationContext($null)

    $payload = [Collections.Generic.Dictionary[string, object]]::new()
    $payload['page'] = 1
    $payload['pageSize'] = 24
    $payload['category'] = 'all'
    $payload['projectType'] = 'all'
    $payload['validation'] = 'all'
    $payload['sort'] = 'recommended'
    $payload['query'] = ''
    $method = $formType.GetMethod('QueryDshmkCatalogAsync', [Reflection.BindingFlags]'NonPublic,Instance')
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $task = $method.Invoke($form, @($payload))
    [void]$task.GetAwaiter().GetResult()
    $page = $task.GetType().GetProperty('Result').GetValue($task, $null)
    $stopwatch.Stop()

    if ([string]$page['sourceMode'] -ne 'bundled') { throw "Expected the newer bundled source to outrank the stale cache, got $($page['sourceMode'])" }
    if ([int]$page['pageSize'] -ne 24 -or $page['items'].Count -ne 24) { throw 'Bundled DSHMK page did not preserve the requested 24-item page size' }
    if ([int]$page['total'] -lt 1000) { throw "Bundled DSHMK snapshot is unexpectedly small: $($page['total'])" }
    if ($stopwatch.Elapsed.TotalSeconds -gt 5) { throw "Bundled DSHMK load was too slow: $($stopwatch.Elapsed.TotalSeconds)s" }

    [pscustomobject]@{
        SourceMode = $page['sourceMode']
        Total = $page['total']
        PageItems = $page['items'].Count
        ElapsedMilliseconds = $stopwatch.ElapsedMilliseconds
    }
}
finally {
    if ($form) { $form.Dispose() }
    if ($resolve) { [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolve) }
    $env:DEEPSEEK_HARNESS_DATA_DIR = $previousData
    $env:DEEPSEEK_HARNESS_OFFLINE = $previousOffline
    if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
}
