"""Test-only Pillow/libavif reader; never imports the editor's codec or parser.

CANOLI_AVIF_PYTHON must provide Pillow with native AVIF support (tested with
Pillow 12.0.0 / libavif 1.3.0). Compare every RGBA sample in bounded row copies.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from PIL import Image, features, __version__

parser = argparse.ArgumentParser()
parser.add_argument('avif')
parser.add_argument('reference')
parser.add_argument('--width', type=int)
parser.add_argument('--height', type=int)
parser.add_argument('--lossy', action='store_true')
args = parser.parse_args()
assert features.check('avif'), 'Independent Pillow reader needs native AVIF support'
encoded = Path(args.avif).read_bytes()
assert encoded[4:8] == b'ftyp' and b'avif' in encoded[8:32]
# Inspect the actual nclx descriptor independently of the application's parser.
offset = encoded.index(b'nclx')
primaries, transfer, matrix, flags = struct.unpack('>HHHB', encoded[offset+4:offset+11])
assert (primaries, transfer) == (1, 13), 'Output must identify sRGB'
assert matrix in (0, 6) and flags == 128
image = Image.open(args.avif)
assert image.format == 'AVIF' and image.n_frames == 1
image = image.convert('RGBA')
reference_path = Path(args.reference)
if reference_path.suffix == '.rgba':
    assert args.width and args.height
    reference = Image.frombytes('RGBA', (args.width, args.height), reference_path.read_bytes())
else:
    reference = Image.open(reference_path).convert('RGBA')
assert image.size == reference.size, (image.size, reference.size)
width, height = image.size
expected_hash, actual_hash = hashlib.sha256(), hashlib.sha256()
exact = True
for y in range(0, height, 64):
    box = (0, y, width, min(height, y+64))
    actual, expected = image.crop(box).tobytes(), reference.crop(box).tobytes()
    actual_hash.update(actual)
    expected_hash.update(expected)
    assert actual[3::4] == expected[3::4], f'Alpha differs at rows {y}..{y+64}'
    if actual != expected:
        exact = False
        assert args.lossy, f'Lossless RGBA differs at rows {y}..{y+64}'
print(json.dumps({'reader': 'Pillow/libavif', 'pillow': __version__,
                  'libavif': features.version('avif'), 'width': width, 'height': height,
                  'alphaExact': True, 'rgbaExact': exact, 'lossy': args.lossy,
                  'sRgb': True, 'matrix': matrix, 'bytes': len(encoded),
                  'rgbaSha256': actual_hash.hexdigest(), 'referenceRgbaSha256': expected_hash.hexdigest()}))
