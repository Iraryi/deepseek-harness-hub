$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if (-not $root.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Native mobile fixtures must run on D:.' }
$output = Join-Path $PSScriptRoot '.output'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$harness = Join-Path $output 'MobileConnectionHarness.exe'
& $compiler /nologo /target:exe /reference:System.Web.Extensions.dll "/out:$harness" (Join-Path $root 'windows\launcher\src\MobileConnection.cs') (Join-Path $PSScriptRoot 'MobileConnectionHarness.cs')
if ($LASTEXITCODE -ne 0) { throw 'Mobile controller fixture compilation failed.' }
& node (Join-Path $PSScriptRoot 'native-smoke.mjs') $harness
if ($LASTEXITCODE -ne 0) { throw 'Mobile native controller smoke failed.' }
