param(
    [string]$OutputDirectory = "$PSScriptRoot\dist",
    [string]$WebView2Package = ''
)

$ErrorActionPreference = 'Stop'
$webView2Version = '1.0.4129.50'
$launcherRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (-not $output.StartsWith($launcherRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory must stay under $launcherRoot"
}
if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
New-Item -ItemType Directory -Path $output | Out-Null

function New-RoundedRectanglePath([Drawing.RectangleF]$rectangle, [float]$radius) {
    $diameter = $radius * 2
    $path = [Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($rectangle.Left, $rectangle.Top, $diameter, $diameter, 180, 90)
    $path.AddArc($rectangle.Right - $diameter, $rectangle.Top, $diameter, $diameter, 270, 90)
    $path.AddArc($rectangle.Right - $diameter, $rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($rectangle.Left, $rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-HubIcon([string]$path) {
    Add-Type -AssemblyName System.Drawing
    $sizes = @(16, 24, 32, 48, 64, 256)
    $images = [Collections.Generic.List[byte[]]]::new()
    foreach ($size in $sizes) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.Clear([Drawing.Color]::Transparent)
        $rectangle = [Drawing.RectangleF]::new(0.5, 0.5, $size - 1, $size - 1)
        $shape = New-RoundedRectanglePath $rectangle ([Math]::Max(2, $size * 0.2))
        $background = [Drawing.Drawing2D.LinearGradientBrush]::new(
            $rectangle,
            [Drawing.Color]::FromArgb(109, 40, 217),
            [Drawing.Color]::FromArgb(37, 99, 235),
            42)
        $graphics.FillPath($background, $shape)
        $font = [Drawing.Font]::new('Segoe UI', $size * 0.56, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
        $format = [Drawing.StringFormat]::new()
        $format.Alignment = [Drawing.StringAlignment]::Center
        $format.LineAlignment = [Drawing.StringAlignment]::Center
        $labelBounds = [Drawing.RectangleF]::new(0, -$size * 0.045, $size, $size)
        $graphics.DrawString('H', $font, [Drawing.Brushes]::White, $labelBounds, $format)
        $dotSize = [Math]::Max(2, $size * 0.14)
        $dotBrush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(103, 232, 249))
        $graphics.FillEllipse($dotBrush, $size * 0.72, $size * 0.16, $dotSize, $dotSize)
        $stream = [IO.MemoryStream]::new()
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        $images.Add($stream.ToArray())
        $stream.Dispose()
        $dotBrush.Dispose()
        $format.Dispose()
        $font.Dispose()
        $background.Dispose()
        $shape.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }

    $file = [IO.File]::Create($path)
    $writer = [IO.BinaryWriter]::new($file)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$sizes.Count)
    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        $size = $sizes[$index]
        $bytes = $images[$index]
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $bytes.Length
    }
    foreach ($bytes in $images) { $writer.Write($bytes) }
    $writer.Dispose()
    $file.Dispose()
}

function New-ConfigIcon([string]$path) {
    Add-Type -AssemblyName System.Drawing
    $sizes = @(16, 24, 32, 48, 64, 256)
    $images = [Collections.Generic.List[byte[]]]::new()
    foreach ($size in $sizes) {
        $bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.Clear([Drawing.Color]::Transparent)
        $rectangle = [Drawing.RectangleF]::new(0.5, 0.5, $size - 1, $size - 1)
        $shape = New-RoundedRectanglePath $rectangle ([Math]::Max(2, $size * 0.2))
        $background = [Drawing.Drawing2D.LinearGradientBrush]::new(
            $rectangle,
            [Drawing.Color]::FromArgb(109, 40, 217),
            [Drawing.Color]::FromArgb(37, 99, 235),
            42)
        $graphics.FillPath($background, $shape)

        $center = $size / 2.0
        $outerRadius = [Math]::Max(2.5, $size * 0.31)
        $innerRadius = [Math]::Max(1.5, $size * 0.20)
        $points = New-Object 'System.Drawing.PointF[]' 32
        for ($index = 0; $index -lt 32; $index++) {
            $angle = -[Math]::PI / 2 + $index * [Math]::PI / 16
            $radius = if (($index % 4) -lt 2) { $outerRadius } else { $outerRadius * 0.78 }
            $points[$index] = [Drawing.PointF]::new(
                [float]($center + [Math]::Cos($angle) * $radius),
                [float]($center + [Math]::Sin($angle) * $radius))
        }
        $graphics.FillPolygon([Drawing.Brushes]::White, $points)
        $graphics.FillEllipse(
            [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(62, 93, 220)),
            [float]($center - $innerRadius), [float]($center - $innerRadius),
            [float]($innerRadius * 2), [float]($innerRadius * 2))

        $stream = [IO.MemoryStream]::new()
        $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
        $images.Add($stream.ToArray())
        $stream.Dispose()
        $background.Dispose()
        $shape.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }

    $file = [IO.File]::Create($path)
    $writer = [IO.BinaryWriter]::new($file)
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$sizes.Count)
    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
        $size = $sizes[$index]
        $bytes = $images[$index]
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([byte]$(if ($size -eq 256) { 0 } else { $size }))
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $bytes.Length
    }
    foreach ($bytes in $images) { $writer.Write($bytes) }
    $writer.Dispose()
    $file.Dispose()
}

