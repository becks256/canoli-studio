"""Independent native libtiff/NumPy reference for trusted float wet publication."""
from pathlib import Path
import ctypes as C, ctypes.util, gzip, hashlib, json, sys
import numpy as np

root=Path(__file__).resolve().parents[1];directory=Path(sys.argv[1]);record=json.loads((directory/'hdr-authoring.json').read_text());scope=record['scope'];width,height=scope['width'],scope['height']
manifest=json.loads((root/'tests/fixtures/float-source/manifest.json').read_text());case=next(row for row in manifest['cases'] if row['file']=='rgba-raw-le.tif');packed=(root/'tests/fixtures/float-source'/case['reference']).read_bytes();assert hashlib.sha256(packed).hexdigest()==manifest['files'][case['reference']]['sha256']
original=np.frombuffer(gzip.decompress(packed),dtype='<f4').reshape(case['height'],case['width'],4)[scope['y']:scope['y']+height,scope['x']:scope['x']+width].copy();original[original[:,:,3]==0,:3]=0
before=np.frombuffer((directory/'before.f32le').read_bytes(),dtype='<f4').reshape(height,width,4);assert np.array_equal(before.view(np.uint32),original.view(np.uint32))
lib=C.CDLL(ctypes.util.find_library('tiff'));P,U=C.c_void_p,C.c_uint32
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int;lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
profile=(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
def read(entry):
 handle=lib.TIFFOpen(str(directory/entry['file']).encode(),b'r');assert handle
 try:
  def scalar(tag,kind=U):
   value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
  w,h=scalar(256),scalar(257);assert (w,h)==(entry['region']['width'],entry['region']['height'])
  for tag,value in [(258,32),(339,3),(277,4),(284,1),(262,2)]:assert scalar(tag,C.c_uint16)==value
  length=U();pointer=P();assert lib.TIFFGetField(handle,34675,C.byref(length),C.byref(pointer));assert C.string_at(pointer,length.value)==profile
  count=C.c_uint16();assert lib.TIFFGetField(handle,338,C.byref(count),C.byref(pointer));assert count.value==1 and C.cast(pointer,C.POINTER(C.c_uint16))[0]==2
  tw,th=scalar(322),scalar(323);out=np.empty((h,w,4),dtype='<f4')
  for y in range(0,h,th):
   for x in range(0,w,tw):
    tile=np.empty((th,tw,4),dtype='<f4');assert lib.TIFFReadEncodedTile(handle,(y//th)*((w+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
    rows,columns=min(th,h-y),min(tw,w-x);out[y:y+rows,x:x+columns]=tile[:rows,:columns]
  assert np.isfinite(out).all() and ((out[:,:,3]>=0)&(out[:,:,3]<=1)).all();return out
 finally:lib.TIFFClose(handle)
expected=before.copy();files=record['files'];asset_words=0
for index in range(0,len(files),2):
 color,coverage=read(files[index]),read(files[index+1]);assert files[index]['kind']=='pixels' and files[index+1]['kind']=='coverage';assert (color[:,:,3]<=coverage[:,:,3]).all();asset_words+=color.size+coverage.size
 region=files[index]['region']
 for row in range(region['height']):
  for col in range(region['width']):
   y,x=region['y']+row-scope['y'],region['x']+col-scope['x'];c=float(coverage[row,col,3]);assert c in [0,1]
   if c and 0<=y<height and 0<=x<width:
    expected[y,x]=color[row,col]
    if expected[y,x,3]==0:expected[y,x]=0
    else:expected[y,x,:3][expected[y,x,:3]==0]=0
after=np.frombuffer((directory/'after.f32le').read_bytes(),dtype='<f4').reshape(height,width,4)
# Size-2 solid pencil fully covers this pixel. Native load/mix store float32,
# then the once-only selection/opacity envelope evaluates in float64.
pixel=before[4,3].astype(np.float64);paint=np.array([4,-2,8,.375],dtype='<f4').astype(np.float64);opacity=record['opacity'];a=float(pixel[3])*(1-opacity);b=float(paint[3])*opacity;alpha=a+b
center=np.array([*((pixel[:3]*a+paint[:3]*b)/alpha),alpha],dtype='<f4');assert np.array_equal(after[4,3].view(np.uint32),center.view(np.uint32)),(after[4,3],center)
comparisons=[]
for name in ['after','reopened']:
 data=(directory/(name+'.f32le')).read_bytes();actual=np.frombuffer(data,dtype='<f4').reshape(height,width,4);different=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)));assert different==0,(name,different);comparisons.append({'name':name,'words':actual.size,'nonidenticalFloatWords':different,'sha256':hashlib.sha256(data).hexdigest()})
assert np.any((after[:,:,:3]<0)|(after[:,:,:3]>1))
print(json.dumps({'reference':'Independent libtiff and NumPy, full native prepared replay plus known full-coverage load/mix/envelope pixel','scope':scope,'sourceWindowExact':True,'preparedAssetWords':asset_words,'completeLinearProfileExact':True,'center':center.tolist(),'centerExact':True,'comparisons':comparisons}))
