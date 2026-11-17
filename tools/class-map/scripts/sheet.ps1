param([string]$Cap, [string]$List, [string]$Out, [int]$Cols = 4, [int]$CellW = 480, [int]$CellH = 300)
Add-Type -AssemblyName System.Drawing
$info = Get-Content (Join-Path $Cap "info.json") -Raw | ConvertFrom-Json
$items = Get-Content $List | Where-Object { $_ -match '^(#\d+)\s+(\S+)' } | ForEach-Object { $p = $_ -split '\s+'; [pscustomobject]@{ Id = $p[0]; Hash = $p[1] } }
$rows = [Math]::Ceiling($items.Count / $Cols)
$sheet = New-Object Drawing.Bitmap ($Cols * $CellW), ($rows * ($CellH + 22))
$g = [Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.Color]::FromArgb(40, 40, 40))
$g.InterpolationMode = 'HighQualityBicubic'
$font = New-Object Drawing.Font 'Segoe UI', 11, ([Drawing.FontStyle]::Bold)
$pen = New-Object Drawing.Pen ([Drawing.Color]::FromArgb(255, 45, 85)), 3
$frames = @{}
$i = 0
foreach ($it in $items) {
  $d = $info.($it.Hash)
  $cx = ($i % $Cols) * $CellW; $cy = [Math]::Floor($i / $Cols) * ($CellH + 22)
  $g.DrawString($it.Id, $font, [Drawing.Brushes]::White, $cx + 4, $cy + 2)
  if ($d -and $d.frame) {
    if (-not $frames.ContainsKey($d.frame)) { $frames[$d.frame] = [Drawing.Bitmap]::FromFile((Join-Path $Cap ($d.frame + '.jpg'))) }
    $f = $frames[$d.frame]; $s = [double]$d.dpr
    $x = $d.rect.x * $s; $y = $d.rect.y * $s; $w = [Math]::Max(2, $d.rect.w * $s); $h = [Math]::Max(2, $d.rect.h * $s)
    $pad = [Math]::Max(40, [Math]::Min($w, $h) * 0.35)
    $sx = [Math]::Max(0, $x - $pad); $sy = [Math]::Max(0, $y - $pad)
    $sw = [Math]::Min($f.Width - $sx, $w + 2 * $pad); $sh = [Math]::Min($f.Height - $sy, $h + 2 * $pad)
    $scale = [Math]::Min(($CellW - 4) / $sw, $CellH / $sh)
    $dw = $sw * $scale; $dh = $sh * $scale
    $dx = $cx + ($CellW - $dw) / 2; $dy = $cy + 22 + ($CellH - $dh) / 2
    $g.DrawImage($f, (New-Object Drawing.RectangleF $dx, $dy, $dw, $dh), (New-Object Drawing.RectangleF $sx, $sy, $sw, $sh), [Drawing.GraphicsUnit]::Pixel)
    $g.DrawRectangle($pen, [float]($dx + ($x - $sx) * $scale), [float]($dy + ($y - $sy) * $scale), [float][Math]::Max(3, $w * $scale), [float][Math]::Max(3, $h * $scale))
  }
  $i++
}
$sheet.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
foreach ($f in $frames.Values) { $f.Dispose() }
$g.Dispose(); $sheet.Dispose()
"sheet: $($items.Count) items -> $Out"
