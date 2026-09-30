[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$HostRoot,
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [Parameter(Mandatory)][string]$NodePath,
    [Parameter(Mandatory)][string]$DshHome,
    [Parameter(Mandatory)][string]$StateRoot,
    [Parameter(Mandatory)][string]$InstallRoot,
    [string]$Version = '0.1.0'
)
$ErrorActionPreference = 'Stop'
Import-Module "$PSScriptRoot\Overlay.psm1" -Force
New-OverlayPlan @PSBoundParameters | ConvertTo-Json -Depth 16
