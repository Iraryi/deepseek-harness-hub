param([string]$Harness)

$ErrorActionPreference = 'Stop'
$harnessPath = (Resolve-Path -LiteralPath $Harness).Path
$root = Join-Path (Split-Path $harnessPath -Parent) ('npm-inventory-' + [Guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $root) { throw 'Fixture directory already exists' }
$profile = Join-Path $root 'home\profiles\web'
$package = Join-Path $root 'local-plugin'
New-Item -ItemType Directory -Path $profile, $package | Out-Null
[IO.File]::WriteAllText((Join-Path $profile 'package.json'), '{"name":"isolated-profile","private":true,"dependencies":{}}')
[IO.File]::WriteAllText((Join-Path $package 'package.json'), '{"name":"inventory-local-plugin","version":"1.2.3","dsh":{"client":{"platform":"web"}}}')
$config = Join-Path $root 'empty.npmrc'
[IO.File]::WriteAllText($config, '')
$arguments = @('--prefix', $profile, '--cache', (Join-Path $root 'cache'), '--userconfig', $config, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false')
for ($iteration = 1; $iteration -le 3; $iteration++) {
    & npm.cmd install @arguments $package
    if ($LASTEXITCODE -ne 0) { throw "Local npm install failed: $LASTEXITCODE" }
    $json = & $harnessPath --scan (Join-Path $root 'home')
    if ($LASTEXITCODE -ne 0) { throw 'Inventory scan failed' }
    $items = @($json | ConvertFrom-Json)
    if ($items.Count -ne 1 -or $items[0].name -ne 'inventory-local-plugin' -or $items[0].inventoryState -ne 'present' -or $items[0].version -ne '1.2.3') {
        throw "Externally installed package not discovered: $json"
    }
    & npm.cmd uninstall @arguments inventory-local-plugin
    if ($LASTEXITCODE -ne 0) { throw "Local npm uninstall failed: $LASTEXITCODE" }
    $json = & $harnessPath --scan (Join-Path $root 'home')
    if ($LASTEXITCODE -ne 0 -or @($json | ConvertFrom-Json).Count -ne 0) { throw "External removal did not reconcile: $json" }
}
Write-Output 'PASS: three real offline npm install / inventory / uninstall / inventory cycles; no HUB receipts'
Write-Output "Evidence: $root"
