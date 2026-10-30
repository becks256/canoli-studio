"""Independent native libtiff readback and Pillow float-plane EXIF orientation.

The source samples come from the existing independent Linux-CMM corpus.
Pillow transposes each float32 channel without reducing its sample precision.
"""
import argparse
import ctypes as C
import ctypes.util
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps

p=argparse.ArgumentParser()
p.add_argument('output',type=Path)
p.add_argument('--orientation',type=int,required=True,choices=range(1,9))
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
folder=root/'tests/fixtures/uint16-float'
manifest=json.loads((folder/'manifest.json').read_text())
case=next(row for row in manifest['cases']if row['file']=='u16-raw.tif')
raw=gzip.decompress((folder/case['reference']).read_bytes())
assert hashlib.sha256(raw).hexdigest()==case['floatSha256']
source=np.frombuffer(raw,dtype='<f4').reshape(case['height'],case['width'],4).copy()
source[source[:,:,3]==0,:3]=0 # Scene source-over, distinct from the raw source API.
planes=[]
for channel in range(4):
    plane=Image.fromarray(source[:,:,channel])
    plane.getexif()[274]=a.orientation
    planes.append(np.asarray(ImageOps.exif_transpose(plane),dtype='<f4'))
expected=np.ascontiguousarray(np.stack(planes,axis=2),dtype='<f4')
height,width,_=expected.shape
lib=C.CDLL(ctypes.util.find_library('tiff'))
def fn(name,args,result):
    value=getattr(lib,name);value.argtypes=args;value.restype=result;return value
P=C.c_void_p;U=C.c_uint32
op=fn('TIFFOpen',[C.c_char_p,C.c_char_p],P)
close=fn('TIFFClose',[P],None)
get=fn('TIFFGetField',[P,U],C.c_int)
scan=fn('TIFFReadScanline',[P,P,U,C.c_uint16],C.c_int)
handle=op(str(a.output.resolve()).encode(),b'r');assert handle
try:
    def scalar(tag,kind=U):
        value=kind();assert get(handle,tag,C.byref(value));return value.value
    assert (scalar(256),scalar(257))==(width,height)
    assert scalar(258,C.c_uint16)==32 and scalar(339,C.c_uint16)==3
    assert scalar(277,C.c_uint16)==4 and scalar(262,C.c_uint16)==2
    length=U();pointer=P();assert get(handle,34675,C.byref(length),C.byref(pointer))
    assert C.string_at(pointer,length.value)==(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
    actual=np.empty_like(expected)
    if fn('TIFFIsTiled',[P],C.c_int)(handle):
        tw=scalar(322);th=scalar(323)
        tile=np.empty((th,tw,4),dtype='<f4')
        read_tile=fn('TIFFReadTile',[P,P,U,U,U,C.c_uint16],C.c_ssize_t)
        for y in range(0,height,th):
            for x in range(0,width,tw):
                assert read_tile(handle,tile.ctypes.data,x,y,0,0)==tile.nbytes
                h=min(th,height-y);w=min(tw,width-x)
                actual[y:y+h,x:x+w]=tile[:h,:w]
    else:
        for y in range(height):assert scan(handle,actual[y].ctypes.data,y,0)==1
finally:close(handle)
assert np.isfinite(actual).all()
error=np.abs(actual.astype(np.float64)-expected.astype(np.float64))
scaled=error[:,:,:3]/np.maximum(1,np.abs(expected[:,:,:3].astype(np.float64)))
alpha=int(np.count_nonzero(actual[:,:,3].copy().view('<u4')!=expected[:,:,3].copy().view('<u4')))
different=int(np.count_nonzero(actual.view('<u4')!=expected.view('<u4')))
assert scaled.max()<=2**-22 and alpha==0,(scaled.max(),alpha)
print(json.dumps({'orientation':a.orientation,'width':width,'height':height,'samplesCompared':int(actual.size),'nonidenticalWords':different,'maximumColorError':float(scaled.max()),'alphaWordsDifferent':alpha,'completeProfileExact':True,'actualSampleSha256':hashlib.sha256(actual.tobytes()).hexdigest(),'referenceSampleSha256':hashlib.sha256(expected.tobytes()).hexdigest(),'reference':'Independent native libtiff complete float32 output; Linux CMM source corpus and Pillow float-plane EXIF orientation.'}))