$repository = [IO.Path]::GetFullPath((Join-Path $launcherRoot '..\..'))
$package = Get-Content (Join-Path $repository 'package.json') -Raw | ConvertFrom-Json
$version = [string]$package.version
$numeric = [regex]::Matches($version, '\d+') | ForEach-Object { [int]$_.Value }
while ($numeric.Count -lt 4) { $numeric = @($numeric) + 0 }
$assemblyVersion = '{0}.{1}.{2}.0' -f $numeric[0], $numeric[1], $numeric[2]
$fileVersion = '{0}.{1}.{2}.{3}' -f $numeric[0], $numeric[1], $numeric[2], $numeric[3]
$generatedAssembly = Join-Path $output 'AssemblyVersion.g.cs'
@"
using System.Reflection;
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$fileVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -LiteralPath $generatedAssembly -Encoding UTF8

$cache = Join-Path $launcherRoot 'cache'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($WebView2Package)) {
    $WebView2Package = Join-Path $cache "Microsoft.Web.WebView2.$webView2Version.nupkg"
}
if (-not (Test-Path $WebView2Package)) {
    $url = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$webView2Version"
    try {
        Invoke-WebRequest -Uri $url -OutFile $WebView2Package -UseBasicParsing
    }
    catch {
        throw "WebView2 download failed. Download Microsoft.Web.WebView2 $webView2Version manually and pass -WebView2Package <file.nupkg>. $($_.Exception.Message)"
    }
}

$packageDirectory = Join-Path $cache "Microsoft.Web.WebView2.$webView2Version"
if (-not (Test-Path (Join-Path $packageDirectory 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path $packageDirectory) { Remove-Item -LiteralPath $packageDirectory -Recurse -Force }
    [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($WebView2Package), $packageDirectory)
}

$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) { throw ".NET Framework x64 compiler not found: $compiler" }
$source = Join-Path $launcherRoot 'src'
$webViewLib = Join-Path $packageDirectory 'lib\net462'
$icon = Join-Path $launcherRoot 'assets\dsh.ico'
$hubIcon = Join-Path $output 'dsh-hub.ico'
$configIcon = Join-Path $output 'dsh-config.ico'
New-HubIcon $hubIcon
New-ConfigIcon $configIcon
$commonSources = @(
    (Join-Path $source 'AssemblyInfo.cs'),
    $generatedAssembly,
    (Join-Path $source 'Config.cs')
)
$commonReferences = @(
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Net.Http.dll',
    '/reference:System.Security.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll'
)

& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$icon" "/out:$output\dsh.exe" `
    @commonReferences "/reference:$webViewLib\Microsoft.Web.WebView2.Core.dll" `
    "/reference:$webViewLib\Microsoft.Web.WebView2.WinForms.dll" @commonSources (Join-Path $source 'MainApp.cs')
if ($LASTEXITCODE -ne 0) { throw "dsh.exe compilation failed: $LASTEXITCODE" }

& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$hubIcon" "/out:$output\dsh-hub.exe" `
    @commonReferences "/reference:$webViewLib\Microsoft.Web.WebView2.Core.dll" `
    "/reference:$webViewLib\Microsoft.Web.WebView2.WinForms.dll" @commonSources (Join-Path $source 'MainApp.cs')
if ($LASTEXITCODE -ne 0) { throw "dsh-hub.exe compilation failed: $LASTEXITCODE" }

& $compiler /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$configIcon" "/out:$output\dsh-config.exe" `
    @commonReferences @commonSources (Join-Path $source 'ConfigApp.cs')
if ($LASTEXITCODE -ne 0) { throw "dsh-config.exe compilation failed: $LASTEXITCODE" }

Copy-Item (Join-Path $webViewLib 'Microsoft.Web.WebView2.Core.dll') $output
Copy-Item (Join-Path $webViewLib 'Microsoft.Web.WebView2.WinForms.dll') $output
Copy-Item (Join-Path $packageDirectory 'runtimes\win-x64\native\WebView2Loader.dll') $output
Copy-Item (Join-Path $launcherRoot 'assets\community-registry.json') $output
Copy-Item (Join-Path $launcherRoot 'assets\dshmk-catalog.json') $output
Copy-Item (Join-Path $launcherRoot 'assets\THIRD-PARTY-NOTICES.txt') $output
Remove-Item -LiteralPath $generatedAssembly -Force
Remove-Item -LiteralPath $hubIcon -Force
Remove-Item -LiteralPath $configIcon -Force

$expected = @('dsh.exe', 'dsh-hub.exe', 'dsh-config.exe', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'community-registry.json', 'dshmk-catalog.json', 'THIRD-PARTY-NOTICES.txt')
foreach ($name in $expected) {
    if (-not (Test-Path (Join-Path $output $name))) { throw "Missing launcher output: $name" }
}
Write-Host "Launcher $version built at $output"
