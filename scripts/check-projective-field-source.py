"""Independent genuine-original alpha-field readback. Streams/hashes the whole
native-CMM reference, retaining only required scalar bilinear neighborhoods.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates

spec = importlib.util.spec_from_file_location('field_oracle', Path(__file__).with_name('generate-projective-field-fixtures.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
p = argparse.ArgumentParser()
p.add_argument('actual', type=Path)
p.add_argument('--case', type=Path, required=True)
p.add_argument('--source-name', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'tests/fixtures/uint16-float/manifest.json').read_text())
row = next(v for v in manifest['cases'] if v['file'] == a.source_name)
case = json.loads(a.case.read_text())
width, height = row['width'], row['height']
quad = np.array([[v['x'], v['y']] for v in case['corners']], dtype=np.float64)
region = case['output']
origin, inverse = oracle.homography(width, height, quad)
needed, work = {}, []
for y in range(region['height']):
    for x in range(region['width']):
        point = inverse @ np.append(np.array([region['x']+x, region['y']+y])-origin+.5, 1)
        if point[2] == 0:
            continue
        sx, sy = point[:2]/point[2]-.5
        if sx < -1 or sy < -1 or sx >= width or sy >= height:
            continue
        ix, iy = int(np.floor(sx)), int(np.floor(sy))
        neighbors = []
        for dy in range(2):
            for dx in range(2):
                yy, xx = iy+dy, ix+dx
                inside = 0 <= xx < width and 0 <= yy < height
                neighbors.append((yy, xx) if inside else None)
                if inside:
                    needed.setdefault(yy, {})[xx] = None
        work.append((y, x, sx-ix, sy-iy, neighbors))
reference_hash = hashlib.sha256()
with gzip.open(root/'tests/fixtures/uint16-float'/row['reference'], 'rb') as f:
    for y in range(height):
        raw = f.read(width*16)
        assert len(raw) == width*16
        reference_hash.update(raw)
        if y in needed:
            line = np.frombuffer(raw, dtype='<f4').reshape(width, 4)
            for x in needed[y]:
                needed[y][x] = float(line[x, 3])
    assert f.read(1) == b''
assert reference_hash.hexdigest() == row['floatSha256']
expected = np.zeros((region['height'], region['width']), dtype='<f4')
for y, x, fx, fy, neighbors in work:
    patch = np.array([needed[p[0]][p[1]] if p else 0 for p in neighbors], dtype=np.float64).reshape(2, 2)
    expected[y, x] = map_coordinates(patch, [[fy], [fx]], order=1, prefilter=False, mode='nearest')[0]
actual = np.frombuffer(a.actual.read_bytes(), dtype='<f4').reshape(expected.shape)
assert np.isfinite(actual).all() and (actual >= 0).all() and (actual <= 1).all()
maximum = float(np.abs(actual.astype(np.float64)-expected.astype(np.float64)).max())
assert maximum <= 2**-21, maximum
print(json.dumps({'sourceWidth': width, 'sourceHeight': height, 'sourceReferenceSamplesHashed': width*height*4,
                  'sourceReferenceSha256': reference_hash.hexdigest(), 'scalarSamplesCompared': int(actual.size),
                  'maximumAbsoluteError': maximum, 'nonidenticalWords': int(np.count_nonzero(actual.view('<u4') != expected.view('<u4'))),
                  'actualSha256': hashlib.sha256(actual.tobytes()).hexdigest(), 'referenceSha256': hashlib.sha256(expected.tobytes()).hexdigest(),
                  'reference': 'Independent native-CMM source alpha, NumPy inverse solve, SciPy constant-border bilinear interpolation.'}))
