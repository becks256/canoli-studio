"""Independent complete linear vector output: native libtiff and NumPy only."""
from pathlib import Path
import ctypes as C,ctypes.util,json,sys,hashlib
import numpy as np
root=Path(sys.argv[1]);record=json.loads((root/'float-vector-production.json').read_text())
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int;lib.TIFFReadScanline.argtypes=[P,P,U,C.c_uint16];lib.TIFFReadScanline.restype=C.c_int;lib.TIFFIsTiled.argtypes=[P];lib.TIFFIsTiled.restype=C.c_int;lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
rows=[]
for name in ['vectors','reopened']:
 handle=lib.TIFFOpen(str(root/(name+'.tif')).encode(),b'r');assert handle
 try:
  def scalar(tag,kind=U):
   value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
  w,h=scalar(256),scalar(257);assert (w,h)==(record['width'],record['height'])
  for tag,value in [(258,32),(277,4),(339,3),(284,1)]:assert scalar(tag,C.c_uint16)==value
  count=U();pointer=P();assert lib.TIFFGetField(handle,34675,C.byref(count),C.byref(pointer));assert C.string_at(pointer,count.value)==Path('tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
  actual=np.empty((h,w,4),dtype='<f4')
  if lib.TIFFIsTiled(handle):
   tw,th=scalar(322),scalar(323)
   for y in range(0,h,th):
    for x in range(0,w,tw):
     tile=np.empty((th,tw,4),dtype='<f4');assert lib.TIFFReadEncodedTile(handle,(y//th)*((w+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
     height,width=min(th,h-y),min(tw,w-x);actual[y:y+height,x:x+width]=tile[:height,:width]
  else:
   for y in range(h):assert lib.TIFFReadScanline(handle,actual[y].ctypes.data,y,0)==1
 finally:lib.TIFFClose(handle)
 t=(np.arange(w,dtype=np.float64)+.5)/w
 reference=np.empty_like(actual);reference[:,:,0]=1-t;reference[:,:,1]=0;reference[:,:,2]=t
 # Intrinsic source alpha rounds to Float32 before outer layer Fill/opacity.
 alpha=(record['stopAlpha'][0]+(record['stopAlpha'][1]-record['stopAlpha'][0])*t).astype('<f4')
 reference[:,:,3]=alpha.astype(np.float64)*(record['opacity']*record['fillOpacity'])
 different=int(np.count_nonzero(actual.view(np.uint32)!=reference.view(np.uint32)));assert different==0,(name,different)
 rows.append({'name':name,'words':actual.size,'nonidenticalWords':different,'sha256':hashlib.sha256(actual.tobytes()).hexdigest()})
print(json.dumps({'reference':'Independent native libtiff plus NumPy pixel-center linear gradient, stop alpha and once-only layer Fill/opacity','completeLinearProfileExact':True,'comparisons':rows}))
