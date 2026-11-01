"""Independent NumPy equations for complete mixed-paint native/affine windows."""
from pathlib import Path
import hashlib,json,math,sys
import numpy as np
root=Path(sys.argv[1]);record=json.loads((root/'float-wet-paint.json').read_text());s=record['scope']
def local(x,y):
 p=np.array([1,0,0,.375] if 0<=x<16 and 0<=y<12 else [0,0,0,0],dtype='<f4')
 if y==4:
  for left,envelope in [(3,.64123),(-3,.375)]:
   if left<=x<left+2:
    color,alpha,coverage=([4,-2,8],.375,.5) if x==left else ([16,-8,4],.125,.75)
    keep=float(p[3])*(1-coverage*envelope);a=alpha*envelope+keep
    p=np.array([*((np.array(color,dtype=np.float64)*alpha*envelope+p[:3].astype(np.float64)*keep)/a),a],dtype='<f4')
  if x==3:p[3]=float(p[3])*(1-.125)
  if x==4:
   back=float(p[3])*.75;a=.25+back;p=np.array([float(p[0])*back/a,float(p[1])*back/a,(.25+float(p[2])*back)/a,a],dtype='<f4')
 if p[3]==0:p[:]=0
 return p
if '--tiff' in sys.argv:
 import ctypes as C,ctypes.util
 lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
 lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int;lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
 profile=Path('tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
 for name in ['native','placed','reopened']:
  handle=lib.TIFFOpen(str(root/(name+'.tif')).encode(),b'r');assert handle
  try:
   def scalar(tag,kind=U):
    value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
   w,h=scalar(256),scalar(257);assert (w,h)==(s['width'],s['height'])
   for tag,value in [(258,32),(277,4),(339,3),(284,1),(262,2)]:assert scalar(tag,C.c_uint16)==value
   count=U();pointer=P();assert lib.TIFFGetField(handle,34675,C.byref(count),C.byref(pointer));assert C.string_at(pointer,count.value)==profile
   tw,th=scalar(322),scalar(323);out=np.empty((h,w,4),dtype='<f4')
   for y in range(0,h,th):
    for x in range(0,w,tw):
     tile=np.empty((th,tw,4),dtype='<f4');assert lib.TIFFReadEncodedTile(handle,(y//th)*((w+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
     rows,columns=min(th,h-y),min(tw,w-x);out[y:y+rows,x:x+columns]=tile[:rows,:columns]
   (root/(name+'.f32le')).write_bytes(out.tobytes())
  finally:lib.TIFFClose(handle)
native=np.array([[local(s['x']+x,s['y']+y) for x in range(s['width'])]for y in range(s['height'])],dtype='<f4')
placed=np.zeros(native.shape,dtype='<f4')
for row in range(s['height']):
 for col in range(s['width']):
  u=(s['x']+col+.5-55.25)/-1.5-.5;v=(s['y']+row+.5-10.5)/.75-.5
  x,y=math.floor(u),math.floor(v);fx,fy=u-x,v-y;r=g=b=a=0.
  for dy in range(2):
   for dx in range(2):
    weight=(fx if dx else 1-fx)*(fy if dy else 1-fy)
    if not weight:continue
    pixel=local(x+dx,y+dy);alpha=float(pixel[3])*weight;a+=alpha;r+=float(pixel[0])*alpha;g+=float(pixel[1])*alpha;b+=float(pixel[2])*alpha
  if a>0:placed[row,col]=[r/a,g/a,b/a,a]
comparisons=[]
for name,expected in [('native',native),('placed',placed),('reopened',placed)]:
 raw=(root/(name+'.f32le')).read_bytes();actual=np.frombuffer(raw,dtype='<f4').reshape(expected.shape);different=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)))
 assert different==0,(name,different,np.max(np.abs(actual-expected)))
 comparisons.append({'name':name,'words':actual.size,'nonidenticalFloatWords':different,'sha256':hashlib.sha256(raw).hexdigest()})
print(json.dumps({'reference':'Independent NumPy source-over, HDR premultiplied pigment/removal, clear and bilinear reflection/scale equations','scope':s,'comparisons':comparisons}))
