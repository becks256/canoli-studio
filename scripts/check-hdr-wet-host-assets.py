"""Read complete browser-host originals with native libtiff, independently of Canoli."""
from pathlib import Path
import ctypes as C, ctypes.util, gzip, hashlib, json, sys
import numpy as np

root = Path(__file__).resolve().parents[1]
directory = Path(sys.argv[1])
record = json.loads((directory / 'hdr-host-assets.json').read_text())
lib = C.CDLL(ctypes.util.find_library('tiff'))
P, U = C.c_void_p, C.c_uint32
lib.TIFFOpen.argtypes = [C.c_char_p, C.c_char_p]; lib.TIFFOpen.restype = P
lib.TIFFClose.argtypes = [P]
lib.TIFFGetField.argtypes = [P, U]; lib.TIFFGetField.restype = C.c_int
lib.TIFFReadEncodedTile.argtypes = [P, U, P, C.c_ssize_t]; lib.TIFFReadEncodedTile.restype = C.c_ssize_t
profile = (root / 'tests/fixtures/icc-native/linear-srgb.icc').read_bytes()

def read(name):
    handle = lib.TIFFOpen(str(directory / name).encode(), b'r'); assert handle
    try:
        def scalar(tag, kind=U):
            value = kind(); assert lib.TIFFGetField(handle, tag, C.byref(value)); return value.value
        w, h = scalar(256), scalar(257)
        assert (w, h) == (131, 79)
        for tag, expected in [(258, 32), (339, 3), (277, 4), (284, 1), (262, 2)]:
            assert scalar(tag, C.c_uint16) == expected
        count, pointer = C.c_uint16(), P()
        assert lib.TIFFGetField(handle, 338, C.byref(count), C.byref(pointer)) and count.value == 1
        assert C.cast(pointer, C.POINTER(C.c_uint16))[0] == 2
        length = U(); assert lib.TIFFGetField(handle, 34675, C.byref(length), C.byref(pointer))
        assert C.string_at(pointer, length.value) == profile
        tw, th = scalar(322), scalar(323); out = np.empty((h, w, 4), dtype='<f4')
        for y in range(0, h, th):
            for x in range(0, w, tw):
                tile = np.empty((th, tw, 4), dtype='<f4')
                assert lib.TIFFReadEncodedTile(handle, (y // th) * ((w + tw - 1) // tw) + x // tw, tile.ctypes.data, -1) == tile.nbytes
                rows, cols = min(th, h-y), min(tw, w-x); out[y:y+rows, x:x+cols] = tile[:rows, :cols]
        return out
    finally:
        lib.TIFFClose(handle)

packed = root / 'tests/fixtures/hdr-wet-field/codec.bin.gz'
manifest = json.loads((packed.parent / 'manifest.json').read_text())
assert hashlib.sha256(packed.read_bytes()).hexdigest() == manifest['files']['codec']['sha256']
original = np.frombuffer(gzip.decompress(packed.read_bytes()), dtype='<f4').reshape(79, 131, 4)
color, coverage = read('color.tif'), read('coverage.tif')
assert np.array_equal(color.view(np.uint32), original.view(np.uint32))
expected_coverage = np.zeros_like(original); expected_coverage[:, :, 3] = np.minimum(1, original[:, :, 3].astype(np.float64) + .125)
assert np.array_equal(coverage.view(np.uint32), expected_coverage.view(np.uint32))
expected = np.zeros((79, 131, 5), dtype='<f8')
for y in range(79):
    for x in range(131):
        a, c = float(color[y, x, 3]), float(coverage[y, x, 3]); assert a <= c
        if c == 0: continue
        expected[y, x, :3] = color[y, x, :3].astype(np.float64) * a if a else 0
        expected[y, x, 3:] = a, c
checks = []
for name in ['field', 'expected', 'retry']:
    data = (directory / (name + '.f64le')).read_bytes(); actual = np.frombuffer(data, dtype='<f8').reshape(expected.shape)
    assert np.array_equal(actual.view(np.uint64), expected.view(np.uint64)), name
    checks.append({'name': name, 'words': actual.size, 'sha256': hashlib.sha256(data).hexdigest(), 'nonidenticalWords': 0})
print(json.dumps({'reference': 'Independent native libtiff and NumPy', 'dimensions': [131, 79], 'completeOriginalWords': color.size + coverage.size, 'completeProfileExact': True, 'comparisons': checks}))
