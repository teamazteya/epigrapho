# SPDX-License-Identifier: GPL-3.0-or-later
#
# Builds every icon Epigrapho ships from one master PNG.
#
# ponytail: this is PowerShell and System.Drawing, not a Node script with an
# image library. The work is resize and composite, Windows already has both,
# and the alternative was a native dependency that has to build on every
# machine to be run once whenever the logo changes. Run it on Windows; the
# files it writes are committed, so nobody else needs to.
#
#   pwsh scripts/brand-icons.ps1
param(
    [string]$Source = "$PSScriptRoot/../assets/brand/epigrapho-logo.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repo = Resolve-Path "$PSScriptRoot/.."
$master = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source))

# The master has transparent margins around the rounded tile. Everything is
# measured from the tile itself so a new master with different padding still
# lands the same.
$minX = $master.Width; $minY = $master.Height; $maxX = -1; $maxY = -1
for ($y = 0; $y -lt $master.Height; $y++) {
    for ($x = 0; $x -lt $master.Width; $x++) {
        if ($master.GetPixel($x, $y).A -gt 16) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
}
$tileRect = New-Object System.Drawing.Rectangle $minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1)
$tile = $master.Clone($tileRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
Write-Output ("maestro: {0}x{1} · baldosa: {2}x{3}" -f $master.Width, $master.Height, $tile.Width, $tile.Height)

# The tile's own background, read from it rather than written down twice.
$navy = $tile.GetPixel([int]($tile.Width / 2), 12)

<#
.SYNOPSIS
  Draws the tile into a square of `size`, optionally over a solid background
  and shrunk to `scale` of the square (Android's adaptive icons keep their
  artwork inside a safe circle, so the mark cannot reach the edges).
#>
function New-Square {
    param(
        [int]$Size,
        [double]$Scale = 1.0,
        [System.Drawing.Color]$Background = [System.Drawing.Color]::Transparent
    )
    $bitmap = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear($Background)
    $inner = [int][Math]::Round($Size * $Scale)
    if ($inner -gt 0) {
        $offset = [int][Math]::Round(($Size - $inner) / 2)
        $graphics.DrawImage($tile, $offset, $offset, $inner, $inner)
    }
    $graphics.Dispose()
    return $bitmap
}

function Save-Png {
    param([System.Drawing.Bitmap]$Bitmap, [string]$Path)
    $full = Join-Path $repo $Path
    New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
    $Bitmap.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Get-PngBytes {
    param([System.Drawing.Bitmap]$Bitmap)
    $stream = New-Object System.IO.MemoryStream
    $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $stream.Dispose()
    # The comma keeps PowerShell from unrolling the array into the pipeline
    # and handing back an Object[]: BinaryWriter needs a real byte[], and with
    # anything else it quietly writes a single byte.
    return , [byte[]]$bytes
}

<#
.SYNOPSIS
  Writes a Windows .ico whose entries are PNGs — the form Windows has read
  since Vista, and the only one worth writing by hand.
#>
function Save-Ico {
    param([int[]]$Sizes, [string]$Path, [double]$Scale = 1.0)
    $images = @()
    foreach ($size in $Sizes) {
        $bitmap = New-Square -Size $size -Scale $Scale
        $images += , @{ size = $size; bytes = (Get-PngBytes $bitmap) }
        $bitmap.Dispose()
    }
    $full = Join-Path $repo $Path
    New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
    $stream = [System.IO.File]::Create($full)
    $writer = New-Object System.IO.BinaryWriter $stream
    $writer.Write([uint16]0)              # reserved
    $writer.Write([uint16]1)              # type: icon
    $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
        # 256 is written as 0: the field is a single byte.
        $writer.Write([byte]($(if ($image.size -ge 256) { 0 } else { $image.size })))
        $writer.Write([byte]($(if ($image.size -ge 256) { 0 } else { $image.size })))
        $writer.Write([byte]0)            # palette
        $writer.Write([byte]0)            # reserved
        $writer.Write([uint16]1)          # colour planes
        $writer.Write([uint16]32)         # bits per pixel
        $writer.Write([uint32]$image.bytes.Length)
        $writer.Write([uint32]$offset)
        $offset += $image.bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.bytes) }
    $writer.Dispose(); $stream.Dispose()
    Write-Output ("{0}: {1} tamaños" -f $Path, $images.Count)
}

<#
.SYNOPSIS
  Writes a macOS .icns. Each entry is a PNG under the type macOS expects for
  that size, which is all a modern system needs.
