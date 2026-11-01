"""Independent complete native retouch output: libtiff plus NumPy, no editor."""
from pathlib import Path
import ctypes as C,ctypes.util,json,sys,hashlib,gzip
import numpy as np
root=Path(sys.argv[1]);record=json.loads((root/'float-retouch-production.json').read_text());w,h=record['width'],record['height']
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int;lib.TIFFReadScanline.argtypes=[P,P,U,C.c_uint16];lib.TIFFReadScanline.restype=C.c_int;lib.TIFFIsTiled.argtypes=[P];lib.TIFFIsTiled.restype=C.c_int;lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
fixture=Path('tests/fixtures/float-retouch');clean=np.frombuffer(gzip.decompress((fixture/'clean-original.f32.gz').read_bytes()),dtype='<f4').reshape(h,w,4);original=np.frombuffer(gzip.decompress((fixture/'damaged-original.f32.gz').read_bytes()),dtype='<f4').reshape(h,w,4);yy,xx=np.mgrid[:h,:w];outside=(xx<120)|(xx>136)|(yy<88)|(yy>104);rows=[];repaired={}
for name in ['patched','healed','reopened']:
 handle=lib.TIFFOpen(str(root/(name+'.tif')).encode(),b'r');assert handle
 try:
  def scalar(tag,kind=U):
   value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
  assert(scalar(256),scalar(257))==(w,h)
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
 # 13-wide Dirichlet rectangle: barrier gives inverse infinity norm <=24.5.
 # Include Float32 storage rounding after the default absolute 1e-7 solve.
 error=float(np.max(np.abs(actual[:,:,:3].astype(np.float64)-clean[:,:,:3])));bound=24.5e-7+2**-20
 assert error<=bound,(name,error,bound)
 assert np.array_equal(actual[:,:,3].view(np.uint32),original[:,:,3].view(np.uint32))
 assert np.array_equal(actual[outside].view(np.uint32),original[outside].view(np.uint32))
 repaired[name]=actual;rows.append({'name':name,'words':int(actual.size),'maxRgbError':error,'equationAndStorageBound':bound,'alphaExact':True,'outsideExact':True,'sha256':hashlib.sha256(actual.tobytes()).hexdigest()})
assert np.array_equal(repaired['healed'].view(np.uint32),repaired['reopened'].view(np.uint32))
print(json.dumps({'reference':'Independent NumPy periodic clean field with damaged interior, native libtiff complete TIFF decode','completeLinearProfileExact':True,'reopenedExact':True,'comparisons':rows}))
