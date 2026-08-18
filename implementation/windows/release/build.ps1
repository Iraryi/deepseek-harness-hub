param(
    [string]$OutputDirectory = "$PSScriptRoot\dist",
    [string]$ReleaseBaseUrl = 'https://github.com/Iraryi/deepseek-harness-hub/releases',
    [string]$InnoCompiler = '',
    [switch]$SkipProductBuild,
    [switch]$SkipSmoke
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$releaseRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$repository = [IO.Path]::GetFullPath((Join-Path $releaseRoot '..\..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must stay under $releaseRoot"
}

$launcherRoot = Join-Path $repository 'windows\launcher'
$launcherDist = Join-Path $launcherRoot 'dist'
$runtimeRoot = Join-Path $repository 'windows\runtime'
$runtimeDist = Join-Path $runtimeRoot 'dist\runtime'
$runtimeArchive = Join-Path $runtimeRoot 'dist\DeepSeek-Harness-Runtime-win-x64.zip'
$setupRoot = Join-Path $repository 'windows\setup'
$setupDist = Join-Path $setupRoot 'dist'
$setupCache = Join-Path $setupRoot 'cache'
$package = Get-Content (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$tag = "v$version"

function Invoke-Checked([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

function Test-MicrosoftBinary([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -eq 0) { return $false }
    $signature = Get-AuthenticodeSignature -FilePath $Path
    return $signature.Status -eq 'Valid' -and
        $signature.SignerCertificate.Subject.Contains('Microsoft Corporation')
}

function Get-MicrosoftBinary([string]$Url, [string]$Destination) {
    $parent = Split-Path $Destination -Parent
    $partial = "$Destination.partial"
    New-Item -ItemType Directory -Path $parent -Force | Out-Null

    if (Test-MicrosoftBinary $Destination) { return }
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
    if (Test-MicrosoftBinary $partial) {
        Move-Item -LiteralPath $partial -Destination $Destination -Force
        return
    }

    $failures = [Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }

    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        try {
            & $curl.Source '--fail' '--location' '--show-error' '--progress-bar' `
                '--retry' '5' '--retry-all-errors' '--retry-delay' '2' `
                '--connect-timeout' '30' '--speed-limit' '1024' '--speed-time' '90' `
                '--continue-at' '-' '--output' $partial $Url
            if ($LASTEXITCODE -ne 0) { throw "curl.exe exited with code $LASTEXITCODE" }
            if (-not (Test-MicrosoftBinary $partial)) { throw 'curl.exe produced an invalid or unsigned file' }
        }
        catch {
            $failures.Add("curl.exe: $($_.Exception.Message)")
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        }
    }

    if (-not (Test-MicrosoftBinary $partial)) {
        $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
        if ($bits) {
            try {
                Start-BitsTransfer -Source $Url -Destination $partial -ErrorAction Stop
                if (-not (Test-MicrosoftBinary $partial)) { throw 'BITS produced an invalid or unsigned file' }
            }
            catch {
                $failures.Add("BITS: $($_.Exception.Message)")
                if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
            }
        }
    }

    if (-not (Test-MicrosoftBinary $partial)) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $partial -UseBasicParsing -TimeoutSec 900
            if (-not (Test-MicrosoftBinary $partial)) { throw 'Invoke-WebRequest produced an invalid or unsigned file' }
        }
        catch {
            $failures.Add("Invoke-WebRequest: $($_.Exception.Message)")
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        }
    }

    if (-not (Test-MicrosoftBinary $partial)) {
        $detail = if ($failures.Count -gt 0) { $failures -join '; ' } else { 'No supported downloader was available.' }
        throw "Microsoft download failed. Download $Url to $Destination and rerun the build. $detail"
    }

    Move-Item -LiteralPath $partial -Destination $Destination -Force
}

function Invoke-WindowModeGeometrySmoke {
    Add-Type -AssemblyName System.Windows.Forms
    if (-not ('DshReleaseWindowProbe' -as [type])) {
        Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshReleaseWindowProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out Rect rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr handle, int index);
    public const int GwlStyle = -16;
    public const int GwlExStyle = -20;
    public const int WsCaption = 0x00C00000;
    public const int WsExTopmost = 0x00000008;
}
'@
    }

    function Get-ReleaseWindowSnapshot([Diagnostics.Process]$Process) {
        $Process.Refresh()
        $handle = $Process.MainWindowHandle
        if ($handle -eq 0 -or -not [DshReleaseWindowProbe]::IsWindowVisible($handle)) { return $null }
        $rect = New-Object DshReleaseWindowProbe+Rect
        if (-not [DshReleaseWindowProbe]::GetWindowRect($handle, [ref]$rect)) { return $null }
        $style = [DshReleaseWindowProbe]::GetWindowLong($handle, [DshReleaseWindowProbe]::GwlStyle)
        $extendedStyle = [DshReleaseWindowProbe]::GetWindowLong($handle, [DshReleaseWindowProbe]::GwlExStyle)
        return [pscustomobject]@{
            Handle = $handle.ToInt64()
            Left = $rect.Left
            Top = $rect.Top
            Width = $rect.Right - $rect.Left
            Height = $rect.Bottom - $rect.Top
            Caption = (($style -band [DshReleaseWindowProbe]::WsCaption) -ne 0)
            Topmost = (($extendedStyle -band [DshReleaseWindowProbe]::WsExTopmost) -ne 0)
        }
    }

    $node = Join-Path $runtimeDist 'tools\node\node.exe'
    $previousScope = $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE
    try {
        foreach ($mode in @('window', 'bordered', 'borderless', 'exclusive')) {
            $work = Join-Path ([IO.Path]::GetTempPath()) ('dsh-release-window-' + $mode + '-' + [Guid]::NewGuid().ToString('N'))
            $data = Join-Path $work 'data'
            $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
            $app = $null
            try {
                $listener.Start()
                $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
                New-Item -ItemType Directory -Path (Join-Path $work 'lib'), $data -Force | Out-Null
                foreach ($name in @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll')) {
                    Copy-Item (Join-Path $launcherDist $name) $work
                }
                New-Item -ItemType File -Path (Join-Path $work 'portable.mode') | Out-Null
                @'
const http=require('node:http');const port=Number(process.argv[process.argv.indexOf('--port')+1]);const server=http.createServer((request,response)=>{const url=new URL(request.url,`http://127.0.0.1:${port}`);if(url.pathname!=='/'){response.writeHead(404);response.end();return};const bootId=JSON.stringify(url.searchParams.get('desktopBoot')||'');response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(`<!doctype html><title>Window mode release smoke</title><script>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId:${bootId},state:'loading',retryable:false,failures:[]});setTimeout(()=>chrome.webview.postMessage({type:'dsh-web-boot-status',bootId:${bootId},state:'ready',retryable:false,failures:[]}),180)</script>`)});server.listen(port,'127.0.0.1',()=>console.log(`dsh web: http://127.0.0.1:${port}`));const close=()=>server.close(()=>process.exit(0));process.on('SIGINT',close);process.on('SIGTERM',close)
'@ | Set-Content (Join-Path $work 'lib\bin.js') -Encoding UTF8
                [ordered]@{
                    ResolutionWidth = 1024; ResolutionHeight = 768; Language = 'en-US'; FirstRunCompleted = $true
                    LaunchMode = $mode; Url = "http://127.0.0.1:$port"; Port = $port; NodePath = $node; RepoPath = $work
                    ToolbarAutoHide = $true; ToolbarEdgeReveal = $false; ToolbarHotkey = 'F8'; FullscreenHotkey = 'F11'
                    LoadingStyle = 'whales'; CloseAction = 'exit'; ShowTrayButton = $false
                    FullscreenShowToolbar = $false; FullscreenShowTaskbar = $false; EnableExtensions = $false
                    Extensions = @(); InjectCss = ''; InjectJs = ''; DevTools = $false; ExternalLinksInBrowser = $true
                } | ConvertTo-Json -Compress | Set-Content (Join-Path $data 'config.json') -Encoding UTF8
                $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = 'RELEASE-WINDOW-' + [Guid]::NewGuid().ToString('N')
                $app = Start-Process (Join-Path $work 'dsh.exe') -WorkingDirectory $work -PassThru
                $first = $null
                $samples = [Collections.Generic.List[object]]::new()
                $revealed = $false
                $booted = $false
                $deadline = (Get-Date).AddSeconds(35)
                while ((Get-Date) -lt $deadline) {
                    if ($app.HasExited) { throw "$mode launcher exited with code $($app.ExitCode)" }
                    $logPath = Join-Path $data 'logs\app.log'
                    $log = if (Test-Path $logPath) { Get-Content $logPath -Raw } else { '' }
                    if (-not $revealed -and $log -match 'Initial window frame revealed') { $revealed = $true }
                    $snapshot = if ($revealed) { Get-ReleaseWindowSnapshot $app } else { $null }
                    if ($snapshot) {
                        if ($null -eq $first) { $first = $snapshot }
                        $samples.Add($snapshot)
                    }
                    if (-not $booted -and $log -match 'Web UI boot verified by structured ready status') { $booted = $true }
                    if ($booted -and $samples.Count -gt 30) { break }
                    Start-Sleep -Milliseconds 25
                }
                if ($null -eq $first) { throw "$mode did not reveal a first frame" }
                if (-not $booted) { throw "$mode did not reach WebView readiness" }
                $screen = [Windows.Forms.Screen]::FromHandle([IntPtr]$first.Handle)
                if ($mode -eq 'window' -and (-not $first.Caption -or $first.Topmost -or $first.Width -gt $screen.WorkingArea.Width -or $first.Height -gt $screen.WorkingArea.Height)) { throw "$mode geometry failed" }
                if ($mode -eq 'bordered' -and (-not $first.Caption -or -not $first.Topmost -or $first.Width -lt ($screen.Bounds.Width - 4) -or $first.Height -lt ($screen.Bounds.Height - 4))) { throw "$mode geometry failed" }
                if ($mode -eq 'borderless' -and ($first.Caption -or $first.Topmost -or $first.Left -ne $screen.Bounds.Left -or $first.Top -ne $screen.Bounds.Top -or $first.Width -ne $screen.Bounds.Width -or $first.Height -ne $screen.Bounds.Height)) { throw "$mode geometry failed" }
                if ($mode -eq 'exclusive' -and ($first.Caption -or -not $first.Topmost -or $first.Left -ne $screen.Bounds.Left -or $first.Top -ne $screen.Bounds.Top -or $first.Width -ne $screen.Bounds.Width -or $first.Height -ne $screen.Bounds.Height)) { throw "$mode geometry failed" }
                foreach ($sample in $samples) {
                    if ($sample.Left -ne $first.Left -or $sample.Top -ne $first.Top -or $sample.Width -ne $first.Width -or $sample.Height -ne $first.Height) { throw "$mode changed bounds during startup" }
                }
                Write-Host ("Window mode {0}: {1},{2} {3}x{4}; {5} samples stable" -f $mode, $first.Left, $first.Top, $first.Width, $first.Height, $samples.Count)
            }
            finally {
                $listener.Stop()
                if ($app -and -not $app.HasExited) {
                    & taskkill.exe /PID $app.Id /T /F 2>$null | Out-Null
                    try { $app.WaitForExit(5000) | Out-Null } catch { }
                }
                Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                    $_.Name -eq 'node.exe' -and $_.CommandLine -like ('*' + $work + '*')
                } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
                for ($attempt = 0; $attempt -lt 20 -and (Test-Path $work); $attempt++) {
                    try { Remove-Item $work -Recurse -Force -ErrorAction Stop } catch { Start-Sleep -Milliseconds 250 }
                }
            }
        }
    }
    finally {
        $env:DEEPSEEK_HARNESS_INSTANCE_SCOPE = $previousScope
    }
}

if (-not $SkipProductBuild) {
    Invoke-Checked 'powershell.exe' @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'build.ps1')
    ) $repository
    Invoke-Checked 'node.exe' @((Join-Path $runtimeRoot 'build.mjs')) $repository
}

