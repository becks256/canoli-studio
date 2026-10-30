"""Independent NumPy exposure reference. Never imports Canoli processing code."""
from pathlib import Path
import gzip, hashlib, json
import numpy as np

directory = Path(__file__).parent
index = np.arange(2049)
source = np.column_stack(((index % 79) / 23 - .75,
                         (index % 113) / 29 - .25,
                         (index % 137) / 31 - .5,
                         (index % 5) / 4)).astype('<f4')
source[0] = [-0., -.125, 3.4e38, -0.]
coverage = ((index % 256) / 255).astype('<f4')
files = {}

def save(name, values):
    data = gzip.compress(values.astype('<f4').tobytes(), mtime=0)
    (directory / name).write_bytes(data)
    files[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

save('source.f32le.gz', source)
save('coverage.f32le.gz', coverage)
cases = []
rgb = source[:, :3].astype(np.float64)
luminance = np.clip(rgb @ np.array([.2126, .7152, .0722]), 0, 1)
weights = [1 - luminance, 4 * luminance * (1 - luminance), luminance]
for mode in ['dodge', 'burn']:
    for range_index, tonal_range in enumerate(['shadows', 'midtones', 'highlights']):
        for protection in [False, True]:
            options = dict(mode=mode, range=tonal_range, exposure=.625,
                           flow=.75, protectTones=protection)
            gain = np.exp2((2 if mode == 'dodge' else -2) * .625 * .75 * coverage.astype(np.float64) * weights[range_index])
            if protection:
                peak = rgb.max(axis=1)
                positive = peak > 0
                gain[positive] = np.minimum(gain[positive], np.maximum(1., 1. / peak[positive]))
            result = source.copy()
            active = (source[:, 3] != 0) & (coverage != 0) & (gain != 1)
            result[active, :3] = (rgb[active] * gain[active, None]).astype('<f4')
            name = f'{mode}-{tonal_range}-{int(protection)}.f32le.gz'
            save(name, result)
            cases.append({'options': options, 'reference': name})
manifest = dict(tolerance=2**-22, cases=cases, files=files,
                generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
(directory / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
