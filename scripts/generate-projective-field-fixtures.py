"""Independent scalar-field oracle: NumPy's 8-equation homography solve and
SciPy grid-constant interpolation. No editor/native sampler imports.
"""
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.ndimage import map_coordinates


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/projective-field'


def homography(width, height, quad):
    origin = quad[0].copy()
    rows, values = [], []
    for (x, y), (u, v) in zip([(0, 0), (width, 0), (width, height), (0, height)], quad-origin):
        rows.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]])
        values.extend([u, v])
    forward = np.append(np.linalg.solve(np.array(rows, dtype=np.float64), values), 1).reshape(3, 3)
    return origin, np.linalg.inv(forward)


def write(name, pixels):
    raw = np.ascontiguousarray(pixels, dtype='<f4').tobytes()
    (OUT / name).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    return hashlib.sha256(raw).hexdigest()


def reference(source, options):
    quad = np.array([[p['x'], p['y']] for p in options['corners']], dtype=np.float64)
    origin, inverse = homography(options['sourceWidth'], options['sourceHeight'], quad)
    b, field = options['output'], options['field']
    y, x = np.mgrid[:b['height'], :b['width']]
    relative = np.stack([x+b['x']-origin[0]+.5, y+b['y']-origin[1]+.5, np.ones_like(x)], axis=0)
    points = np.einsum('ij,jkl->ikl', inverse, relative)
    valid = points[2] != 0
    coords = np.zeros((2, b['height'], b['width']), dtype=np.float64)
    coords[0, valid] = points[1, valid]/points[2, valid]-.5-field['y']
    coords[1, valid] = points[0, valid]/points[2, valid]-.5-field['x']
    result = map_coordinates(source.astype(np.float64), coords, order=1, prefilter=False,
                             mode='grid-constant', cval=options['background'])
    result[~valid] = options['background']
    return result.astype('<f4')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[:33, :39]
    source = (((x*7+y*13) % 31)/30).astype('<f4')
    source[::4, ::3] = 1
    source[1::5, 2::4] = 0
    source_hash = write('source.f32le.gz', source)
    definitions = [
        ('identity', 31, 23, [[0, 0], [31, 0], [31, 23], [0, 23]], [-10, -8, 48, 42], 0),
        ('constant-one-border', 31, 23, [[.25, -.5], [31.25, -.5], [31.25, 22.5], [.25, 22.5]], [-10, -8, 48, 42], 1),
        ('fractional-background', 31, 23, [[1.125, .375], [32.125, .375], [32.125, 23.375], [1.125, 23.375]], [-10, -8, 48, 42], .37),
        ('reflection', 31, 23, [[36, 2], [2, 4], [5, 29], [31, 26]], [-15, -12, 70, 60], .37),
        ('perspective', 31, 23, [[3.25, 1.125], [39.5, 4.25], [31, 29], [7.5, 25.75]], [-15, -12, 70, 60], 0),
        ('inverse-horizon', 8, 8, [[0, -.5], [8, -.5], [4, 3.5], [0, 3.5]], [-12, -8, 36, 36], 1),
        ('strong-perspective', 31, 23, [[1, 1], [39.5, 3], [7.75, 30], [6, 28]], [-15, -12, 70, 60], .37),
        ('large-placement', 31, 23, [[100000003.25, -199999998.875], [100000039.5, -199999995.75], [100000031, -199999971], [100000007.5, -199999974.25]], [99999985, -200000012, 70, 60], 1),
    ]
    cases = []
    for name, width, height, corners, output, background in definitions:
        options = {'sourceWidth': width, 'sourceHeight': height,
                   'corners': [dict(zip(['x', 'y'], p)) for p in corners],
                   'field': {'x': -7, 'y': -5, 'width': 39, 'height': 33},
                   'source': {'x': -7, 'y': -5, 'width': 39, 'height': 33},
                   'output': dict(zip(['x', 'y', 'width', 'height'], output)), 'background': background}
        if name == 'inverse-horizon':
            options['field']['y'] = options['source']['y'] = -15
        filename = name+'.f32le.gz'
        cases.append({'name': name, 'options': options, 'reference': filename,
                      'floatSha256': write(filename, reference(source, options))})
    manifest = {'version': 1, 'sourceSha256': source_hash,
                'reference': 'Independent NumPy 8-equation solve and SciPy grid-constant bilinear interpolation.',
                'numpy': np.__version__, 'scipy': scipy.__version__, 'absoluteError': 2**-21, 'cases': cases}
    (OUT/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'cases': len(cases), 'outputSamples': sum(c['options']['output']['width']*c['options']['output']['height'] for c in cases)}))
