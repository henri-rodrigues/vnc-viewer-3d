// Gera public/icon.ico a partir do logo da empresa (public/logo.png): recorta
// a marca (o "iceberg", acima do texto), centraliza num quadrado e grava os
// tamanhos 16 a 256 dentro do .ico (bitmap até 64 px e PNG no de 256, o padrão
// do Windows). Usa o System.Drawing do Windows.
// Uso: node tools/make-icon.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'public', 'logo.png');
const OUT = path.join(ROOT, 'public', 'icon.ico');
const SIZES = [16, 24, 32, 48, 64, 256];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vnc3d-icon-'));

const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = New-Object Drawing.Bitmap '${LOGO.replace(/'/g, "''")}'
# Primeira faixa de linhas com pixels visíveis = a marca (o texto vem depois de uma linha vazia).
$top = -1; $bottom = -1; $left = $src.Width; $right = -1
for ($y = 0; $y -lt $src.Height; $y++) {
  $any = $false
  for ($x = 0; $x -lt $src.Width; $x++) {
    if ($src.GetPixel($x, $y).A -gt 40) { $any = $true; if ($x -lt $left) { $left = $x }; if ($x -gt $right) { $right = $x } }
  }
  if ($any -and $top -lt 0) { $top = $y }
  if (-not $any -and $top -ge 0) { $bottom = $y - 1; break }
}
if ($top -lt 0) { throw 'Logo vazio' }
if ($bottom -lt 0) { $bottom = $src.Height - 1 }
$w = $right - $left + 1; $h = $bottom - $top + 1
$side = [Math]::Max($w, $h)
foreach ($size in @(${SIZES.join(',')})) {
  $pad = [Math]::Round($size * 0.04)
  $dst = New-Object Drawing.Bitmap $size, $size, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.SmoothingMode = 'HighQuality'
  $scale = ($size - 2 * $pad) / $side
  $dw = $w * $scale; $dh = $h * $scale
  $rect = New-Object Drawing.RectangleF ((($size - $dw) / 2), (($size - $dh) / 2), $dw, $dh)
  $g.DrawImage($src, $rect, (New-Object Drawing.RectangleF $left, $top, $w, $h), 'Pixel')
  $g.Dispose()
  $dst.Save((Join-Path '${TMP.replace(/'/g, "''")}' "$size.png"), [Drawing.Imaging.ImageFormat]::Png)
  # Pixels BGRA (de cima para baixo) para montar o bitmap dos tamanhos pequenos.
  $data = $dst.LockBits((New-Object Drawing.Rectangle 0, 0, $size, $size), 'ReadOnly', ([Drawing.Imaging.PixelFormat]::Format32bppArgb))
  $raw = New-Object byte[] ($size * $size * 4)
  [Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
  $dst.UnlockBits($data)
  [IO.File]::WriteAllBytes((Join-Path '${TMP.replace(/'/g, "''")}' "$size.raw"), $raw)
  $dst.Dispose()
}
$src.Dispose()
"marca: x=$left y=$top ${'$'}{w}x${'$'}{h}"
`;

try {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  console.log(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { windowsHide: true }).toString().trim());

  // Bitmap de ícone: BITMAPINFOHEADER (altura dobrada), pixels de baixo para cima e máscara AND.
  const dib = (size) => {
    const raw = fs.readFileSync(path.join(TMP, `${size}.raw`));
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const rows = [];
    for (let y = size - 1; y >= 0; y--) rows.push(raw.subarray(y * size * 4, (y + 1) * size * 4));
    const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
    return Buffer.concat([header, ...rows, mask]);
  };
  const images = SIZES.map((s) => (s >= 256 ? fs.readFileSync(path.join(TMP, `${s}.png`)) : dib(s)));
  const dir = Buffer.alloc(6 + 16 * SIZES.length);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(SIZES.length, 4);
  let offset = dir.length;
  SIZES.forEach((s, i) => {
    const e = 6 + i * 16;
    dir[e] = s === 256 ? 0 : s;
    dir[e + 1] = s === 256 ? 0 : s;
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(images[i].length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  fs.writeFileSync(OUT, Buffer.concat([dir, ...images]));
  console.log('Gerado', OUT);
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
