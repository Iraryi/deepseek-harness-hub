param([Parameter(Mandatory)][string]$Request, [Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Overlay.psm1" -Force
try {
    $values = @{}
    foreach ($line in [IO.File]::ReadAllLines($Request)) {
        if (-not $line.Trim() -or $line -eq '[Overlay]') { continue }
        $pair = $line -split '=', 2
        if ($pair.Count -ne 2 -or $values.ContainsKey($pair[0]) -or $pair[0] -notin @('HostRoot', 'RuntimeRoot', 'DshHome', 'StateRoot', 'InstallRoot', 'NodePath', 'Version')) { throw 'Invalid or duplicate request field.' }
        $values[$pair[0]] = $pair[1]
    }
    if ($values.Count -ne 7) { throw 'All seven explicit request fields are required.' }
    $plan = New-OverlayPlan @values
    Write-OverlayNewJson (Join-Path $OutputDirectory 'overlay-binding.json') $plan
    exit 0
} catch {
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'error.txt'), $_.Exception.Message)
    exit 1
}
