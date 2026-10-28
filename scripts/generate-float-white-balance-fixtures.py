"""Register independent native-linear White Balance samples and complete scenes."""
from pathlib import Path
import gzip
import hashlib
import json
import numpy as np
from float_white_balance_reference import balance, render, matrix_path

root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/float-white-balance'
out.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
files = {}
inputs = {matrix_path, root / 'scripts/float_white_balance_reference.py',
          root / 'scripts/float_clipping_reference.py', root / 'scripts/float_transfer_reference.py',
          Path(__file__), root / 'tests/fixtures/float-tone/source.f32le.gz'}


def write(name, pixels):
    raw = np.ascontiguousarray(pixels, dtype='<f4').tobytes()
    packed = gzip.compress(raw, mtime=0)
    (out / name).write_bytes(packed)
    files[name] = dict(bytes=len(packed), sha256=sha(packed), rawSha256=sha(raw))
    return files[name]['rawSha256']


# Fixed before evaluating application/native output; alpha and neutral identity
# are exact. Numerical tint tangents make independent matrices approximate.
manifest = dict(version=1, colorTolerance=2**-20,
                toleranceScale='max(1, abs(source RGB), abs(reference RGB)) per pixel',
                alphaTolerance=0, integerColorTolerance=1, neutralExactWords=True,
                width=131, height=79, pixels=[], sources=[], scenes=[])
source = np.frombuffer(gzip.decompress((root / 'tests/fixtures/float-tone/source.f32le.gz').read_bytes()),
                       dtype='<f4').reshape(-1, 4)
manifest['subnormalExactPixel'] = len(source)
source = np.concatenate([source, np.array([[-0., 2**-149, -(2**-149), -0.]], dtype=np.float32)])
write('source.f32le.gz', source)
settings = [dict(kind='white-balance', temperature=r['temperature'], tint=r['tint'])
            for r in json.loads(matrix_path.read_text())['cases']]
for index, setting in enumerate(settings):
    name = f'pixels-{index}.f32le.gz'
    manifest['pixels'].append(dict(adjustment=setting, reference=name,
                                   rawSha256=write(name, balance(source, setting))))

chosen = dict(kind='white-balance', temperature=4000.5, tint=100)
wb = dict(kind='adjustment', adjustment=chosen, opacity=.75, fillOpacity=.625,
          mask=dict(rect=[15, 10, 90, 55], density=.5))
base = dict(kind='raster', opacity=.625)
contexts = {
    'isolated': [dict(kind='group', opacity=.75, fillOpacity=.625,
                      mask=dict(rect=[5, 10, 110, 55], density=.5), children=[base, wb])],
    'pass-through': [base, dict(kind='group', blendMode='pass-through', opacity=.625,
                              mask=dict(rect=[5, 5, 115, 65], density=.5),
                              children=[dict(kind='raster', opacity=.375), wb])],
    'clipping': [dict(kind='raster', opacity=.375),
                 dict(kind='raster', opacity=.75, fillOpacity=.625,
                      mask=dict(rect=[5, 5, 115, 65], density=.5)), dict(wb, clipped=True)],
    'group-base': [dict(kind='group', opacity=.75, fillOpacity=.625,
                       mask=dict(rect=[5, 5, 115, 65], density=.5), children=[base, wb]),
                   dict(wb, clipped=True, adjustment=dict(kind='white-balance', temperature=10000, tint=0))],
    'ordered': [dict(kind='raster'),
                dict(kind='adjustment', adjustment=dict(kind='curves', rgb=[dict(x=0, y=0), dict(x=128, y=152), dict(x=255, y=255)])),
                wb, dict(kind='adjustment', adjustment=dict(kind='white-balance', temperature=6504, tint=0)),
                dict(kind='adjustment', adjustment=dict(kind='levels', rgb=dict(inputBlack=0, inputWhite=255, gamma=.85, outputBlack=0, outputWhite=255)))],
}
for directory, filename in [('float-source', 'rgba-raw-le.tif'), ('float-document', 'hdr-high.tif'),
                            ('uint16-float', 'u16-all-levels.tif')]:
    folder = root / 'tests/fixtures' / directory
    source_manifest = folder / 'manifest.json'
    table = json.loads(source_manifest.read_text())
    row = next(r for r in table['cases'] if r['file'] == filename)
    reference = folder / row['reference']
    packed = reference.read_bytes()
    assert sha(packed) == table['files'][reference.name]['sha256']
    values = np.frombuffer(gzip.decompress(packed), dtype='<f4').reshape(row['height'], row['width'], 4)[:79, :131].copy()
    original = root / 'tests/fixtures' / ('uint16-float' if directory == 'uint16-float' else 'tiff-float') / filename
    inputs.update([original, source_manifest, reference])
    manifest['sources'].append(dict(name=filename, original=str(original.relative_to(root)),
                                    reference=str(reference.relative_to(root)), width=row['width'], height=row['height']))
    scenes = {f'balance-{i}': [dict(kind='raster'), dict(kind='adjustment', adjustment=setting)]
              for i, setting in enumerate(settings)}
    scenes.update(contexts)
    for name, layers in scenes.items():
        file = filename + '-' + name + '.f32le.gz'
        manifest['scenes'].append(dict(source=filename, name=name, layers=layers, reference=file,
                                       rawSha256=write(file, render(values, layers))))

manifest['largeLayers'] = [
    dict(kind='group', opacity=.75, fillOpacity=.625,
         mask=dict(rect=[1000, 0, 8500, 5000], density=.5),
         children=[dict(kind='raster'), dict(kind='adjustment', opacity=.75,
                   mask=dict(rect=[2000, 0, 7000, 5000], density=.5),
                   adjustment=dict(kind='white-balance', temperature=10000, tint=0))]),
    dict(kind='adjustment', clipped=True, opacity=.625,
         mask=dict(rect=[3000, 0, 6000, 5000], density=.5),
         adjustment=dict(kind='white-balance', temperature=4000.5, tint=-100)),
]
manifest['inputs'] = {str(p.relative_to(root)): sha(p.read_bytes()) for p in sorted(inputs)}
manifest['files'] = files
manifest['reference'] = 'Independent Colour Science 0.4.6 Kang/Bradford matrices, numerical tint tangents, NumPy f64/f32 and independent clipping/transfer scene operators. No application, WASM or canvas expected pixels.'
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(dict(pixelCases=len(manifest['pixels']), scenes=len(manifest['scenes']))))
