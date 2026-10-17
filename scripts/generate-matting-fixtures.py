"""Small exact color-line fixtures, encoded independently with Python's PNG primitives."""
import json
import struct
import zlib
from pathlib import Path

directory = Path(__file__).resolve().parent.parent / "tests/fixtures/matting"
directory.mkdir(parents=True, exist_ok=True)
colors = [(200, 20, 10), (200, 20, 10), (162, 22, 48), (134, 24, 77), (105, 25, 105), (77, 27, 134), (48, 28, 162), (10, 30, 200), (10, 30, 200)]

def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

def write(name, row):
    data = b"".join(b"\0" + bytes(row) for _ in range(5))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 9, 5, 8, 6, 0, 0, 0))
    png += chunk(b"sRGB", b"\0") + chunk(b"IDAT", zlib.compress(data, 9)) + chunk(b"IEND", b"")
    (directory / name).write_bytes(png)

write("color-line.png", [value for rgb in colors for value in (*rgb, 255)])
write("color-line-trimap.png", [value for x in range(9) for value in (255, 255, 255, 255 if x < 2 else 0 if x > 6 else 128)])
(directory / "color-line.json").write_text(json.dumps({"width": 9, "height": 5, "alpha": [255, 255, 204, 166, 128, 89, 51, 0, 0], "correctedCenter": [199, 20, 11, 255]}, indent=2) + "\n")
