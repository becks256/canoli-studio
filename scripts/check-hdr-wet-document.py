"""Independent original/native TIFF and NumPy reference for public HDR replay."""
from pathlib import Path
import ctypes as C, ctypes.util, gzip, hashlib, json, sys
import numpy as np

root=Path(__file__).resolve().parents[1];directory=Path(sys.argv[1])
width,height=131,79
manifest=json.loads((root/'tests/fixtures/float-source/manifest.json').read_text())
case=next(row for row in manifest['cases'] if row['file']=='rgba-raw-le.tif')
packed=(root/'tests/fixtures/float-source'/case['reference']).read_bytes()
assert hashlib.sha256(packed).hexdigest()==manifest['files'][case['reference']]['sha256']
original=np.frombuffer(gzip.decompress(packed),dtype='<f4').copy().reshape(height,width,4)
original[original[:,:,3]==0,:3]=0
if (directory/'before.f32le').exists():
 before=np.frombuffer((directory/'before.f32le').read_bytes(),dtype='<f4').reshape(original.shape)
 assert np.array_equal(before.view(np.uint32),original.view(np.uint32)), 'Original scene differs from independent native reference'
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P
lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int
lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
profile=(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
def read(name,width=2,height=1):
 handle=lib.TIFFOpen(str(directory/name).encode(),b'r');assert handle
 try:
  def scalar(tag,kind=U):
   value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
  assert (scalar(256),scalar(257))==(width,height)
  for tag,value in [(258,32),(339,3),(277,4),(284,1),(262,2)]:assert scalar(tag,C.c_uint16)==value
  length=U();pointer=P();assert lib.TIFFGetField(handle,34675,C.byref(length),C.byref(pointer));assert C.string_at(pointer,length.value)==profile
  count=C.c_uint16();assert lib.TIFFGetField(handle,338,C.byref(count),C.byref(pointer));assert count.value==1 and C.cast(pointer,C.POINTER(C.c_uint16))[0]==2
  tw,th=scalar(322),scalar(323);output=np.empty((height,width,4),dtype='<f4')
  for y in range(0,height,th):
   for x in range(0,width,tw):
    tile=np.empty((th,tw,4),dtype='<f4');assert lib.TIFFReadEncodedTile(handle,(y//th)*((width+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
    rows,columns=min(th,height-y),min(tw,width-x);output[y:y+rows,x:x+columns]=tile[:rows,:columns]
  return output
 finally:lib.TIFFClose(handle)
pixels,coverage=read('pixels.tif'),read('coverage.tif')
assert np.array_equal(pixels,np.array([[[4,-2,8,.375],[16,-8,4,.125]]],dtype='<f4'))
assert np.array_equal(coverage,np.array([[[0,0,0,.5],[0,0,0,.75]]],dtype='<f4'))
expected=original.copy();opacity=.625
for col in range(2):
 y,x=4,3+col;prior=original[y,x].astype(np.float64);source=pixels[0,col].astype(np.float64);removal=float(coverage[0,col,3]);keep=1-opacity*removal
 alpha=float(prior[3])*keep+float(source[3])*opacity
 expected[y,x,3]=alpha;expected[y,x,:3]=(prior[:3]*float(prior[3])*keep+source[:3]*float(source[3])*opacity)/alpha
checks=[]
names=['after','reopened'] if (directory/'after.f32le').exists() else ['production','redo','reopened']
if (directory/'before.tif').exists():assert np.array_equal(read('before.tif',width,height).view(np.uint32),original.view(np.uint32))
for name in names:
 data=(directory/(name+'.f32le')).read_bytes() if (directory/(name+'.f32le')).exists() else read(name+'.tif',width,height).tobytes()
 actual=np.frombuffer(data,dtype='<f4').reshape(expected.shape)
 different=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)));assert different==0,(name,different)
 checks.append({'name':name,'words':actual.size,'nonidenticalFloatWords':different,'sha256':hashlib.sha256(data).hexdigest()})
print(json.dumps({'reference':'Independent native libtiff, fixture CMM and NumPy Float64 composition then Float32 store','nativeOriginalDimensions':[width,height],'originalWordsExact':original.size,'completePairWords':pixels.size+coverage.size,'completeLinearProfileExact':True,'comparisons':checks}))
