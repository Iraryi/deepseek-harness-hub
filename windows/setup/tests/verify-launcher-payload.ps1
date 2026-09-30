param([Parameter(Mandatory)][string]$LauncherDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($LauncherDirectory)
$setup = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $setup 'DeepSeekHarness.iss') -Raw
$build = Get-Content -LiteralPath (Join-Path $setup 'build.ps1') -Raw
$declarations = @([regex]::Matches($manifest, 'Source: "\{#LauncherDir\}\\([^"*]+)"; DestDir: "([^"]+)"') | ForEach-Object {
    [pscustomobject]@{ Source = $_.Groups[1].Value; Destination = $_.Groups[2].Value }
})
$files = @(Get-ChildItem -LiteralPath $root -File -Recurse)
foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length + 1)
    $matches = @($declarations | Where-Object { $_.Source -eq $relative })
    if ($matches.Count -ne 1) { throw "Expected exactly one Setup declaration: $relative" }
    $parent = Split-Path $relative -Parent
    $destination = if ($parent) { '{app}\' + $parent } else { '{app}' }
    if ($matches[0].Destination -ne $destination) { throw "Wrong destination for $relative" }
    if (-not $build.Contains("'$relative'")) { throw "Missing build preflight requirement: $relative" }
}
foreach ($declaration in $declarations) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $declaration.Source) -PathType Leaf)) { throw "Missing Setup input: $($declaration.Source)" }
}
foreach ($flavor in @('Full', 'Lite')) {
    if (-not (Get-Content -LiteralPath (Join-Path $setup "$flavor.iss") -Raw).Contains('#include "DeepSeekHarness.iss"')) { throw "Unverified $flavor manifest" }
}
"Verified $($files.Count) launcher assets, exact destinations, build requirements and both Setup flavors."
