"""Independently decode actual output with native libtiff; compare every float
word against the separately generated native CMM reference, without Canoli."""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,gzip,hashlib,json
import numpy as np
p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('--source-name',required=True);a=p.parse_args();root=Path(__file__).resolve().parents[1];fixtures=root/'tests/fixtures/float-source';manifest=json.loads((fixtures/'manifest.json').read_text());case=next(row for row in manifest['cases']if row['file']==a.source_name);reference=fixtures/case['reference'];assert hashlib.sha256(reference.read_bytes()).hexdigest()==manifest['files'][reference.name]['sha256']
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn('TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn('TIFFClose',[P],None);get=fn('TIFFGetField',[P,U],C.c_int);read=fn('TIFFReadEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t);handle=op(str(a.output.resolve()).encode(),b'r');assert handle
def scalar(tag,t=U):
 v=t();assert get(handle,tag,C.byref(v)),tag;return v.value
samples=0;different=0;maximum=0.;digest=hashlib.sha256()
try:
 width=scalar(256);height=scalar(257);assert(width,height)==(case['width'],case['height']);assert scalar(258,C.c_uint16)==32 and scalar(277,C.c_uint16)==4 and scalar(339,C.c_uint16)==3 and scalar(284,C.c_uint16)==1 and scalar(262,C.c_uint16)==2
 count=C.c_uint16();ptr=P();assert get(handle,338,C.byref(count),C.byref(ptr))and count.value==1 and C.cast(ptr,C.POINTER(C.c_uint16))[0]==2
 length=U();assert get(handle,34675,C.byref(length),C.byref(ptr));profile=C.string_at(ptr,length.value);assert profile==(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes();tw=scalar(322);th=scalar(323);across=(width+tw-1)//tw
 with gzip.open(reference,'rb')as expected:
  for top in range(0,height,th):
   rows=min(th,height-top);band=np.empty((rows,width,4),dtype='<f4')
   for col in range(across):
    tile=np.empty((th,tw,4),dtype=np.float32);assert read(handle,(top//th)*across+col,tile.ctypes.data,-1)==tile.nbytes;cols=min(tw,width-col*tw);band[:,col*tw:col*tw+cols]=tile[:rows,:cols]
   raw=band.tobytes();other=expected.read(len(raw));assert len(other)==len(raw);ref=np.frombuffer(other,dtype='<f4').reshape(band.shape);assert np.isfinite(band).all();different+=int(np.count_nonzero(band.view('<u4')!=ref.view('<u4')));maximum=max(maximum,float(np.abs(band.astype(np.float64)-ref.astype(np.float64)).max()));samples+=band.size;digest.update(raw)
  assert expected.read(1)==b''
finally:close(handle)
assert samples==case['samples']and different==0 and maximum==0 and digest.hexdigest()==case['floatSha256'],(samples,different,maximum,digest.hexdigest())
print(json.dumps(dict(width=width,height=height,samplesCompared=samples,nonidenticalFloatWords=different,maximumError=maximum,actualFloatSha256=digest.hexdigest(),referenceFloatSha256=case['floatSha256'],completeProfileExact=True,outputBytes=a.output.stat().st_size,outputSha256=hashlib.sha256(a.output.read_bytes()).hexdigest(),reference=manifest['reference'])))
