"""Read real TIFF delivery with native libtiff, independently of editor decoders."""
import ctypes as C
import ctypes.util
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

lib = C.CDLL(ctypes.util.find_library('tiff'))
def function(name, args, result):
    value = getattr(lib, name)
    value.argtypes, value.restype = args, result
    return value

pointer, integer = C.c_void_p, C.c_uint32
op = function('TIFFOpen', [C.c_char_p, C.c_char_p], pointer)
close = function('TIFFClose', [pointer], None)
get = function('TIFFGetField', [pointer, integer], C.c_int)
tile_read = function('TIFFReadEncodedTile', [pointer, integer, pointer, C.c_ssize_t], C.c_ssize_t)
profile = (Path(__file__).resolve().parents[1] / 'tests/fixtures/icc-native/linear-srgb.icc').read_bytes()

def read(path):
    handle = op(str(Path(path).resolve()).encode(), b'r')
    assert handle, path
    try:
        def scalar(tag, kind=integer):
            value = kind()
            assert get(handle, tag, C.byref(value)), tag
            return value.value
        width, height = scalar(256), scalar(257)
        assert (width, height) == (131, 79)
        assert scalar(258, C.c_uint16) == 32 and scalar(339, C.c_uint16) == 3
        assert scalar(277, C.c_uint16) == 4 and scalar(284, C.c_uint16) == 1
        count, data = C.c_uint16(), pointer()
        assert get(handle, 338, C.byref(count), C.byref(data)) and count.value == 1
        assert C.cast(data, C.POINTER(C.c_uint16))[0] == 2  # unassociated alpha
        length = integer()
        assert get(handle, 34675, C.byref(length), C.byref(data))
        assert C.string_at(data, length.value) == profile
        tw, th = scalar(322), scalar(323)
        output = np.empty((height, width, 4), dtype=np.float32)
        for y in range(0, height, th):
            for x in range(0, width, tw):
                tile = np.empty((th, tw, 4), dtype=np.float32)
                index = (y // th) * ((width + tw - 1) // tw) + x // tw
                assert tile_read(handle, index, tile.ctypes.data, -1) == tile.nbytes
                rows, cols = min(th, height - y), min(tw, width - x)
                output[y:y+rows, x:x+cols] = tile[:rows, :cols]
        assert np.isfinite(output).all()
        assert ((output[:, :, 3] >= 0) & (output[:, :, 3] <= 1)).all()
        return output
    finally:
        close(handle)

before, brushed, after, reopened = [read(path) for path in sys.argv[1:]]
assert np.array_equal(after.view(np.uint32), reopened.view(np.uint32)), 'Reopened delivery changed native words'
visible = (before[:, :, 3] > 0) & (after[:, :, 3] > 0)
assert visible.any()
assert np.array_equal(before[:, :, :3][visible].view(np.uint32), after[:, :, :3][visible].view(np.uint32)), 'Mask editing changed visible float RGB'
assert (after[:, :, 3] <= before[:, :, 3]).all(), 'Hide increased coverage'
assert (brushed[:, :, 3] <= before[:, :, 3]).all() and (after[:, :, 3] <= brushed[:, :, 3]).all()
brush_changed = np.count_nonzero(before[:, :, 3].view(np.uint32) != brushed[:, :, 3].view(np.uint32))
pencil_changed = np.count_nonzero(brushed[:, :, 3].view(np.uint32) != after[:, :, 3].view(np.uint32))
assert brush_changed > 0 and pencil_changed > 0, 'Both Brush and Pencil must change actual native coverage'
changed = np.count_nonzero(before[:, :, 3].view(np.uint32) != after[:, :, 3].view(np.uint32))
assert changed > 0, 'No edited coverage'
assert (after[:, :, :3][visible] > 1).any(), 'HDR witness missing'
alpha = after[:, :, 3][visible]
assert (alpha != (np.round(alpha * 255) / 255).astype(np.float32)).any(), 'Alpha was quantized to byte precision'
print(json.dumps({'reader': 'native libtiff', 'width': 131, 'height': 79, 'precision': 'float32',
    'profile': 'linear-srgb', 'changedAlphaSamples': int(changed), 'brushChangedAlphaSamples': int(brush_changed),
    'pencilChangedAlphaSamples': int(pencil_changed), 'visibleColorWordsExact': True,
    'reopenedWordsExact': True, 'hdr': True, 'subByteAlpha': True,
    'editedSamplesSha256': hashlib.sha256(after.tobytes()).hexdigest()}))
