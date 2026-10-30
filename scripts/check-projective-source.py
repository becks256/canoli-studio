"""Check a perspective window against the independent native-CMM source corpus.
Stream the complete reference and retain only requested bilinear neighborhoods;
even a genuine 50 MP reference never needs a complete float plane in memory.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates
import importlib.util

spec = importlib.util.spec_from_file_location('projective_oracle', Path(__file__).with_name('generate-projective-fixtures.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
p = argparse.ArgumentParser()
p.add_argument('actual', type=Path)
p.add_argument('--case', type=Path, required=True)
p.add_argument('--source-name', required=True)
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'tests/fixtures/uint16-float/manifest.json').read_text())
row = next(v for v in manifest['cases'] if v['file'] == a.source_name)
case = json.loads(a.case.read_text())
width, height = row['width'], row['height']
quad = np.array([[v['x'], v['y']] for v in case['corners']], dtype=np.float64)
region = case['output']
origin, inverse = oracle.homography(width, height, quad)
needed, work = {}, []
for y in range(region['height']):
    for x in range(region['width']):
        px, py = region['x']+x, region['y']+y
        coverage, centroid = oracle.pixel_polygon(quad, px, py)
        if not coverage:
            continue
        point = inverse @ np.append(np.array([px, py])-origin+centroid, 1)
        sx, sy = np.clip(point[:2]/point[2]-.5, [0, 0], [width-1, height-1])
        ix, iy = int(np.floor(sx)), int(np.floor(sy))
        points = [(min(height-1, iy+dy), min(width-1, ix+dx)) for dy in range(2) for dx in range(2)]
        for yy, xx in points:
            needed.setdefault(yy, {})[xx] = None
        work.append((y, x, coverage, sx-ix, sy-iy, points))
reference_hash = hashlib.sha256()
with gzip.open(root / 'tests/fixtures/uint16-float' / row['reference'], 'rb') as f:
    for y in range(height):
        raw = f.read(width*16)
        assert len(raw) == width*16
        reference_hash.update(raw)
        if y in needed:
            line = np.frombuffer(raw, dtype='<f4').reshape(width, 4)
            for x in needed[y]:
                needed[y][x] = line[x].astype(np.float64)
    assert f.read(1) == b''
assert reference_hash.hexdigest() == row['floatSha256']
expected = np.zeros((region['height'], region['width'], 4), dtype='<f4')
for y, x, coverage, fx, fy, points in work:
    patch = np.array([needed[yy][xx] for yy, xx in points]).reshape(2, 2, 4)
    patch[:, :, :3] *= patch[:, :, 3:4]
    sample = np.array([map_coordinates(patch[:, :, c], [[fy], [fx]], order=1, prefilter=False, mode='nearest')[0] for c in range(4)])
    alpha = np.float32(sample[3]*coverage)
    if alpha > 0:
        expected[y, x, :3] = sample[:3]/sample[3]
        expected[y, x, 3] = alpha
actual = np.frombuffer(a.actual.read_bytes(), dtype='<f4').reshape(expected.shape)
assert np.isfinite(actual).all() and (actual[:, :, 3] >= 0).all() and (actual[:, :, 3] <= 1).all()
error = np.abs(actual.astype(np.float64)-expected.astype(np.float64))/np.maximum(1, np.abs(expected.astype(np.float64)))
maximum = float(error.max())
assert maximum <= 2**-21, maximum
print(json.dumps({'sourceWidth': width, 'sourceHeight': height, 'sourceReferenceSamplesHashed': width*height*4,
                  'sourceReferenceSha256': reference_hash.hexdigest(), 'samplesCompared': int(actual.size),
                  'maximumScaledError': maximum, 'nonidenticalWords': int(np.count_nonzero(actual.view('<u4') != expected.view('<u4'))),
                  'actualSha256': hashlib.sha256(actual.tobytes()).hexdigest(), 'referenceSha256': hashlib.sha256(expected.tobytes()).hexdigest(),
                  'reference': 'Independent native-CMM source corpus, NumPy inverse solve and half-plane line arrangement, SciPy premultiplied interpolation.'}))
