param(
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,
    [int]$Runs = 3
)

$ErrorActionPreference = 'Stop'
$app = [IO.Path]::GetFullPath($AppDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$launcherPath = Join-Path $app 'dsh.exe'
$nodePath = Join-Path $app 'runtime\tools\node\node.exe'
if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Launcher is missing: $launcherPath" }
if (-not (Test-Path -LiteralPath $nodePath)) { throw "Bundled Node is missing: $nodePath" }

function Get-InstalledProcesses {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($app + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-InstalledProcesses {
    foreach ($process in (Get-InstalledProcesses)) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

$previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
try {
    Stop-InstalledProcesses
    for ($run = 1; $run -le $Runs; $run++) {
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'process-job-smoke-' + [Guid]::NewGuid().ToString('N')
        $launcher = Start-Process -FilePath $launcherPath -WorkingDirectory $app -PassThru -WindowStyle Minimized
        $node = $null
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            Start-Sleep -Milliseconds 500
            $node = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -eq 'node.exe' -and $_.ExecutablePath -and
                $_.ExecutablePath.Equals($nodePath, [StringComparison]::OrdinalIgnoreCase)
            } | Select-Object -First 1
            if ($node) { break }
            $launcher.Refresh()
            if ($launcher.HasExited) { break }
        }
        if (-not $node) { throw "Run $run did not start the bundled Node process" }

        Stop-Process -Id $launcher.Id -Force
        $launcher.WaitForExit()
        Start-Sleep -Seconds 2
        $remaining = @(Get-InstalledProcesses)
        if ($remaining.Count -gt 0) {
            $details = $remaining | ForEach-Object { "$($_.Name):$($_.ProcessId) parent=$($_.ParentProcessId)" }
            throw "Run $run left installed processes after forced launcher termination: $($details -join ', ')"
        }
    }

    [pscustomobject]@{
        AppDirectory = $app
        Runs = $Runs
        ForcedLauncherTerminationLeavesNoNode = $true
    }
}
finally {
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    Stop-InstalledProcesses
}
