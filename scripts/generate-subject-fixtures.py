"""Deterministic native PNG fixture; generate scanlines without a full image allocation."""
import json
import struct
import zlib
from pathlib import Path

directory = Path(__file__).resolve().parent.parent / "tests/fixtures/matting"
directory.mkdir(parents=True, exist_ok=True)
width, height = 10000, 5000
compressor = zlib.compressobj(9)
parts = []
for y in range(height):
    row = bytearray(width * 4)
    if 5 <= y < 4995:
        row[20 * 4:220 * 4] = bytes([255, 0, 0, 255]) * 200
    if 400 <= y < 420:
        row[80 * 4:100 * 4] = bytes(20 * 4)
    if y == 4000:
        row[9000 * 4:9001 * 4] = bytes([255, 0, 0, 128])
    parts.append(compressor.compress(b"\0" + row))
parts.append(compressor.flush())

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
png += chunk(b"sRGB", b"\0")
png += chunk(b"IDAT", b"".join(parts)) + chunk(b"IEND", b"")
(directory / "native-50mp.png").write_bytes(png)
(directory / "native-50mp.json").write_text(json.dumps({
    "width": width, "height": height,
    "points": [[20, 5], [219, 4994], [80, 400], [99, 419], [100, 419], [9000, 4000], [9001, 4000], [0, 0], [9999, 4999]],
    "alpha": [255, 255, 0, 0, 255, 128, 0, 0, 0],
}, indent=2) + "\n")
print(f"Created {width}x{height} PNG ({len(png)} bytes)")

small = bytearray(9 * 7 * 4)
for x, y, alpha in [(2, 2, 255), (3, 2, 128), (2, 3, 255), (4, 3, 255), (7, 5, 64)]:
    small[(y * 9 + x) * 4:(y * 9 + x + 1) * 4] = bytes([255, 0, 0, alpha])
rows = b"".join(b"\0" + small[y * 9 * 4:(y + 1) * 9 * 4] for y in range(7))
small_png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 9, 7, 8, 6, 0, 0, 0))
small_png += chunk(b"sRGB", b"\0") + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
(directory / "cutout.png").write_bytes(small_png)
