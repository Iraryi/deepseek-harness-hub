param([ValidateSet('DESKTOP', 'HUB', 'CONFIG')][string]$Target = 'HUB', [switch]$PlanOnly)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Overlay.psm1" -Force
try {
    $binding = Read-OverlayJson "$PSScriptRoot\overlay-binding.json"
    if ((Get-OverlayPath $PSScriptRoot) -ine $binding.Paths.InstallRoot) { throw 'Overlay was moved. Reinstall at its bound path.' }
    $plan = Get-OverlayLaunchPlan $binding $Target
    Test-OverlayPayload $binding.Paths.InstallRoot
    if ($PlanOnly) { $plan | ConvertTo-Json -Depth 8; exit 0 }
    Initialize-OverlayState $binding
    $env:DSH_HOME = $binding.Paths.DshHome
    $env:DEEPSEEK_HARNESS_DATA_DIR = $binding.Paths.StateRoot
    $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $binding.AppId
    $env:NODE_OPTIONS = ''
    $arguments = ($plan.Arguments | ForEach-Object { ConvertTo-OverlayArgument $_ }) -join ' '
    Start-Process -FilePath $plan.FilePath -ArgumentList $arguments -WorkingDirectory (Split-Path $plan.FilePath) -WindowStyle Hidden | Out-Null
} catch {
    if ($PlanOnly) { throw }
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'DSH Overlay - launch refused') | Out-Null
    exit 1
}
