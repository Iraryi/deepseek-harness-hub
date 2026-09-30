param([Parameter(Mandatory=$true)][string]$LauncherDirectory, [Parameter(Mandatory=$true)][string]$RuntimeArchive)
$ErrorActionPreference = 'Stop'
$launcher = (Resolve-Path -LiteralPath $LauncherDirectory).Path
$root = Join-Path $launcher ('warm-fixture-' + [Guid]::NewGuid().ToString('N'))
if (-not $root.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'D: fixture required' }
$data = Join-Path $root 'data'
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Path $data,$runtime | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $RuntimeArchive).Path, $runtime)
@{ FirstRunCompleted=$true; RepoPath=$runtime; NodePath=(Join-Path $runtime 'tools/node/node.exe'); Language='en-US'; LaunchMode='window'; ResolutionWidth=1024; ResolutionHeight=768; CloseAction='exit'; LoadingStyle='off' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'config.json') -Encoding UTF8
@{ CloseAction='exit'; PreloadOnDesktopStart=$false; StartPage='home' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'hub-config.json') -Encoding UTF8
$scope = 'preload-' + [Guid]::NewGuid().ToString('N')
$arguments = '--dsh-data-dir "' + $data + '" --dsh-home "' + (Join-Path $root 'home') + '" --dsh-instance-scope ' + $scope
$previousOffline = $env:DEEPSEEK_HARNESS_OFFLINE
$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$portListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$portListener.Start()
$debugPort = $portListener.LocalEndpoint.Port
$portListener.Stop()
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $debugPort
$env:DEEPSEEK_HARNESS_OFFLINE = '1'
$process = $null
try {
    $process = Start-Process -FilePath (Join-Path $launcher 'dsh-hub.exe') -ArgumentList ($arguments + ' --hub-preload=' + $PID) -PassThru -WindowStyle Hidden
    $started = Get-Date
    Start-Sleep -Seconds 3
    if ($process.HasExited) { throw 'Preload exited early' }
    $duplicate = Start-Process -FilePath (Join-Path $launcher 'dsh-hub.exe') -ArgumentList ($arguments + ' --hub-preload=' + $PID) -PassThru -WindowStyle Hidden
    if (-not $duplicate.WaitForExit(5000)) { throw 'Duplicate preload did not exit' }
    $duplicate.Dispose()
    Start-Sleep -Seconds 62
    $logFile = Join-Path $data 'logs/app.log'
    $log = Get-Content -LiteralPath $logFile -Raw
    if ($process.HasExited) { throw "Preload retired rather than becoming ready. Inspect $logFile" }
    if ($log -notmatch 'HUB preloaded; renderer suspended') { throw "Renderer was not suspended. Inspect $logFile" }
    if ($log -match 'claimed by user') { throw 'Duplicate preload activated the existing HUB' }
    $wakeTime = Get-Date
    $wake = Start-Process -FilePath (Join-Path $launcher 'dsh-hub.exe') -ArgumentList ($arguments + ' --activate-silent') -PassThru -WindowStyle Hidden
    if (-not $wake.WaitForExit(5000)) { throw 'Activation helper did not exit' }
    $wake.Dispose()
    Start-Sleep -Seconds 3
    $log = Get-Content -LiteralPath $logFile -Raw
    if ($log -notmatch 'Preloaded HUB claimed by user') { throw 'Existing HUB did not resume' }
    if ([regex]::Matches($log, 'Starting server \(').Count -ne 1) { throw 'Wake restarted the local service' }
    & node (Join-Path $PSScriptRoot 'verify-preloaded-page.mjs') $debugPort $root
    if ($LASTEXITCODE -ne 0) { throw 'Resumed WebView did not pass DOM verification' }
    $process.Refresh()
    if ($process.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Resumed HUB has no visible main window' }
    if (-not $process.CloseMainWindow()) { throw 'Unable to request graceful fixture exit' }
    if (-not $process.WaitForExit(20000)) { throw 'Fixture did not exit gracefully' }
    [pscustomobject]@{ Fixture=$root; WarmSeconds=((Get-Date)-$started).TotalSeconds; WakeObservationSeconds=((Get-Date)-$wakeTime).TotalSeconds; Suspended=$true; DuplicateIgnored=$true; Resumed=$true; GracefulExit=$true } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $root 'result.json')
} finally {
    $env:DEEPSEEK_HARNESS_OFFLINE = $previousOffline
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    if ($process -and -not $process.HasExited) { $process.CloseMainWindow() | Out-Null; if (-not $process.WaitForExit(10000)) { $process.Kill(); $process.WaitForExit() } }
    if ($process) { $process.Dispose() }
}
