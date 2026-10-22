"""Test-only independent native PNG sample comparison for recent-file reopening."""
import sys, json, hashlib
from PIL import Image

reference=Image.open(sys.argv[1]).convert('RGBA')
actual=Image.open(sys.argv[2]).convert('RGBA')
assert reference.size==actual.size
digest=hashlib.sha256()
for y in range(0,reference.height,64):
    box=(0,y,reference.width,min(reference.height,y+64))
    expected=reference.crop(box).tobytes()
    pixels=actual.crop(box).tobytes()
    assert pixels==expected, f'Native RGBA samples differ at row {y}'
    digest.update(pixels)
print(json.dumps({'reader':'Pillow','size':list(reference.size),'rgbaExact':True,'rgbaSha256':digest.hexdigest()}))
