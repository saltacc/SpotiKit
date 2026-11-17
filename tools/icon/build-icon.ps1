param([string]$Out = "$PSScriptRoot\..\..\Assets\SpotiKit.ico", [string]$Png, [int]$PngSize = 1024)
Add-Type -AssemblyName System.Drawing

$accent = [System.Drawing.ColorTranslator]::FromHtml("#4C6FFF")
$bars = @(@(4, 14.5, 4, 9.5), @(8, 17, 8, 7), @(12, 19, 12, 5), @(16, 17, 16, 7), @(20, 14.5, 20, 9.5))

function Draw-Frame([int]$size, [switch]$Png) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = $size * 7 / 24
    $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $tile.AddArc(0, 0, $d, $d, 180, 90)
    $tile.AddArc($size - $d, 0, $d, $d, 270, 90)
    $tile.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $tile.AddArc(0, $size - $d, $d, $d, 90, 90)
    $tile.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $accent), $tile)

    $rim = [Math]::Max(1.0, $size * 0.014)
    $top = New-Object System.Drawing.Region $tile
    $shifted = $tile.Clone(); $shifted.Transform((New-Object System.Drawing.Drawing2D.Matrix 1, 0, 0, 1, 0, $rim))
    $top.Exclude($shifted)
    $g.FillRegion((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(115, 255, 255, 255))), $top)
    $bottom = New-Object System.Drawing.Region $tile
    $raised = $tile.Clone(); $raised.Transform((New-Object System.Drawing.Drawing2D.Matrix 1, 0, 0, 1, 0, -$rim))
    $bottom.Exclude($raised)
    $g.FillRegion((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(36, 255, 255, 255))), $bottom)
    $inset = $rim / 2
    $ring = New-Object System.Drawing.Drawing2D.GraphicsPath
    $ri = $radius - $inset; $di = $ri * 2; $e = $size - $inset
    $ring.AddArc($inset, $inset, $di, $di, 180, 90)
    $ring.AddArc($e - $di, $inset, $di, $di, 270, 90)
    $ring.AddArc($e - $di, $e - $di, $di, $di, 0, 90)
    $ring.AddArc($inset, $e - $di, $di, $di, 90, 90)
    $ring.CloseFigure()
    $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 255, 255, 255)), $rim), $ring)

    $icon = $size * 16 / 24
    $scale = $icon / 24
    $offset = ($size - $icon) / 2
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([Math]::Max(1.2, $size * 2 / 24))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    foreach ($b in $bars) {
        $g.DrawLine($pen, $offset + $b[0] * $scale, $offset + $b[1] * $scale, $offset + $b[2] * $scale, $offset + $b[3] * $scale)
    }
    $g.Dispose()
    $stream = New-Object System.IO.MemoryStream
    if ($size -ge 256 -or $Png) {
        $bmp.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    else {
        $dib = [System.IO.BinaryWriter]::new($stream)
        $dib.Write([UInt32]40); $dib.Write([Int32]$size); $dib.Write([Int32]($size * 2))
        $dib.Write([UInt16]1); $dib.Write([UInt16]32); $dib.Write([UInt32]0)
        $dib.Write([UInt32]($size * $size * 4)); $dib.Write([Int32]0); $dib.Write([Int32]0); $dib.Write([UInt32]0); $dib.Write([UInt32]0)
        for ($y = $size - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $size; $x++) {
                $c = $bmp.GetPixel($x, $y)
                $dib.Write([byte]$c.B); $dib.Write([byte]$c.G); $dib.Write([byte]$c.R); $dib.Write([byte]$c.A)
            }
        }
        $maskRow = [Math]::Ceiling($size / 32) * 4
        $dib.Write((New-Object byte[] ($maskRow * $size)))
        $dib.Flush()
    }
    $bmp.Dispose()
    return , $stream.ToArray()
}

if ($Png) {
    [System.IO.File]::WriteAllBytes($Png, (Draw-Frame $PngSize -Png))
    "wrote $Png ($PngSize px)"
    return
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$frames = $sizes | ForEach-Object { , (Draw-Frame $_) }
$ico = New-Object System.IO.MemoryStream
$w = [System.IO.BinaryWriter]::new($ico)
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $w.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$frames[$i].Length); $w.Write([UInt32]$offset)
    $offset += $frames[$i].Length
}
foreach ($f in $frames) { $w.Write($f) }
$w.Flush()
[System.IO.File]::WriteAllBytes((Resolve-Path (Split-Path $Out) | Join-Path -ChildPath (Split-Path $Out -Leaf)), $ico.ToArray())
"wrote $Out ($($ico.Length) bytes, $($sizes -join ', ') px)"