$requiredLauncherFiles = @(
    'dsh.exe',
    'dsh-hub.exe',
    'dsh-config.exe',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
    'WebView2Loader.dll',
    'community-registry.json',
    'dshmk-catalog.json',
    'THIRD-PARTY-NOTICES.txt'
)
foreach ($name in $requiredLauncherFiles) {
    if (-not (Test-Path (Join-Path $launcherDist $name))) { throw "Launcher output is missing: $name" }
}
if (-not (Test-Path $runtimeDist)) { throw "Runtime directory is missing: $runtimeDist" }
if (-not (Test-Path $runtimeArchive)) { throw "Runtime archive is missing: $runtimeArchive" }

if (-not $SkipSmoke) {
    Invoke-WindowModeGeometrySmoke
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'smoke-first-run-handoff.ps1'),
      '-AppDirectory', $launcherDist
    ) $repository
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'smoke-service-gate.ps1'),
      '-LauncherDirectory', $launcherDist
    ) $repository
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'smoke-service-gate.ps1'),
      '-LauncherDirectory', $launcherDist,
      '-LauncherName', 'dsh-hub.exe',
      '-ExpectedSurface', 'hub'
    ) $repository
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'smoke-service-gate.ps1'),
      '-LauncherDirectory', $launcherDist,
      '-ExpectServiceRecovery'
    ) $repository
    Invoke-Checked 'powershell.exe' @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $launcherRoot 'smoke-dshmk-install.ps1'),
      '-LauncherDirectory', $launcherDist
    ) $repository
}

