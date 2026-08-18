param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist"
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -File $PSCommandPath -LauncherDirectory $LauncherDirectory
    if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell manual Setup import smoke failed: $LASTEXITCODE" }
    return
}

$ErrorActionPreference = 'Stop'
$launcher = [IO.Path]::GetFullPath($LauncherDirectory)
$data = Join-Path ([IO.Path]::GetTempPath()) ('dsh-manual-import-smoke-' + [Guid]::NewGuid().ToString('N'))
$previousHome = $env:DSH_HOME
$resolve = $null

try {
    $env:DSH_HOME = Join-Path $data 'dsh-home'
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    $resolve = [ResolveEventHandler] {
        param($sender, $eventArgs)
        $name = ([Reflection.AssemblyName]$eventArgs.Name).Name + '.dll'
        $candidate = Join-Path $launcher $name
        if (Test-Path -LiteralPath $candidate) { return [Reflection.Assembly]::LoadFrom($candidate) }
        return $null
    }
    [AppDomain]::CurrentDomain.add_AssemblyResolve($resolve)
    $assembly = [Reflection.Assembly]::LoadFrom((Join-Path $launcher 'dsh-hub.exe'))
    $formType = $assembly.GetType('MainForm', $true)
    $method = $formType.GetMethod('ImportManualArtifact', [Reflection.BindingFlags]'NonPublic,Static')
    if ($null -eq $method) { throw 'ImportManualArtifact was not found' }

    $archive = Join-Path $data 'fixture.tgz'
    $payload = [Text.Encoding]::UTF8.GetBytes('manual setup import smoke')
    $output = [IO.File]::Create($archive)
    try {
        $gzip = [IO.Compression.GzipStream]::new($output, [IO.Compression.CompressionMode]::Compress, $true)
        try { $gzip.Write($payload, 0, $payload.Length) }
        finally { $gzip.Dispose() }
    }
    finally { $output.Dispose() }

    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($archive)
        try { $digest = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
        finally { $stream.Dispose() }
    }
    finally { $sha.Dispose() }

    [object[]]$importArguments = @(
        [string]$archive,
        [string]'https://codeload.github.com/example/plugin/tar.gz/0000000000000000000000000000000000000000',
        [string]'fixture.tgz',
        [string]'archive',
        [string]$digest,
        [int64](Get-Item -LiteralPath $archive).Length
    )
    $result = $method.Invoke($null, $importArguments)
    $resultType = $result.GetType()
    $cached = Join-Path $env:DSH_HOME ('setup-cache\artifacts\' + $digest + '\fixture.tgz')
    if (-not (Test-Path -LiteralPath $cached)) { throw "Manual import did not populate the Setup cache: $cached" }
    if ([string]$resultType.GetField('Sha256').GetValue($result) -ne $digest) { throw 'Manual import returned the wrong digest' }

    $hashRejected = $false
    try {
        [object[]]$badHashArguments = @([string]$archive, [string]'https://example.com/fixture.tgz', [string]'fixture.tgz', [string]'archive', [string]('0' * 64), [int64]0)
        [void]$method.Invoke($null, $badHashArguments)
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.InnerException) { $message += ' ' + $_.Exception.InnerException.Message }
        $hashRejected = $message -match 'SHA-256'
    }
    if (-not $hashRejected) { throw 'Manual import accepted a mismatched SHA-256 declaration' }

    $invalid = Join-Path $data 'invalid.tgz'
    [IO.File]::WriteAllText($invalid, 'not gzip')
    $formatRejected = $false
    try {
        [object[]]$badFormatArguments = @([string]$invalid, [string]'https://example.com/invalid.tgz', [string]'invalid.tgz', [string]'archive', [string]'', [int64]0)
        [void]$method.Invoke($null, $badFormatArguments)
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.InnerException) { $message += ' ' + $_.Exception.InnerException.Message }
        $formatRejected = $message -match 'gzip'
    }
    if (-not $formatRejected) { throw 'Manual import accepted an invalid gzip archive' }

    $configType = $assembly.GetType('AppConfig', $true)
    $config = [Activator]::CreateInstance($configType, $true)
    $configType.GetProperty('FirstRunCompleted').SetValue($config, $true, $null)
    $configType.GetProperty('LoadingStyle').SetValue($config, 'off', $null)
    $constructor = $formType.GetConstructor([Reflection.BindingFlags]'Public,Instance', $null, @($configType, [bool], [bool]), $null)
    $form = $constructor.Invoke(@($config, $true, $true))
    try {
        [Threading.SynchronizationContext]::SetSynchronizationContext($null)
        $cacheMethod = $formType.GetMethod('CacheCommunityArtifactAsync', [Reflection.BindingFlags]'NonPublic,Instance')
        [object[]]$cacheArguments = @(
            [string]('manual-race-' + [Guid]::NewGuid().ToString('D')),
            [bool]$true,
            [string]'https://github.com/example/plugin',
            [string]'archive',
            [string]'https://codeload.github.com/example/plugin/tar.gz/0000000000000000000000000000000000000000',
            [string]'fixture.tgz',
            [string]'',
            [int64]0,
            $null
        )
        $cacheTask = $cacheMethod.Invoke($form, $cacheArguments)
        $sessionField = $formType.GetField('_activeManualDownload', [Reflection.BindingFlags]'NonPublic,Instance')
        $session = $sessionField.GetValue($form)
        if ($null -eq $session) { throw 'Manual download session was not published before the online request' }
        $importedSource = $method.Invoke($null, $importArguments)
        $completion = $session.GetType().GetField('Imported').GetValue($session)
        if (-not $completion.TrySetResult($importedSource)) { throw 'Manual artifact could not win the active download race' }
        $raceResult = $cacheTask.GetAwaiter().GetResult()
        if (-not [bool]$raceResult.GetType().GetField('Manual').GetValue($raceResult)) { throw 'The download race did not return the manual artifact' }
        if ($null -ne $sessionField.GetValue($form)) { throw 'Manual download session was not cleared after import' }
    }
    finally {
        $form.Dispose()
    }

    [pscustomobject]@{
        CachePath = $cached
        Bytes = (Get-Item -LiteralPath $cached).Length
        Sha256 = $digest
        HashMismatchRejected = $hashRejected
        InvalidArchiveRejected = $formatRejected
        ManualRaceWon = $true
    }
}
finally {
    if ($resolve) { [AppDomain]::CurrentDomain.remove_AssemblyResolve($resolve) }
    $env:DSH_HOME = $previousHome
    if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
}