#>
function Save-Icns {
    param([string]$Path)
    $types = @(
        @{ type = "icp4"; size = 16 },
        @{ type = "icp5"; size = 32 },
        @{ type = "icp6"; size = 64 },
        @{ type = "ic07"; size = 128 },
        @{ type = "ic08"; size = 256 },
        @{ type = "ic09"; size = 512 },
        @{ type = "ic10"; size = 1024 },
        @{ type = "ic11"; size = 32 },
        @{ type = "ic12"; size = 64 },
        @{ type = "ic13"; size = 256 },
        @{ type = "ic14"; size = 512 }
    )
    $entries = @()
    foreach ($entry in $types) {
        $bitmap = New-Square -Size $entry.size
        $entries += , @{ type = $entry.type; bytes = (Get-PngBytes $bitmap) }
        $bitmap.Dispose()
    }
    $total = 8
    foreach ($entry in $entries) { $total += 8 + $entry.bytes.Length }

    $full = Join-Path $repo $Path
    New-Item -ItemType Directory -Force (Split-Path $full) | Out-Null
    $stream = [System.IO.File]::Create($full)
    $writer = New-Object System.IO.BinaryWriter $stream
    # icns is big-endian throughout, which BinaryWriter is not.
    function Write-BigEndian([System.IO.BinaryWriter]$w, [int]$value) {
        $bytes = [System.BitConverter]::GetBytes([uint32]$value)
        [array]::Reverse($bytes)
        $w.Write($bytes)
    }
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes("icns"))
    Write-BigEndian $writer $total
    foreach ($entry in $entries) {
        $writer.Write([System.Text.Encoding]::ASCII.GetBytes($entry.type))
        Write-BigEndian $writer (8 + $entry.bytes.Length)
        $writer.Write([byte[]]$entry.bytes)
    }
    $writer.Dispose(); $stream.Dispose()
    Write-Output ("{0}: {1} entradas, {2:N0} bytes" -f $Path, $entries.Count, $total)
}

# ---- the desktop app ----
foreach ($size in 16, 24, 32, 48, 64, 128, 256, 512, 1024) {
    $bitmap = New-Square -Size $size
    Save-Png $bitmap "apps/desktop/assets/icons/${size}x${size}.png"
    $bitmap.Dispose()
}
Save-Ico -Sizes 16, 24, 32, 48, 64, 128, 256 -Path "apps/desktop/assets/icons/app.ico"
Save-Icns -Path "apps/desktop/assets/icons/app.icns"
# The tray sits in a 16-24px strip; both themes get the same mark because it
# carries its own background.
Save-Ico -Sizes 16, 24, 32 -Path "apps/desktop/assets/icons/tray-icon.ico"
Save-Ico -Sizes 16, 24, 32 -Path "apps/desktop/assets/icons/tray-icon.dark.ico"

# ---- the web app ----
$favicon = New-Square -Size 512
Save-Png $favicon "apps/web/public/favicon.png"
$favicon.Dispose()
$apple = New-Square -Size 180
Save-Png $apple "apps/web/public/apple-touch-icon.png"
$apple.Dispose()
foreach ($size in 192, 512) {
    $plain = New-Square -Size $size
    Save-Png $plain "apps/web/public/android-chrome-${size}x${size}.png"
    $plain.Dispose()
    # A maskable icon is cropped to whatever shape the system likes, so it
    # fills the square with the brand colour and keeps the mark well inside.
    $maskable = New-Square -Size $size -Scale 0.78 -Background $navy
    Save-Png $maskable "apps/web/public/android-chrome-maskable-${size}x${size}.png"
    $maskable.Dispose()
}

# The favicon as SVG is what browsers prefer; there is no vector master, so it
# carries the raster at a size no tab will out-resolve.
$svgSource = New-Square -Size 512
$svgBytes = Get-PngBytes $svgSource
$svgSource.Dispose()
$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <image width="512" height="512" href="data:image/png;base64,$([Convert]::ToBase64String($svgBytes))"/>
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $repo "apps/web/public/favicon.svg"), $svg)
Write-Output "apps/web/public: favicon, apple-touch-icon, android-chrome y maskables"

# ---- Android ----
# Adaptive icons are two layers: the system masks them together, so the
# background is the brand colour edge to edge and the mark stays in the safe
# circle. The monochrome layer is what themed icons tint.
$densities = @{ "mdpi" = 48; "hdpi" = 72; "xhdpi" = 96; "xxhdpi" = 144; "xxxhdpi" = 192 }
foreach ($density in $densities.Keys) {
    $size = $densities[$density] * 2
    $background = New-Square -Size $size -Scale 0 -Background $navy
    Save-Png $background "apps/mobile/android/app/src/main/res/mipmap-$density/ic_launcher_background.png"
    $background.Dispose()
    $foreground = New-Square -Size $size -Scale 0.62
    Save-Png $foreground "apps/mobile/android/app/src/main/res/mipmap-$density/ic_launcher_foreground.png"
    $foreground.Dispose()
    $monochrome = New-Square -Size $size -Scale 0.62
    Save-Png $monochrome "apps/mobile/android/app/src/main/res/mipmap-$density/ic_launcher_monochrome.png"
    $monochrome.Dispose()
}
Write-Output "apps/mobile/android: ic_launcher en 5 densidades"

# ---- iOS ----
# The asset catalogue names every size it wants and lists them in
# Contents.json; each file is replaced at the size it already is, so the
# catalogue does not have to be touched. iOS icons carry no transparency.
foreach ($set in Get-ChildItem (Join-Path $repo "apps/mobile/ios") -Recurse -Directory -Filter "AppIcon.appiconset") {
    $count = 0
    foreach ($file in Get-ChildItem $set.FullName -Filter "*.png") {
        $existing = [System.Drawing.Bitmap]::FromFile($file.FullName)
        $size = $existing.Width
        $existing.Dispose()
        $bitmap = New-Square -Size $size -Background $navy
        $bitmap.Save($file.FullName, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $count++
    }
    Write-Output ("{0}: {1} archivos" -f $set.FullName.Replace("$repo\\", ""), $count)
}

$tile.Dispose()
$master.Dispose()
Write-Output "listo"