Get-MicrosoftBinary 'https://go.microsoft.com/fwlink/?linkid=2124701' `
    (Join-Path $setupCache 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
Get-MicrosoftBinary 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' `
    (Join-Path $setupCache 'MicrosoftEdgeWebview2Setup.exe')

$setupArguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $setupRoot 'build.ps1'),
    '-ReleaseBaseUrl', $ReleaseBaseUrl
)
if (-not [string]::IsNullOrWhiteSpace($InnoCompiler)) {
    $setupArguments += @('-InnoCompiler', $InnoCompiler)
}
Invoke-Checked 'powershell.exe' $setupArguments $repository

if (-not $SkipSmoke) {
    Invoke-Checked 'powershell.exe' @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $setupRoot 'smoke.ps1')
    ) $repository
}

if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null

$fullName = "DeepSeek-Harness-Setup-Full-$version-win-x64.exe"
$liteName = "DeepSeek-Harness-Setup-Lite-$version-win-x64.exe"
$runtimeName = "DeepSeek-Harness-Runtime-$version-win-x64.zip"
$portableName = "DeepSeek-Harness-Portable-$version-win-x64.zip"
Copy-Item (Join-Path $setupDist $fullName) (Join-Path $output $fullName)
Copy-Item (Join-Path $setupDist $liteName) (Join-Path $output $liteName)
Copy-Item $runtimeArchive (Join-Path $output $runtimeName)
Copy-Item (Join-Path $releaseRoot 'download.ps1') (Join-Path $output 'Install-DeepSeek-Harness.ps1')
Copy-Item (Join-Path $releaseRoot 'release-notes.txt') (Join-Path $output 'RELEASE_NOTES.md')

