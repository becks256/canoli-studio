"""Independent full native clone source-over and affine TIFF/Float32 references."""
from pathlib import Path
import ctypes as C,ctypes.util,hashlib,json,math,sys
import numpy as np
root=Path(sys.argv[1]);record=json.loads((root/'float-clone.json').read_text());scope=record['scope'];w,h=scope['width'],scope['height']
if '--tiff' in sys.argv:
 lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
 lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFClose.argtypes=[P];lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int;lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
 for name in ['native','placed','reopened']:
  handle=lib.TIFFOpen(str(root/(name+'.tif')).encode(),b'r');assert handle
  try:
   def scalar(tag,kind=U):
    value=kind();assert lib.TIFFGetField(handle,tag,C.byref(value));return value.value
   assert (scalar(256),scalar(257))==(w,h)
   for tag,value in [(258,32),(277,4),(339,3),(284,1),(262,2)]:assert scalar(tag,C.c_uint16)==value
   count=U();pointer=P();assert lib.TIFFGetField(handle,34675,C.byref(count),C.byref(pointer));assert C.string_at(pointer,count.value)==Path('tests/fixtures/icc-native/linear-srgb.icc').read_bytes()
   tw,th=scalar(322),scalar(323);out=np.empty((h,w,4),dtype='<f4')
   for y in range(0,h,th):
    for x in range(0,w,tw):
     tile=np.empty((th,tw,4),dtype='<f4');assert lib.TIFFReadEncodedTile(handle,(y//th)*((w+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
     rows,columns=min(th,h-y),min(tw,w-x);out[y:y+rows,x:x+columns]=tile[:rows,:columns]
   (root/(name+'.f32le')).write_bytes(out.tobytes())
  finally:lib.TIFFClose(handle)
source=np.zeros((3,4,4),dtype='<f4');source[1,1]=[4,-2,8,.375];source[1,2]=[16,-8,4,.125]
def sample(x,y,placed):
 if not placed:
  return source[y-19,x-19].copy() if 19<=x<23 and 19<=y<22 else np.zeros(4,dtype='<f4')
 # Padded local native source origin (19,19), current reflected owner placement.
 a,d,e,f=-1.5,.75,80.25,4.5;tx,ty=e+a*19,f+d*19
 left,right=min(tx,tx+a*4),max(tx,tx+a*4);top,bottom=ty,ty+d*3
 coverage=max(0,min(x+1,right)-max(x,left))*max(0,min(y+1,bottom)-max(y,top))
 if not coverage:return np.zeros(4,dtype='<f4')
 u=max(0,min(3,(x+.5-tx)*(1/a)-.5));v=max(0,min(2,(y+.5-ty)*(1/d)-.5));ix,iy=math.floor(u),math.floor(v);fx,fy=u-ix,v-iy;r=g=b=alpha=0.
 for dy in range(2):
  for dx in range(2):
   weight=(fx if dx else 1-fx)*(fy if dy else 1-fy)
   if not weight:continue
   p=source[min(2,iy+dy),min(3,ix+dx)];amount=float(p[3])*weight;alpha+=amount;r+=float(p[0])*amount;g+=float(p[1])*amount;b+=float(p[2])*amount
 return np.array([r/alpha,g/alpha,b/alpha,alpha*coverage],dtype='<f4') if alpha>0 else np.zeros(4,dtype='<f4')
def composite(pixel):
 # The clone first enters its own editable PaintLayer, then the red backdrop.
 sa=float(np.float32(float(pixel[3])*.64123));keep=.5*(1-sa);alpha=sa+keep
 return np.array([(float(pixel[0])*sa+keep)/alpha,float(pixel[1])*sa/alpha,float(pixel[2])*sa/alpha,alpha],dtype='<f4')
comparisons=[]
for name,placed in [('native',False),('placed',True),('reopened',True)]:
 expected=np.array([[composite(sample(scope['x']+x,scope['y']+y,placed)) for x in range(w)]for y in range(h)],dtype='<f4');raw=(root/(name+'.f32le')).read_bytes();actual=np.frombuffer(raw,dtype='<f4').reshape(h,w,4);different=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)));assert different==0,(name,different,float(np.max(np.abs(actual-expected))))
 comparisons.append({'name':name,'words':actual.size,'nonidenticalFloatWords':different,'sha256':hashlib.sha256(raw).hexdigest()})
print(json.dumps({'reference':'Independent NumPy native source alpha, premultiplied bilinear affine filtering and once-only unquantized opacity/source-over; libtiff for production originals','scope':scope,'comparisons':comparisons}))
