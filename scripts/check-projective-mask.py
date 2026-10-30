"""Independent mask projection/feather/settings oracle. Raw coverage is supplied
by an established rasterizer, or decoded independently from a real PNG crop.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import convolve1d

spec = importlib.util.spec_from_file_location('field_oracle', Path(__file__).with_name('generate-projective-field-fixtures.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
forward_spec = importlib.util.spec_from_file_location('forward_oracle', Path(__file__).with_name('generate-forward-projective-field-fixtures.py'))
forward_oracle = importlib.util.module_from_spec(forward_spec)
forward_spec.loader.exec_module(forward_oracle)
p = argparse.ArgumentParser()
p.add_argument('actual', type=Path)
p.add_argument('--case', type=Path, required=True)
p.add_argument('--source', type=Path, required=True)
p.add_argument('--png-source', action='store_true')
a = p.parse_args()
case = json.loads(a.case.read_text())
field, output, mask = case['field'], case['output'], case['mask']
if a.png_source:
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    with Image.open(a.source) as image:
        assert image.size == (case['sourceWidth'], case['sourceHeight'])
        source = (np.asarray(image.crop((field['x'], field['y'], field['x']+field['width'], field['y']+field['height'])).convert('RGBA'))[:, :, 3].astype(np.float64)/255).astype('<f4')
else:
    source = np.frombuffer(a.source.read_bytes(), dtype='<f4').reshape(field['height'], field['width'])
radius = mask.get('feather', 0)/3
extent = int(np.ceil(radius))
halo = 3*extent
padded = {'x': output['x']-halo, 'y': output['y']-halo, 'width': output['width']+2*halo, 'height': output['height']+2*halo}
if mask.get('linked', True):
    options = {'sourceWidth': case['sourceWidth'], 'sourceHeight': case['sourceHeight'], 'field': field,
               'output': padded, 'background': case['background'], 'corners': case['corners'], 'direction': case.get('direction', 'quad-to-source')}
    if a.png_source:
        quad = np.array([[v['x'], v['y']] for v in case['corners']], dtype=np.float64)
        origin, inverse = oracle.homography(case['sourceWidth'], case['sourceHeight'], quad)
        forward = np.linalg.inv(inverse)
        denominators = []
        for x in [padded['x']+.5, padded['x']+padded['width']-.5]:
            for y in [padded['y']+.5, padded['y']+padded['height']-.5]:
                if options['direction'] == 'source-to-quad':
                    q = forward @ np.array([x, y, 1])
                    u, v = q[:2]/q[2]+origin-.5
                else:
                    q = inverse @ np.append(np.array([x, y])-origin, 1)
                    u, v = q[:2]/q[2]-.5
                denominators.append(q[2])
                assert field['x']+1 <= u < field['x']+field['width']-2
                assert field['y']+1 <= v < field['y']+field['height']-2
        assert all(v > 0 for v in denominators) or all(v < 0 for v in denominators)
    values = forward_oracle.reference(source, options) if options['direction'] == 'source-to-quad' else oracle.reference(source, options)
else:
    values = np.full((padded['height'], padded['width']), case['background'], dtype='<f4')
    for y in range(padded['height']):
        for x in range(padded['width']):
            sx, sy = padded['x']+x-field['x'], padded['y']+y-field['y']
            if 0 <= sx < field['width'] and 0 <= sy < field['height']:
                values[y, x] = source[sy, sx]
if radius:
    locations = np.arange(-extent, extent+1)
    weights = np.maximum(0, np.minimum(locations+.5, radius+.5)-np.maximum(locations-.5, -radius-.5))
    weights /= weights.sum()
    for _ in range(3):
        for axis in [1, 0]:
            values = convolve1d(values.astype(np.float64), weights, axis=axis, mode='constant', cval=0).astype('<f4')
values = values[halo:halo+output['height'], halo:halo+output['width']].astype(np.float64)
if not mask['enabled'] or mask['density'] == 0:
    expected = np.ones_like(values, dtype='<f4')
else:
    if mask['inverted']:
        values = 1-values
    expected = (1-mask['density']+mask['density']*values).astype('<f4')
actual = np.frombuffer(a.actual.read_bytes(), dtype='<f4').reshape(expected.shape)
assert np.isfinite(actual).all() and (actual >= 0).all() and (actual <= 1).all()
error = float(np.abs(actual.astype(np.float64)-expected.astype(np.float64)).max())
assert error <= 2**-21, error
print(json.dumps({'samplesCompared': int(actual.size), 'maximumAbsoluteError': error,
                  'nonidenticalWords': int(np.count_nonzero(actual.view('<u4') != expected.view('<u4'))),
                  'actualSha256': hashlib.sha256(actual.tobytes()).hexdigest(), 'referenceSha256': hashlib.sha256(expected.tobytes()).hexdigest(),
                  'reference': 'Independent NumPy homography/SciPy interpolation, six fractional-box passes, then inversion/density.',
                  'independentPngCrop': a.png_source}))
