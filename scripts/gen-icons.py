#!/usr/bin/env python3
"""Generate all Tauri icon sizes from blade-icon.svg"""
import cairosvg
import struct
import zlib
from pathlib import Path

ICONS_DIR = Path(__file__).parent.parent / "src-tauri" / "icons"
SVG_PATH = ICONS_DIR / "blade-icon.svg"
svg_data = SVG_PATH.read_bytes()

def render_png(size: int) -> bytes:
    return cairosvg.svg2png(bytestring=svg_data, output_width=size, output_height=size)

def write_png(path: Path, size: int):
    data = render_png(size)
    path.write_bytes(data)
    print(f"  {path.name} ({size}x{size})")

print("Rendering icons...")

# Standard PNG sizes
write_png(ICONS_DIR / "32x32.png",      32)
write_png(ICONS_DIR / "64x64.png",      64)
write_png(ICONS_DIR / "128x128.png",    128)
write_png(ICONS_DIR / "128x128@2x.png", 256)
write_png(ICONS_DIR / "icon.png",       512)

# macOS .icns source (high-res PNG, Tauri bundles this)
write_png(ICONS_DIR / "icon.png",       512)

# Windows Store / UWP tiles
for fname, size in [
    ("Square30x30Logo.png",   30),
    ("Square44x44Logo.png",   44),
    ("Square71x71Logo.png",   71),
    ("Square89x89Logo.png",   89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png",         50),
]:
    write_png(ICONS_DIR / fname, size)

# Generate .ico (multi-size: 16, 32, 48, 256)
# ICO format: concatenate multiple PNGs with an index header
ico_sizes = [16, 32, 48, 256]
ico_images = [render_png(s) for s in ico_sizes]

def build_ico(images, sizes):
    n = len(images)
    # Header: 6 bytes
    header = struct.pack('<HHH', 0, 1, n)
    # Directory entries: 16 bytes each
    offset = 6 + n * 16
    directory = b''
    for i, (img, size) in enumerate(zip(images, sizes)):
        w = h = size if size < 256 else 0  # 0 means 256
        directory += struct.pack('<BBBBHHII',
            w, h,     # width, height (0 = 256)
            0, 0,     # color count, reserved
            1, 32,    # planes, bit count
            len(img), # size of image data
            offset,   # offset to image data
        )
        offset += len(img)
    return header + directory + b''.join(images)

ico_data = build_ico(ico_images, ico_sizes)
ico_path = ICONS_DIR / "icon.ico"
ico_path.write_bytes(ico_data)
print(f"  icon.ico (16/32/48/256)")

# Generate .icns by running iconutil or just leave as PNG (Tauri handles it)
print("\nDone. Tauri will bundle icon.png into .icns for macOS automatically.")
