"""Independent full-image bilateral equation and source/project checks for production tests."""
import hashlib
import io
import json
import math
import struct
import sys
from pathlib import Path
from PIL import Image

project, first_png, reopened_png = map(Path, sys.argv[1:])
container = project.read_bytes()
assert container[:8] == b'LUMA3\r\n\0'
length = struct.unpack('<Q', container[8:16])[0]
manifest_bytes = container[48:48 + length]
assert hashlib.sha256(manifest_bytes).digest() == container[16:48]
manifest = json.loads(manifest_bytes)
assert manifest['document']['schemaVersion'] == 40
filter_value = manifest['document']['children'][0]['smartFilters'][0]
assert filter_value['kind'] == 'bilateral-denoise'
assert (filter_value['radius'], filter_value['colorSigma'], filter_value['amount']) == (3, 20, .75)
assert len(manifest['assets']) == 1
asset = manifest['assets'][0]
source_bytes = container[48 + length + asset['offset']:48 + length + asset['offset'] + asset['size']]
assert hashlib.sha256(source_bytes).hexdigest() == asset['sha256']
source = Image.open(io.BytesIO(source_bytes)).convert('RGBA')
first, reopened = [Image.open(p).convert('RGBA') for p in [first_png, reopened_png]]
assert source.size == first.size == reopened.size == (96, 64)
assert first.tobytes() == reopened.tobytes()
pixels, output = source.load(), first.load()
maximum_error = 0
before_error = after_error = 0
radius, sigma, strength = 3, 20, .75
for y in range(64):
    for x in range(96):
        center = pixels[x, y]
        channels, total = [0., 0., 0.], 0.
        for yy in range(max(0, y - radius), min(63, y + radius) + 1):
            for xx in range(max(0, x - radius), min(95, x + radius) + 1):
                sample = pixels[xx, yy]
                distance = sum((sample[c] - center[c]) ** 2 for c in range(3))
                weight = sample[3] / 255 * math.exp(
                    -((xx - x) ** 2 + (yy - y) ** 2) / (2 * (radius / 2) ** 2)
                    -distance / (6 * sigma ** 2))
                total += weight
                for c in range(3):
                    channels[c] += sample[c] * weight
        clean = (60, 85, 110) if x < 48 else (185, 210, 235)
        assert output[x, y][3] == center[3] == 255
        for c in range(3):
            expected = math.floor(center[c] + strength * (channels[c] / total - center[c]) + .5)
            maximum_error = max(maximum_error, abs(output[x, y][c] - expected))
            before_error += (center[c] - clean[c]) ** 2
            after_error += (output[x, y][c] - clean[c]) ** 2
assert maximum_error <= 1
ratio = after_error / before_error
assert ratio < .6
print(json.dumps({'completePixels': 96 * 64, 'pngsIdentical': True,
                  'sourceSha256': asset['sha256'], 'maximumEquationError': maximum_error,
                  'beforeMse': before_error / (96 * 64 * 3),
                  'afterMse': after_error / (96 * 64 * 3), 'noiseMseRatio': ratio,
                  'alphaExact': True, 'documentSchema': 40}))
