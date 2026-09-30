param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module "$PSScriptRoot\..\Overlay.psm1" -Force
$root = Get-OverlayPath (Join-Path $PSScriptRoot ('fixtures\' + [guid]::NewGuid().ToString('N')))
if (-not $root.StartsWith('D:\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Tests must run on D:.' }
$null = New-Item -ItemType Directory -Path $root
$script:checks = 0
function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message" }
    $script:checks++
    Write-Output "PASS: $Message"
}
function Reject([scriptblock]$Action, [string]$Pattern, [string]$Message) {
    $failure = $null
    try { & $Action | Out-Null } catch { $failure = $_.Exception.Message }
    Assert ($null -ne $failure -and $failure -match $Pattern) "$Message [$failure]"
}
function Put([string]$Path, [string]$Text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path $Path))
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}
function Inventory([string]$Path) {
    return ((Get-ChildItem -LiteralPath $Path -Recurse -File | Sort-Object FullName | ForEach-Object { $_.FullName + ':' + (Get-OverlayHash $_.FullName) }) -join "`n")
}
$hostRoot = Join-Path $root 'newer host'
$runtime = Join-Path $root 'legacy runtime'
$dshHome = Join-Path $root 'existing home'
$install = Join-Path $root 'overlay install'
$state = Join-Path $root 'overlay state'
Put "$hostRoot\package.json" '{"name":"fixture-desktop","version":"9.0.0"}'
Put "$runtime\apps\cli\package.json" '{"name":"@deepseek-ai/dsh","version":"0.1.3-alpha.2","bin":{"dsh":"lib/bin.js"}}'
Put "$runtime\apps\cli\lib\bin.js" 'throw new Error("fixture CLI must not execute")'
Put "$dshHome\profiles\web\cordis.yml" 'preserve: exact bytes'
Put "$dshHome\sessions\historical.json" '{"format":"not inspected"}'
Put "$dshHome\attachments\user.txt" 'retain me'
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $compiler /nologo /target:exe "/out:$runtime\node.exe" "$PSScriptRoot\NodeFixture.cs"
if ($LASTEXITCODE -ne 0) { throw 'Fixture compilation failed.' }
$parameters = @{ HostRoot = $hostRoot; RuntimeRoot = $runtime; NodePath = "$runtime\node.exe"; DshHome = $dshHome; StateRoot = $state; InstallRoot = $install }
$before = Inventory $root
$plan = New-OverlayPlan @parameters
Assert ($plan.Action -eq 'install' -and $plan.Runtime.Adapter -eq 'legacy-repo-v1') 'legacy compiled CLI selected'
Assert ($plan.HostEvidence[0].Version -eq '9.0.0') 'newer explicit host inspected without compatibility claim'
Assert ((Inventory $root) -ceq $before) 'planner is read-only'
Assert (-not (Test-Path -LiteralPath $state)) 'planner does not create state'
foreach ($name in @('HostRoot', 'RuntimeRoot', 'DshHome', 'StateRoot')) {
    $invalid = $parameters.Clone(); $invalid.InstallRoot = $parameters[$name]
    Reject { New-OverlayPlan @invalid } 'overlap' "reject install overlap with $name"
}
$invalid = $parameters.Clone(); $invalid.StateRoot = "$dshHome\overlay"
Reject { New-OverlayPlan @invalid } 'overlap' 'reject state inside user home'
$invalid = $parameters.Clone(); $invalid.DshHome = "$root\missing"
Reject { New-OverlayPlan @invalid } 'must already exist' 'reject missing home'
Reject { Get-OverlayPath 'D:\' } 'drive root' 'reject drive root'
Reject { Get-OverlayPath 'relative\dir' } 'absolute' 'reject relative path'
Reject { Get-OverlayPath '\\server\share\dir' } 'absolute' 'reject UNC'
Reject { Get-OverlayPath 'D:\safe\NUL.txt' } 'Ambiguous' 'reject device names'
Reject { Get-OverlayPath 'D:\safe\dir.\child' } 'Ambiguous' 'reject trailing dot aliases'
Put "$install\foreign.txt" 'not ours'
Reject { New-OverlayPlan @parameters } 'unowned' 'refuse foreign nonempty install directory'
$parameters.InstallRoot = "$root\owned install"
$install = $parameters.InstallRoot
$null = [IO.Directory]::CreateDirectory($install)
$plan = New-OverlayPlan @parameters
Write-OverlayNewJson "$install\overlay-binding.json" $plan
Assert ((New-OverlayPlan @parameters).Action -eq 'repair') 'same-version repair retains selection'
Assert ((New-OverlayPlan @parameters -Version '0.2.0').Action -eq 'update') 'higher-version update'
Reject { New-OverlayPlan @parameters -Version '0.0.9' } 'downgrade' 'reject downgrade'
$invalid = $parameters.Clone(); $invalid.StateRoot = "$root\other state"
Reject { New-OverlayPlan @invalid } 'Retain identity' 'refuse silent rebind'
$binding = Read-OverlayJson "$install\overlay-binding.json"
$launch = Get-OverlayLaunchPlan $binding HUB
Assert ($launch.FilePath.EndsWith('dsh-config.exe') -and $launch.Arguments[0] -eq '--hub') 'first launch opens independent HUB CONFIG'
Initialize-OverlayState $binding
$stateBefore = Inventory $state
Initialize-OverlayState $binding
Assert ((Inventory $state) -ceq $stateBefore) 'state initialization is byte-preserving on retain/repair'
Put "$state\config.json" ('{"RepoPath":' + ($runtime | ConvertTo-Json -Compress) + ',"NodePath":' + ("$runtime\node.exe" | ConvertTo-Json -Compress) + ',"FirstRunCompleted":true,"Unknown":{"preserve":1}}')
Assert ((Get-OverlayLaunchPlan $binding HUB).FilePath.EndsWith('dsh-hub.exe')) 'completed onboarding opens HUB'
Assert ((Get-OverlayLaunchPlan $binding DESKTOP).FilePath.EndsWith('dsh.exe')) 'enhanced Desktop has independent launch target'
$stateBefore = Inventory $state
$null = New-OverlayPlan @parameters -Version '0.2.0'
Assert ((Inventory $state) -ceq $stateBefore) 'update planning preserves preferences and unknown fields'
Put "$state\config.json" '{"RepoPath":"D:\\wrong","NodePath":"D:\\wrong.exe","FirstRunCompleted":true}'
Reject { Get-OverlayLaunchPlan $binding HUB } 'differ' 'block fallback to wrong CONFIG runtime'
Put "$state\config.json" 'invalid JSON'
Reject { Initialize-OverlayState $binding } 'JSON|Invalid|primitive' 'invalid state is not reseeded'
Put "$runtime\apps\cli\lib\bin.js" 'changed'
Reject { Get-OverlayLaunchPlan $binding HUB } 'Runtime changed' 'runtime hash drift requires repair'
Put "$runtime\apps\cli\package.json" '{"name":"@deepseek-ai/dsh","version":"99.0.0","bin":{"dsh":"lib/bin.js"}}'
Reject { New-OverlayPlan @parameters } 'Unqualified' 'unknown runtime version fails closed'
Put "$runtime\apps\cli\package.json" '{"name":"@deepseek-ai/dsh","version":"0.1.3-alpha.2","bin":{"dsh":"lib/bin.js"}}'
Put "$runtime\runtime-manifest.json" '{}'
Reject { New-OverlayPlan @parameters } 'resolver is missing' 'packaged marker requires resolver'
Put "$runtime\runtime-resolver.mjs" 'export {}'
$null = New-OverlayPlan @parameters
Assert $true 'complete packaged marker can be inspected'
$packaged = "$root\packaged runtime"
Put "$packaged\node_modules\@deepseek-ai\dsh\package.json" '{"name":"@deepseek-ai/dsh","version":"0.1.3-alpha.2","bin":{"dsh":"lib/bin.js"}}'
Put "$packaged\node_modules\@deepseek-ai\dsh\lib\bin.js" 'export {}'
Assert ((Get-OverlayRuntime $packaged "$runtime\node.exe").Adapter -eq 'packaged-cli-v1') 'packaged CLI layout'
$plain = "$root\plain package"
Put "$plain\package.json" '{"name":"@deepseek-ai/dsh","version":"0.1.3-alpha.2","bin":{"dsh":"lib/bin.js"}}'
Put "$plain\lib\bin.js" 'export {}'
Assert ((Get-OverlayRuntime $plain "$runtime\node.exe").Adapter -eq 'package-cli-v1') 'standalone CLI package layout'
$linked = "$root\linked-state"
$null = New-Item -ItemType Junction -Path $linked -Target $dshHome
$invalid = $parameters.Clone(); $invalid.StateRoot = "$linked\child"
Reject { New-OverlayPlan @invalid } 'Linked' 'junction ancestor cannot redirect writes'
$payload = "$install\payload"
$null = [IO.Directory]::CreateDirectory($payload)
$null = New-Item -ItemType Junction -Path "$payload\linked" -Target $dshHome
Reject { New-OverlayPlan @parameters } 'links' 'nested payload junction rejected without traversal'
$fresh = $parameters.Clone(); $fresh.InstallRoot = "$root\prepare install"; $fresh.StateRoot = "$root\prepare state"
$requestDirectory = "$root\prepare"
$null = [IO.Directory]::CreateDirectory($requestDirectory)
$request = @('[Overlay]') + @($fresh.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }) + @('Version=0.1.0')
[IO.File]::WriteAllLines("$requestDirectory\request.ini", $request, [Text.Encoding]::Unicode)
$baseBefore = (Inventory $hostRoot) + (Inventory $dshHome) + (Inventory $runtime)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\prepare.ps1" -Request "$requestDirectory\request.ini" -OutputDirectory $requestDirectory
Assert ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath "$requestDirectory\overlay-binding.json")) 'real prepare entry point produces owned binding'
Assert (((Inventory $hostRoot) + (Inventory $dshHome) + (Inventory $runtime)) -ceq $baseBefore) 'prepare never modifies base/runtime/home'
$unicodeName = 'Unicode-' + [char]0x4e2d + [char]0x6587 + '=path'
$unicodeHost = Join-Path $root $unicodeName
Put "$unicodeHost\package.json" '{"name":"unicode-host","version":"1.0"}'
$unicodeRequest = $fresh.Clone(); $unicodeRequest.HostRoot = $unicodeHost
$unicodeOutput = Join-Path $root 'unicode-prepare'
$null = [IO.Directory]::CreateDirectory($unicodeOutput)
$lines = @('[Overlay]') + @($unicodeRequest.GetEnumerator() | ForEach-Object { $_.Key + '=' + $_.Value }) + @('Version=0.1.0')
[IO.File]::WriteAllLines("$unicodeOutput\request.ini", $lines, [Text.Encoding]::Unicode)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\prepare.ps1" -Request "$unicodeOutput\request.ini" -OutputDirectory $unicodeOutput
Assert ($LASTEXITCODE -eq 0 -and (Read-OverlayJson "$unicodeOutput\overlay-binding.json").Paths.HostRoot -ceq $unicodeHost) 'Unicode and equals signs survive Setup request format'
$duplicateOutput = Join-Path $root 'duplicate-prepare'
$null = [IO.Directory]::CreateDirectory($duplicateOutput)
[IO.File]::WriteAllLines("$duplicateOutput\request.ini", ($lines + @('HostRoot=D:\other')), [Text.Encoding]::Unicode)
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\prepare.ps1" -Request "$duplicateOutput\request.ini" -OutputDirectory $duplicateOutput
Assert ($LASTEXITCODE -ne 0 -and -not (Test-Path -LiteralPath "$duplicateOutput\overlay-binding.json")) 'duplicate request fields fail before binding creation'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\..\plan.ps1" @fresh | Out-File -LiteralPath "$root\plan-output.json" -Encoding utf8
Assert ($LASTEXITCODE -eq 0) 'standalone plan CLI runs'
$iss = Get-Content "$PSScriptRoot\..\DSHOverlay.iss" -Raw
Assert ($iss -notmatch '\[UninstallDelete\]|\[InstallDelete\]|\[Registry\]|\[Run\]|DelTree|RegWrite|RegDelete') 'no custom deletion, registry mutation or postinstall launch'
Assert ($iss -match 'recursesubdirs createallsubdirs') 'all nested launcher assets are packaged'
Assert ($iss -match 'CloseApplications=no' -and $iss -match 'PrivilegesRequired=lowest') 'no host process termination or elevation'
Assert ($iss -match '6E4AA8A1-93AD-47D7-AD79-75FA9A01DCBE' -and $iss -notmatch 'C6E80677-0378-4C12-99F5-C69665A59B6E') 'independent Overlay AppId'
$payloadFixture = Join-Path $root 'payload-verification'
Put "$payloadFixture\payload\enhancements.js" 'enhancements'
Put "$payloadFixture\payload\mobile\relay.mjs" 'relay'
Put "$payloadFixture\payload\mobile\assets\pair.html" 'pairing'
$files = @{}
foreach ($file in Get-OverlayTree "$payloadFixture\payload") { $files[$file.FullName.Substring("$payloadFixture\payload".Length + 1)] = Get-OverlayHash $file.FullName }
Write-OverlayNewJson "$payloadFixture\payload-manifest.json" @{ Schema = 1; Files = $files }
Test-OverlayPayload $payloadFixture
Assert $true 'recursive payload hashes include enhancements, relay and nested assets'
Put "$payloadFixture\payload\mobile\assets\pair.html" 'corrupt'
Reject { Test-OverlayPayload $payloadFixture } 'payload changed' 'repair required for nested payload corruption'
Write-OverlayNewJson "$root\result.json" @{ Checks = $script:checks; Fixture = $root; InstallerExecuted = $false; RegistryEdited = $false }
Write-Output "$script:checks checks passed. Retained isolated fixture: $root"
