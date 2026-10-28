"""Register independent full-precision HSL, Color Balance and Vibrance cases."""
from pathlib import Path
import gzip, hashlib, itertools, json
import numpy as np
from float_color_reference import adjust, neutral, render

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/float-color'
out.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
files = {}


def write(name, values):
    raw = np.ascontiguousarray(values, dtype='<f4').tobytes()
    packed = gzip.compress(raw, mtime=0)
    (out / name).write_bytes(packed)
    files[name] = dict(bytes=len(packed), sha256=sha(packed), rawSha256=sha(raw))


rng = np.random.default_rng(20261028)
source = rng.random((4099, 4), dtype=np.float32)
source[::17, 3] = 0
source[::19, 3] = 1
threshold = np.float32(.0031308)
coordinates = [0., 2**-149, 1e-30, float(np.nextafter(threshold, np.float32(0))), float(threshold),
               float(np.nextafter(threshold, np.float32(1))), float(np.nextafter(np.float32(1), np.float32(0))), 1.]
grid = np.array([[*rgb, [0., .375, 1.][i % 3]] for i, rgb in enumerate(itertools.product(coordinates, repeat=3))], dtype=np.float32)
source = np.concatenate([source, grid, np.array([[-0., 2**-149, 2**-148, -0.]], dtype=np.float32)])
extended = np.array([[-0., 3.5, -(2**-149), -0.], [-4.25, 8.5, 1e-30, .375], [3e38, -3e38, 1e-40, 1]], dtype=np.float32)
write('source.f32le.gz', source)
write('extended-source.f32le.gz', extended)
settings = [dict(kind='hsl', hue=h, saturation=s, lightness=l) for h, s, l in
            [(0, 0, 0), (180, 0, 0), (-180, 0, 0), (37.25, -43.5, 21.75),
             (0, 100, 0), (0, -100, 0), (0, 0, 100), (0, 0, -100), (73, 100, -33), (-137, -100, 24)]]
zero = dict(red=0, green=0, blue=0)
for preserve in [True, False]:
    settings.append(dict(kind='color-balance', shadows=zero.copy(), midtones=zero.copy(), highlights=zero.copy(), preserveLuminosity=preserve))
for band in ['shadows', 'midtones', 'highlights']:
    for channel in ['red', 'green', 'blue']:
        for amount in [-100, 100]:
            row = dict(kind='color-balance', shadows=zero.copy(), midtones=zero.copy(), highlights=zero.copy(), preserveLuminosity=True)
            row[band][channel] = amount
            settings.append(row)
for preserve in [True, False]:
    settings.append(dict(kind='color-balance', shadows=dict(red=-37.25, green=12.5, blue=71.25),
                         midtones=dict(red=27.5, green=-41.25, blue=16.75), highlights=dict(red=53.5, green=19.25, blue=-61.5), preserveLuminosity=preserve))
settings += [dict(kind='vibrance', vibrance=v, saturation=s) for v, s in
             [(0, 0), (100, 0), (-100, 0), (0, 100), (0, -100), (100, 100), (-100, -100), (37.25, -41.5), (-68, 18)]]
cases = []
for index, row in enumerate(settings):
    name = f'color-{index}.f32le.gz'
    result = adjust(source, row)
    assert np.array_equal(result.view('<u4'), adjust(source, row, scalar_hls=True).view('<u4'))
    write(name, result)
    cases.append(dict(adjustment=row, neutral=neutral(row), reference=name, rawSha256=files[name]['rawSha256']))
inputs = [Path(__file__), root / 'scripts/float_color_reference.py']
manifest = dict(version=1, pixels=len(source), colorTolerance=2**-22, alphaTolerance=0,
                integerColorTolerance=1, neutralExactWords=True, cases=cases, files=files,
                inputs={str(p.relative_to(root)): sha(p.read_bytes()) for p in inputs},
                reference='Independent NumPy f64 sRGB transfers, Python colorsys HLS, encoded-luma range weights and W3C SetLum/ClipColor; one f32 color store, exact alpha. No editor/WASM/GPU/byte expected pixels.',
                sourceUrls=['https://docs.python.org/3/library/colorsys.html', 'https://www.w3.org/TR/css-color-4/#color-conversion-code', 'https://www.w3.org/TR/compositing-1/#blendingnonseparable'])
manifest.update(width=131, height=79, sceneColorTolerance=2**-22,
                sceneToleranceScale='max(1, abs(source RGB), abs(reference RGB)) per pixel',
                scalarVectorWordsExact=True, sources=[], scenes=[])
