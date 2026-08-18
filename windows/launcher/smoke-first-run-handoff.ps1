param(
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory
)

$ErrorActionPreference = 'Stop'
$sourceApp = [IO.Path]::GetFullPath($AppDirectory)
$root = [IO.Path]::GetFullPath($PSScriptRoot)
$testRoot = Join-Path $root ('handoff-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$testApp = Join-Path $testRoot 'app'
$dataRoot = Join-Path $testApp 'data'
$configPath = Join-Path $dataRoot 'config.json'
$harnessSource = Join-Path $root 'tests\FirstRunHandoffHarness.cs'
$harnessPath = Join-Path $testRoot 'FirstRunHandoffHarness.exe'
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

function Stop-TestProcesses {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($testApp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    } | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F 2>$null | Out-Null }
}

New-Item -ItemType Directory -Path $testApp -Force | Out-Null
Copy-Item -Path (Join-Path $sourceApp '*') -Destination $testApp -Recurse -Force
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
New-Item -ItemType File -Path (Join-Path $testApp 'portable.mode') -Force | Out-Null
$config = '{"ResolutionWidth":1024,"ResolutionHeight":768,"Language":"zh-CN","FirstRunCompleted":false,"LaunchMode":"window","Url":"http://127.0.0.1:3080","Port":3080,"NodePath":"","RepoPath":"","ToolbarAutoHide":true,"ToolbarEdgeReveal":false,"ToolbarHotkey":"F8","FullscreenHotkey":"F11","LoadingStyle":"minimal","CloseAction":"exit","ShowTrayButton":true,"FullscreenShowToolbar":false,"FullscreenShowTaskbar":false,"EnableExtensions":false,"Extensions":[],"InjectCss":"","InjectJs":"","DevTools":false,"ExternalLinksInBrowser":true}'
[IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

& $compiler /nologo /target:exe /platform:x64 /optimize+ /out:$harnessPath `
    /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll $harnessSource
if ($LASTEXITCODE -ne 0) { throw "First-run handoff harness compilation failed: $LASTEXITCODE" }

$desktop = $null
try {
    $harness = Start-Process -FilePath $harnessPath -ArgumentList ('"' + $testApp + '"') -WorkingDirectory $testApp -PassThru -Wait
    if ($harness.ExitCode -ne 0) { throw "First-run handoff harness failed with exit code $($harness.ExitCode)" }
    $desktop = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Name -eq 'dsh.exe' -and $_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $testApp 'dsh.exe'), [StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -First 1
    if (-not $desktop) { throw 'Detached Desktop did not survive outer Job shutdown' }
    $logPath = Join-Path $dataRoot 'logs\app.log'
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $logPath)) { Start-Sleep -Milliseconds 100 }
    $logText = if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Raw } else { '' }
    if ($logText -match 'Start failed:.*(拒绝访问|Access is denied)') { throw "Detached Desktop hit access denied`n$logText" }
    [pscustomobject]@{
        SaveAndRunDesktopDetached = $true
        DesktopSurvivedOuterJob = $true
        AccessDeniedStartup = $false
        Log = $logPath
    }
}
finally {
    Stop-TestProcesses
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