$portableStage = Join-Path $releaseRoot ('.portable-stage-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
try {
    New-Item -ItemType Directory -Path $portableStage | Out-Null
    foreach ($name in $requiredLauncherFiles) {
        Copy-Item (Join-Path $launcherDist $name) $portableStage
    }
    $portableRuntime = Join-Path $portableStage 'runtime'
    New-Item -ItemType Directory -Path $portableRuntime | Out-Null
    Get-ChildItem -LiteralPath $runtimeDist -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $portableRuntime -Recurse -Force
    }
    New-Item -ItemType File -Path (Join-Path $portableStage 'portable.mode') | Out-Null
    Copy-Item (Join-Path $releaseRoot 'PORTABLE-README.txt') $portableStage
    Invoke-Checked 'tar.exe' @('-a', '-c', '-f', (Join-Path $output $portableName), '-C', $portableStage, '.') $repository
}
finally {
    if (Test-Path $portableStage) { Remove-Item -LiteralPath $portableStage -Recurse -Force }
}

$assetFiles = @(Get-ChildItem -LiteralPath $output -File | Sort-Object Name)
$assets = @($assetFiles | ForEach-Object {
    [ordered]@{
        name = $_.Name
        bytes = $_.Length
        sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$manifestPath = Join-Path $output 'release-manifest.json'
[ordered]@{
    schemaVersion = 1
    product = 'DeepSeek Harness Desktop Distribution'
    repository = 'Iraryi/deepseek-harness-hub'
    version = $version
    tag = $tag
    platform = 'win-x64'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    assets = $assets
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$checksumFiles = @(Get-ChildItem -LiteralPath $output -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } | Sort-Object Name)
$checksumLines = @($checksumFiles | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name
})
$checksumLines | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding ASCII

if (-not $SkipSmoke) {
    Invoke-Checked 'powershell.exe' @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $releaseRoot 'smoke.ps1'),
        '-ReleaseDirectory', $output
    ) $repository
}

[pscustomobject]@{
    Version = $version
    Tag = $tag
    Output = $output
    Assets = @(Get-ChildItem -LiteralPath $output -File | Select-Object Name, Length)
}
