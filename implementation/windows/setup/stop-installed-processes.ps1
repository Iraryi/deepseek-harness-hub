param(
    [Parameter(Mandatory = $true)]
    [string]$AppDirectory,
    [int]$TimeoutSeconds = 20
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($AppDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
$prefix = $root + [IO.Path]::DirectorySeparatorChar

function Get-ProcessSnapshot {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
}

function Get-ProtectedProcessIds {
    param([object[]]$Processes)

    $byId = @{}
    foreach ($process in $Processes) { $byId[[int]$process.ProcessId] = $process }
    $protected = [Collections.Generic.HashSet[int]]::new()
    $next = [int]$PID
    while ($next -gt 0 -and $protected.Add($next)) {
        $process = $byId[$next]
        if (-not $process) { break }
        $next = [int]$process.ParentProcessId
    }
    return $protected
}

function Get-InstalledProcessIds {
    param(
        [object[]]$Processes,
        [Collections.Generic.HashSet[int]]$ProtectedIds
    )

    $owned = [Collections.Generic.HashSet[int]]::new()
    foreach ($process in $Processes) {
        if ($ProtectedIds.Contains([int]$process.ProcessId) -or [string]::IsNullOrWhiteSpace($process.ExecutablePath)) { continue }
        if ($process.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            $owned.Add([int]$process.ProcessId) | Out-Null
        }
    }

    do {
        $added = $false
        foreach ($process in $Processes) {
            if ($ProtectedIds.Contains([int]$process.ProcessId) -or $owned.Contains([int]$process.ProcessId)) { continue }
            if ($owned.Contains([int]$process.ParentProcessId)) {
                $owned.Add([int]$process.ProcessId) | Out-Null
                $added = $true
            }
        }
    } while ($added)

    @($owned)
}

$deadline = (Get-Date).AddSeconds([Math]::Max(1, $TimeoutSeconds))
do {
    $processes = Get-ProcessSnapshot
    $protectedIds = Get-ProtectedProcessIds $processes
    $ownedIds = @(Get-InstalledProcessIds $processes $protectedIds)
    if ($ownedIds.Count -eq 0) { exit 0 }

    $ownedSet = [Collections.Generic.HashSet[int]]::new()
    foreach ($ownedId in $ownedIds) { $ownedSet.Add($ownedId) | Out-Null }
    $roots = @($processes | Where-Object {
        $ownedSet.Contains([int]$_.ProcessId) -and -not $ownedSet.Contains([int]$_.ParentProcessId)
    })
    foreach ($process in $roots) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $process.ProcessId /T /F 2>$null | Out-Null
    }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

$processes = Get-ProcessSnapshot
$remaining = @(Get-InstalledProcessIds $processes (Get-ProtectedProcessIds $processes))
if ($remaining.Count -gt 0) {
    throw "Processes from '$root' are still running: $($remaining -join ', ')"
}
