"""Independent SciPy fractional-box feather reference, with float32 rounding
between the established three horizontal/vertical pass pairs.
"""
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.ndimage import convolve1d

root = Path(__file__).resolve().parents[1]
out = root/'tests/fixtures/mask-feather'
out.mkdir(parents=True, exist_ok=True)
bounds = {'x': -50, 'y': -40, 'width': 151, 'height': 127}
source_bounds = {'x': -179, 'y': -169, 'width': 409, 'height': 385}
y, x = np.mgrid[:385, :409]
x, y = x-179, y-169
inside = (x >= -27) & (x < 58) & (y >= -19) & (y < 43)
source = np.where(inside, ((x*7+y*13) % 31)/30, .37).astype('<f4')


def write(name, pixels):
    raw = np.ascontiguousarray(pixels, dtype='<f4').tobytes()
    (out/name).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    return hashlib.sha256(raw).hexdigest()


source_hash = write('source.f32le.gz', source)
cases = []
for feather in [0, .1, 2.5, 7.75, 128]:
    radius = feather/3
    extent = int(np.ceil(radius))
    locations = np.arange(-extent, extent+1)
    # Fractional pixel support: integrate the uniform box over unit cells.
    weights = np.maximum(0, np.minimum(locations+.5, radius+.5)-np.maximum(locations-.5, -radius-.5))
    weights /= weights.sum()
    filtered = source.copy()
    for _ in range(3):
        for axis in [1, 0]:
            filtered = convolve1d(filtered.astype(np.float64), weights, axis=axis, mode='constant', cval=0).astype('<f4')
    expected = filtered[129:129+127, 129:129+151]
    name = 'feather-'+str(feather)+'.f32le.gz'
    cases.append({'feather': feather, 'reference': name, 'floatSha256': write(name, expected)})
(out/'manifest.json').write_text(json.dumps({'version': 1, 'source': source_bounds, 'output': bounds,
    'sourceSha256': source_hash, 'absoluteError': 2**-21, 'numpy': np.__version__, 'scipy': scipy.__version__,
    'reference': 'SciPy float64 separable fractional box convolution, float32 after each of six passes.', 'cases': cases}, indent=2)+'\n')
print(json.dumps({'cases': len(cases), 'samplesCompared': len(cases)*151*127}))
