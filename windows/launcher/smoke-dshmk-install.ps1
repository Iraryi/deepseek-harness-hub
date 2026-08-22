param(
    [string]$LauncherDirectory = "$PSScriptRoot\dist",
    [string]$RuntimeDirectory = '',
    [switch]$Extended
)

if ($PSVersionTable.PSEdition -eq 'Core') {
    $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-LauncherDirectory', $LauncherDirectory)
    if (-not [string]::IsNullOrWhiteSpace($RuntimeDirectory)) { $arguments += @('-RuntimeDirectory', $RuntimeDirectory) }
    if ($Extended) { $arguments += '-Extended' }
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
        $staticFlags = [Reflection.BindingFlags]'NonPublic,Static'
        $modeMethod = $formType.GetMethod('DshmkInstallMode', $staticFlags)
        $validateMethod = $formType.GetMethod('ValidateDshmkInstallCandidate', $staticFlags)
        $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $syntheticRepository = $serializer.DeserializeObject('{"fullName":"example/unpinned","validation":{"sourceSha":""},"install":{"status":"recognized","candidate":{"source":"github","executable":true,"args":["plugin","--profile","web","add","github:example/unpinned"]}}}')
        $syntheticCandidate = $syntheticRepository['install']['candidate']
        if ([string]$modeMethod.Invoke($null, @($syntheticRepository)) -ne 'one-click-unpinned') { throw 'Unpinned GitHub candidate was not classified as one-click-unpinned' }
        $blocked = $false
        try { [void]$validateMethod.Invoke($null, @($syntheticRepository, $syntheticCandidate, $false)) }
        catch { $blocked = $true }
        if (-not $blocked) { throw 'Unpinned GitHub candidate bypassed the explicit confirmation gate' }
        $validated = $validateMethod.Invoke($null, @($syntheticRepository, $syntheticCandidate, $true))
        if ([string]$validated[4] -ne 'github:example/unpinned') { throw 'Confirmed unpinned GitHub candidate changed its declared repository target' }
        $installMethod = $formType.GetMethod('InstallDshmkSetupAsync', $flags)
        $requestId = 'dshmk-install-smoke-' + [Guid]::NewGuid().ToString('N')
        $installTask = $installMethod.Invoke($form, @($requestId, 1326893710, $false))
        [void]$installTask.GetAwaiter().GetResult()
        $result = $installTask.GetType().GetProperty('Result').GetValue($installTask, $null)
        if ([string]$result['status'] -ne 'activated') { throw "Unexpected activation status: $($result['status'])" }
        if (@($result['packageNames']) -notcontains 'dsh-better-sidebar') { throw 'DSH-better-sidebar was not reported as installed' }
        if (@($result['activeBundles']) -notcontains 'dsh-better-sidebar') { throw 'DSH-better-sidebar was not activated as a Bundle' }

        $retryRequestId = 'dshmk-install-retry-' + [Guid]::NewGuid().ToString('N')
        $retryTask = $installMethod.Invoke($form, @($retryRequestId, [int]1326893710, $false))
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
        $installed = [object[]]$serializer.DeserializeObject((Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8))
        if ($installed.Count -ne 1) { throw "Repeated installation created duplicate HUB records: $($installed.Count)" }

        $webClientRequestId = 'dshmk-web-client-install-' + [Guid]::NewGuid().ToString('N')
        $webClientTask = $installMethod.Invoke($form, @($webClientRequestId, [int]1334289841, $true))
        [void]$webClientTask.GetAwaiter().GetResult()
        $webClientResult = $webClientTask.GetType().GetProperty('Result').GetValue($webClientTask, $null)
        $webClientPackage = '@agent-hub/dsh-workspace-file-upload'
        if ([string]$webClientResult['status'] -ne 'activated') { throw "Unexpected Web client activation status: $($webClientResult['status'])" }
        if (@($webClientResult['packageNames']) -notcontains $webClientPackage) { throw 'The real file-upload package was not attributed to its GitHub repository' }
        if (@($webClientResult['activeBundles']) -notcontains $webClientPackage) { throw 'The real file-upload package was not activated through Web client compatibility' }

        $webClientRetryRequestId = 'dshmk-web-client-retry-' + [Guid]::NewGuid().ToString('N')
        $webClientRetryTask = $installMethod.Invoke($form, @($webClientRetryRequestId, [int]1334289841, $true))
        [void]$webClientRetryTask.GetAwaiter().GetResult()
        $webClientRetryResult = $webClientRetryTask.GetType().GetProperty('Result').GetValue($webClientRetryTask, $null)
        if ([string]$webClientRetryResult['status'] -ne 'activated') { throw "Unexpected Web client retry status: $($webClientRetryResult['status'])" }
        if (@($webClientRetryResult['packageNames']) -notcontains $webClientPackage) { throw 'Repeated file-upload installation lost repository attribution' }

        $profile = Get-Content -LiteralPath $profilePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($profile.dependencies.PSObject.Properties.Name -notcontains $webClientPackage) { throw 'Web profile has no real file-upload dependency' }
        $profilePatchPath = Join-Path $env:DSH_HOME 'profiles\web\cordis.patch.yml'
        $profilePatch = Get-Content -LiteralPath $profilePatchPath -Raw -Encoding UTF8
        if ($profilePatch -notmatch [regex]::Escape('name: "' + $webClientPackage + '"')) { throw 'Web profile has no file-upload compatibility row' }
        if ([regex]::Matches($profilePatch, 'dsh-hub: generated web-client compatibility:start').Count -ne 1) { throw 'Repeated installation duplicated the Web client compatibility block' }

        $installed = [object[]]$serializer.DeserializeObject((Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8))
        if ($installed.Count -ne 2) { throw "Real Web client installation did not create exactly one additional HUB record: $($installed.Count)" }
        if (@($installed | Where-Object { @($_.packageNames) -contains $webClientPackage }).Count -ne 1) { throw 'Repeated file-upload installation created a duplicate or missing HUB record' }

        $extendedResults = @()
        if ($Extended) {
            $matrix = @(
                @{ Name = 'dsh-ads'; Id = 1329113397; AllowUnpinned = $false },
                @{ Name = 'dsh-visualize'; Id = 1333132287; AllowUnpinned = $false },
                @{ Name = 'dsh-noema'; Id = 1334167430; AllowUnpinned = $false },
                @{ Name = 'dsh-dafeiyu'; Id = 1333755311; AllowUnpinned = $false },
                @{ Name = 'dsh-undo-plugin'; Id = 1333816810; AllowUnpinned = $false },
                @{ Name = 'dsh-reasoning-effort'; Id = 1334442247; AllowUnpinned = $false },
                @{ Name = 'dsh-cost-meter'; Id = 1333235870; AllowUnpinned = $false },
                @{ Name = 'dsh-automation'; Id = 1333150357; AllowUnpinned = $false }
            )
            $expectedRecordCount = 2
            foreach ($case in $matrix) {
                $caseRequestId = 'dshmk-matrix-' + $case.Name + '-' + [Guid]::NewGuid().ToString('N')
                $caseTask = $installMethod.Invoke($form, @($caseRequestId, [int]$case.Id, [bool]$case.AllowUnpinned))
                [void]$caseTask.GetAwaiter().GetResult()
                $caseResult = $caseTask.GetType().GetProperty('Result').GetValue($caseTask, $null)
                if ([string]$caseResult['status'] -ne 'activated') { throw "$($case.Name) returned unexpected activation status: $($caseResult['status'])" }
                $casePackages = @($caseResult['packageNames'] | ForEach-Object { [string]$_ })
                $caseActive = @($caseResult['activeBundles'] | ForEach-Object { [string]$_ })
                if ($casePackages.Count -eq 0) { throw "$($case.Name) reported no installed package" }
                foreach ($packageName in $casePackages) {
                    if ($caseActive -notcontains $packageName) { throw "$($case.Name) did not activate installed package $packageName" }
                }

                $caseRetryRequestId = 'dshmk-matrix-retry-' + $case.Name + '-' + [Guid]::NewGuid().ToString('N')
                $caseRetryTask = $installMethod.Invoke($form, @($caseRetryRequestId, [int]$case.Id, [bool]$case.AllowUnpinned))
                [void]$caseRetryTask.GetAwaiter().GetResult()
                $caseRetryResult = $caseRetryTask.GetType().GetProperty('Result').GetValue($caseRetryTask, $null)
                if ([string]$caseRetryResult['status'] -ne 'activated') { throw "$($case.Name) retry returned unexpected activation status: $($caseRetryResult['status'])" }
                $caseRetryPackages = @($caseRetryResult['packageNames'] | ForEach-Object { [string]$_ })
                if (@(Compare-Object $casePackages $caseRetryPackages).Count -ne 0) { throw "$($case.Name) retry resolved a different package set" }

                $expectedRecordCount++
                $installed = [object[]]$serializer.DeserializeObject((Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8))
                if ($installed.Count -ne $expectedRecordCount) { throw "$($case.Name) produced an unexpected HUB record count: $($installed.Count), expected $expectedRecordCount" }
                if (@($installed | Where-Object { [string]$_.id -eq ('dshmk-' + $case.Id) }).Count -ne 1) { throw "$($case.Name) produced a duplicate or missing HUB record" }
                $extendedResults += [pscustomobject]@{
                    Name = $case.Name
                    Status = $caseResult['status']
                    RetryStatus = $caseRetryResult['status']
                    Packages = $casePackages -join ', '
                }
            }

            $staleCandidateRequestId = 'dshmk-matrix-stale-npm-' + [Guid]::NewGuid().ToString('N')
            $staleCandidateFailed = $false
            try {
                $staleCandidateTask = $installMethod.Invoke($form, @($staleCandidateRequestId, [int]1334953413, $false))
                [void]$staleCandidateTask.GetAwaiter().GetResult()
            }
            catch {
                $staleCandidateFailure = $_.Exception
                while ($null -ne $staleCandidateFailure.InnerException) { $staleCandidateFailure = $staleCandidateFailure.InnerException }
                if ($staleCandidateFailure.Message -notmatch 'HTTP 404|not return metadata|versioned package artifact') {
                    throw "The stale DSHMK npm candidate failed with an unexpected error: $($staleCandidateFailure.Message)"
                }
                $staleCandidateFailed = $true
            }
            if (-not $staleCandidateFailed) { throw 'The stale DSHMK npm candidate unexpectedly installed.' }
            $installed = [object[]]$serializer.DeserializeObject((Get-Content -LiteralPath $installedPath -Raw -Encoding UTF8))
            if (@($installed | Where-Object { [string]$_.id -eq 'dshmk-1334953413' }).Count -ne 0) {
                throw 'The stale DSHMK npm candidate left an installed HUB record after failure.'
            }
            $extendedResults += [pscustomobject]@{
                Name = 'dsh-mobile-adaptive'
                Status = 'expected-catalog-failure'
                RetryStatus = 'not-run'
                Packages = ''
            }
        }

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
            WebClientPackage = $webClientPackage
            WebClientRetryStatus = $webClientRetryResult['status']
            Extended = $Extended.IsPresent
            ExtendedResults = $extendedResults
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