normalize = dict(kind='adjustment', adjustment=dict(kind='levels', rgb=dict(inputBlack=1, inputWhite=254, gamma=1, outputBlack=0, outputWhite=255)))
representatives = [settings[3], settings[30], settings[39]]
for directory, filename in [('float-source', 'rgba-raw-le.tif'), ('float-document', 'hdr-high.tif'), ('uint16-float', 'u16-all-levels.tif')]:
    folder = root / 'tests/fixtures' / directory
    source_manifest = folder / 'manifest.json'
    table = json.loads(source_manifest.read_text())
    row = next(r for r in table['cases'] if r['file'] == filename)
    original = root / 'tests/fixtures' / ('uint16-float' if directory == 'uint16-float' else 'tiff-float') / filename
    reference = folder / row['reference']
    packed = reference.read_bytes()
    assert sha(packed) == table['files'][reference.name]['sha256']
    values = np.frombuffer(gzip.decompress(packed), dtype='<f4').reshape(row['height'], row['width'], 4)[:79, :131].copy()
    inputs += [source_manifest, original, reference]
    manifest['sources'].append(dict(name=filename, original=str(original.relative_to(root)), reference=str(reference.relative_to(root)), width=row['width'], height=row['height']))
    scenes = {f'color-{i}': [dict(kind='raster'), normalize, dict(kind='adjustment', adjustment=setting)] for i, setting in enumerate(settings)}
    for index, setting in enumerate(representatives):
        kind = setting['kind']
        layer = dict(kind='adjustment', adjustment=setting, opacity=.75, fillOpacity=.625, mask=dict(rect=[15, 10, 90, 55], density=.5))
        scenes.update({
            kind+'-isolated': [dict(kind='group', opacity=.75, fillOpacity=.625, mask=dict(rect=[5, 10, 110, 55], density=.5), children=[dict(kind='raster'), normalize, layer])],
            kind+'-pass-through': [dict(kind='raster'), normalize, dict(kind='group', blendMode='pass-through', opacity=.625, mask=dict(rect=[5, 5, 115, 65], density=.5), children=[layer])],
            kind+'-clipping': [dict(kind='raster', opacity=.375), dict(kind='raster', opacity=.75, fillOpacity=.625, mask=dict(rect=[5, 5, 115, 65], density=.5)), dict(normalize, clipped=True), dict(layer, clipped=True)],
            kind+'-group-base': [dict(kind='group', opacity=.75, fillOpacity=.625, mask=dict(rect=[5, 5, 115, 65], density=.5), children=[dict(kind='raster'), normalize, layer]), dict(layer, clipped=True)],
            kind+'-ordered': [dict(kind='raster'), normalize, dict(kind='adjustment', adjustment=dict(kind='curves', rgb=[dict(x=0,y=0),dict(x=128,y=152),dict(x=255,y=255)])),
                              *[dict(kind='adjustment', adjustment=representatives[(index+offset)%3]) for offset in range(3)],
                              dict(kind='adjustment', adjustment=dict(kind='white-balance',temperature=6504,tint=0)),
                              dict(kind='adjustment', adjustment=dict(kind='levels',rgb=dict(inputBlack=0,inputWhite=255,gamma=.85,outputBlack=0,outputWhite=255)))],
            kind+'-artistic': [dict(kind='raster'), normalize, dict(layer, blendMode=['screen','color','luminosity'][index])],
        })
    for name, layers in scenes.items():
        file = filename+'-'+name+'.f32le.gz'
        write(file, render(values, layers))
        manifest['scenes'].append(dict(source=filename, name=name, layers=layers, reference=file, rawSha256=files[file]['rawSha256']))
manifest['largeLayers'] = [dict(kind='raster'), dict(kind='adjustment', adjustment=representatives[0]),
                           dict(kind='adjustment', adjustment=representatives[1]),
                           dict(kind='adjustment', adjustment=representatives[2], opacity=.625,
                                mask=dict(rect=[2000,0,7000,5000],density=.5))]
inputs += [root/'scripts/float_clipping_reference.py',root/'scripts/float_transfer_reference.py',
           root/'scripts/float_blend_reference.py',root/'scripts/float_white_balance_reference.py',root/'tests/fixtures/white-balance-reference.json']
manifest['inputs'] = {str(p.relative_to(root)): sha(p.read_bytes()) for p in inputs}
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(dict(pixels=len(source), cases=len(cases), scenes=len(manifest['scenes']), colorTolerance=manifest['colorTolerance'])))
