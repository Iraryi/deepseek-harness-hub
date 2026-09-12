param(
    [Parameter(Mandatory = $true)][string]$AppDirectory,
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory,
    [ValidateSet('dsh.exe', 'dsh-hub.exe')][string]$LauncherName = 'dsh.exe',
    [ValidateSet('zh-CN', 'en-US')][string]$Language = 'zh-CN',
    [ValidateSet('whales', 'progress', 'off')][string]$LoadingStyle = 'whales',
    [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
$app = [IO.Path]::GetFullPath($AppDirectory)
$data = Join-Path ([IO.Path]::GetFullPath($EvidenceDirectory)) ('fresh-user-' + [Guid]::NewGuid().ToString('N'))
$runtime = Join-Path $app 'runtime'
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'runtime-manifest.json'))) { throw 'An extracted packaged Runtime is required' }
New-Item -ItemType Directory -Path $data | Out-Null
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
try { $listener.Start(); $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port }
finally { $listener.Stop() }
$config = @{
    ResolutionWidth = 1024; ResolutionHeight = 768; Language = $Language; FirstRunCompleted = $true
    LaunchMode = 'window'; Url = "http://127.0.0.1:$port"; Port = $port; NodePath = ''; RepoPath = ''
    LoadingStyle = $LoadingStyle; CloseAction = 'exit'; ToolbarAutoHide = $true; ToolbarEdgeReveal = $false
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $data 'config.json'), ($config | ConvertTo-Json), $utf8)
[IO.File]::WriteAllText((Join-Path $data 'hub-config.json'), (@{ LoadingStyle = $LoadingStyle; CloseAction = 'exit'; Theme = 'light' } | ConvertTo-Json), $utf8)
$logPath = Join-Path $data 'logs\app.log'
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = Join-Path $app $LauncherName
$start.WorkingDirectory = $app
$start.Arguments = '--dsh-data-dir "' + $data + '" --dsh-home "' + (Join-Path $data 'dsh') + '" --dsh-instance-scope ' + [Guid]::NewGuid().ToString('N')
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$start.EnvironmentVariables['PATH'] = Join-Path $env:SystemRoot 'System32'
foreach ($name in @($start.EnvironmentVariables.Keys)) {
    if ($name -match 'KEY|TOKEN|SECRET|PASSWORD|^NODE_OPTIONS$|^NODE_PATH$|^DSH_|^DEEPSEEK_HARNESS_') { $start.EnvironmentVariables.Remove($name) }
}
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
$verified = $false
try {
    $null = $process.Start()
    Write-Output "Packaged startup: PID=$($process.Id) data=$data"
    $deadline = (Get-Date).AddSeconds(100)
    do {
        Start-Sleep -Milliseconds 400
        $log = if (Test-Path -LiteralPath $logPath) { [IO.File]::ReadAllText($logPath) } else { '' }
        if ($log -match 'Server process exited, code|Page load failed:|Web UI boot failed:') { throw "Packaged startup failed; inspect $logPath" }
        if ($log -match 'Web UI boot verified by structured ready status') {
            Start-Sleep -Seconds 15
            $log = [IO.File]::ReadAllText($logPath)
            if ($process.HasExited -or $log -match 'opening the default browser|Web UI boot failed:|Page load failed:|startup timed out') { throw 'Application did not remain healthy after readiness' }
            $verified = $true
            break
        }
    } while ((Get-Date) -lt $deadline)
    if (-not $verified) { throw "Packaged startup timed out; inspect $logPath" }
    $result = @{ Launcher = $LauncherName; Language = $Language; StructuredReady = $true; StableSeconds = 15; Evidence = $data; ProcessId = $process.Id }
    [IO.File]::WriteAllText((Join-Path $data 'result.json'), ($result | ConvertTo-Json), $utf8)
    $result | ConvertTo-Json -Compress
} finally {
    if (-not $KeepOpen -or -not $verified) {
        if (-not $process.HasExited) {
            $null = $process.CloseMainWindow()
            if (-not $process.WaitForExit(15000)) { $process.Kill(); $process.WaitForExit() }
        }
    }
    $process.Dispose()
}
