"""Generate independent float appearance samples and completed scene references."""
from pathlib import Path
import copy, gzip, hashlib, itertools, json
import numpy as np
from float_style_reference import appearance, render

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/float-style'
out.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
files = {}
def write(name, values):
    raw = np.ascontiguousarray(values, dtype='<f4').tobytes()
    packed = gzip.compress(raw, mtime=0)
    (out / name).write_bytes(packed)
    files[name] = dict(bytes=len(packed), sha256=sha(packed), rawSha256=sha(raw))
def style(color='#e35f27', amount=0, channel='luminance', ranges=None, enabled=False):
    return dict(colorOverlay=dict(enabled=amount != 0, color=color, opacity=amount),
                blendIf=dict(enabled=enabled, channel=channel, source=(ranges or [[0, 0, 255, 255]]*2)[0], underlying=(ranges or [[0, 0, 255, 255]]*2)[1]),
                dropShadow=dict(enabled=False, color='#000000', opacity=.35, x=8, y=8, blur=12))
rng = np.random.default_rng(20261029)
source = rng.uniform(-.5, 2.5, (4099, 4)).astype(np.float32)
backdrop = rng.uniform(-1.5, 3.5, (4099, 4)).astype(np.float32)
source[:, 3] = rng.random(4099, dtype=np.float32)
backdrop[:, 3] = rng.random(4099, dtype=np.float32)
thresholds = [0., 2**-149, .0031308, .25, .5, 1., 2., -1.]
extra = np.array([[*rgb, [0., .375, 1.][i % 3]] for i, rgb in enumerate(itertools.product(thresholds, repeat=3))] + [[-0., 3e38, -3e38, -0.]], dtype=np.float32)
source = np.concatenate([source, extra]);backdrop = np.concatenate([backdrop, extra[::-1]])
write('source.f32le.gz', source);write('backdrop.f32le.gz', backdrop)
feather = [[12.25, 67.5, 193.75, 246.5], [4.5, 36.25, 217.75, 253.5]]
hard = [[64, 64, 192, 192], [0, 0, 255, 255]]
settings = [style()] + [style(color, amount) for color, amount in [('#ff0000', 0), ('#abcdef', .173), ('#171b46', .5), ('#ffffff', 1)]]
for channel in ['luminance', 'red', 'green', 'blue']:
    settings += [style(channel=channel, ranges=ranges, enabled=True) for ranges in [None, feather, hard]]
    settings += [style('#ad3f79', .37, channel, feather, True)]
cases = []
for i, value in enumerate(settings):
    pixels, coverage = appearance(source, backdrop, value)
    write(f'style-{i}.f32le.gz', pixels);write(f'coverage-{i}.f32le.gz', coverage)
    cases.append(dict(style=value, pixels=f'style-{i}.f32le.gz', coverage=f'coverage-{i}.f32le.gz'))
original = root/'tests/fixtures/uint16-float/u16-raw.tif'
reference = root/'tests/fixtures/uint16-float/u16-raw-linear.f32le.gz'
native = np.frombuffer(gzip.decompress(reference.read_bytes()), dtype='<f4').reshape(79, 131, 4).copy()
scenes = []
for channel in ['luminance', 'red', 'green', 'blue']:
    value = style('#ad3f79', .37, channel, feather, True)
    base = dict(kind='raster', opacity=.625)
    foreground = dict(kind='raster', opacity=.75, fillOpacity=.625, x=7, y=3, styles=value, mask=dict(rect=[15, 10, 90, 55], density=.5))
    variants = {
        'raster': [base, foreground],
        'isolated-group': [base, dict(kind='group', opacity=.75, fillOpacity=.625, styles=value, mask=dict(rect=[5, 5, 115, 65], density=.5), children=[dict(kind='raster')])],
        'pass-through': [base, dict(kind='group', opacity=.625, blendMode='pass-through', mask=dict(rect=[5, 5, 115, 65], density=.5), children=[foreground])],
        'clipping': [base, dict(kind='raster', opacity=.75, fillOpacity=.625, styles=value), dict(foreground, clipped=True)],
        'adjustment': [base, dict(kind='adjustment', tone=dict(exposure=.5), opacity=.75, fillOpacity=.625, styles=value, mask=dict(rect=[5, 5, 115, 65], density=.5))],
        'clipped-adjustment': [base, dict(kind='raster', opacity=.75, fillOpacity=.625, mask=dict(rect=[5, 5, 115, 65], density=.5)), dict(kind='adjustment', tone=dict(exposure=.5), opacity=.75, fillOpacity=.625, styles=value, clipped=True)],
    }
    for name, layers in variants.items():
        filename=f'{channel}-{name}.f32le.gz';write(filename, render(native, layers));scenes.append(dict(name=f'{channel}-{name}', layers=layers, reference=filename))
modes = ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity','linear-light','linear-burn']
for mode in modes:
    base = dict(kind='raster', opacity=.75, styles=style('#315a7d', 1))
    for kind in ['raster', 'group', 'adjustment']:
        node = dict(kind=kind, blendMode=mode, opacity=.625, fillOpacity=.75,
                    styles=style('#e67c2f', 1 if kind=='raster' else .375, 'luminance', feather, True),
                    mask=dict(rect=[5, 5, 115, 65], density=.5))
        if kind == 'group':
            node['children'] = [dict(kind='raster', styles=style('#4c859d', 1))]
        elif kind == 'adjustment':
            node['tone'] = dict(exposure=.25)
        layers = [base, node]
        filename = f'artistic-{mode}-{kind}.f32le.gz'
        write(filename, render(native, layers))
        scenes.append(dict(name=f'artistic-{mode}-{kind}', layers=layers, reference=filename))
inputs = [Path(__file__), root/'scripts/float_style_reference.py', root/'scripts/float_clipping_reference.py', root/'scripts/float_blend_reference.py', original, reference, root/'tests/fixtures/uint16-float/manifest.json']
manifest = dict(version=1, reference='Independent NumPy float64 sRGB transfer, linear-light interpolation, continuous split-range coverage and premultiplied composition; one float32 store per stage. No application/WASM/display expected samples.',
                pixels=len(source), colorTolerance=2**-22, coverageTolerance=2**-22, alphaTolerance=0,
                original=str(original.relative_to(root)), nativeReference=str(reference.relative_to(root)), width=131, height=79,
                cases=cases, scenes=scenes, files=files, inputs={str(p.relative_to(root)):sha(p.read_bytes()) for p in inputs})
(out/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print(json.dumps(dict(pixels=len(source), cases=len(cases), scenes=len(scenes))))
