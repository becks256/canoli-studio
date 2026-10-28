"""Read complete blend output TIFF/PNG files independently with libtiff/Pillow.
Expected colors come from separately generated NumPy native-scene references.
"""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,gzip,hashlib,json
import numpy as np
p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('--context',default='raster');p.add_argument('--mode',required=True);p.add_argument('--precision',choices=['float32','uint16','uint8'],default='float32');p.add_argument('--native-lcms',type=Path,required=True);p.add_argument('--display-reference',action='store_true');a=p.parse_args()
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/float-blend';m=json.loads((folder/'manifest.json').read_text());case=next(x for x in m['cases']if x['context']==a.context and x['mode']==a.mode);packed=(folder/case['reference']).read_bytes();sha=lambda b:hashlib.sha256(b).hexdigest();assert sha(packed)==m['files'][case['reference']]['sha256'];raw=gzip.decompress(packed);assert sha(raw)==case['rawSha256'];expected=np.frombuffer(raw,dtype='<f4').reshape(m['height'],m['width'],4).copy();height,width=expected.shape[:2]
assert sha(a.native_lcms.read_bytes())=='dc021a3a70e82f88eadff2deff512d155f846a87935658f5313d7cbb3ef9bcc6'
P=C.c_void_p;U=C.c_uint32

def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
profile=(root/'tests/fixtures/icc-native'/('srgb.icc'if a.precision=='uint8'else'linear-srgb.icc')).read_bytes();dtype={'float32':np.dtype('<f4'),'uint16':np.dtype('<u2'),'uint8':np.dtype('u1')}[a.precision]
cms=C.CDLL(str(a.native_lcms.resolve()));op=fn(cms,'cmsOpenProfileFromMem',[P,U],P);close=fn(cms,'cmsCloseProfile',[P],C.c_int);create=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None);delete=fn(cms,'cmsDeleteTransform',[P],None);profiles=[]
try:
 for data in[(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes(),profile]:profiles.append(op(C.create_string_buffer(data),len(data)))
 assert all(profiles);base=(4<<16)|(3<<3)|128;transform=create(profiles[0],base|4|(1<<22),profiles[1],base|dtype.itemsize|((1<<22)if a.precision=='float32'else 0),1,0x4000000|0x400);assert transform
 try:converted=np.empty(expected.shape,dtype=dtype);apply(transform,expected.ctypes.data,converted.ctypes.data,width*height)
 finally:delete(transform)
finally:
 for handle in profiles:
  if handle:close(handle)
if a.display_reference:
 assert a.precision=='uint8';a.output.write_bytes(converted.tobytes());print(json.dumps(dict(width=width,height=height,sha256=sha(converted.tobytes()))));raise SystemExit
if a.output.suffix.lower()=='.png':
 from PIL import Image
 image=Image.open(a.output);assert image.size==(width,height)and image.info['icc_profile']==profile;actual=np.asarray(image.convert('RGBA'));image.close()
else:
 lib=C.CDLL(ctypes.util.find_library('tiff'));open_=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);get=fn(lib,'TIFFGetField',[P,U],C.c_int);finish=fn(lib,'TIFFClose',[P],None);read=fn(lib,'TIFFReadEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t);handle=open_(str(a.output.resolve()).encode(),b'r');assert handle
 try:
  def scalar(tag,kind=U,default=None):
   value=kind();found=get(handle,tag,C.byref(value));assert found or default is not None;return value.value if found else default
  assert(scalar(256),scalar(257))==(width,height);assert scalar(258,C.c_uint16)==dtype.itemsize*8;assert scalar(339,C.c_uint16,1)==(3 if a.precision=='float32'else 1);assert scalar(277,C.c_uint16)==4 and scalar(284,C.c_uint16)==1
  length=U();data=P();assert get(handle,34675,C.byref(length),C.byref(data));assert C.string_at(data,length.value)==profile
  count=C.c_uint16();extra=P();assert get(handle,338,C.byref(count),C.byref(extra))and count.value==1 and C.cast(extra,C.POINTER(C.c_uint16))[0]==2
  tw=scalar(322);th=scalar(323);actual=np.empty(converted.shape,dtype=dtype);across=(width+tw-1)//tw
  for y in range(0,height,th):
   for x in range(0,width,tw):
    tile=np.empty((th,tw,4),dtype=dtype);assert read(handle,(y//th)*across+x//tw,tile.ctypes.data,-1)==tile.nbytes;h=min(th,height-y);w=min(tw,width-x);actual[y:y+h,x:x+w]=tile[:h,:w]
 finally:finish(handle)
assert np.isfinite(actual).all();delta=np.abs(actual.astype(np.float64)-converted.astype(np.float64));assert delta.max()==0,(a.mode,float(delta.max()),int(np.count_nonzero(delta)))
print(json.dumps(dict(context=a.context,mode=a.mode,precision=a.precision,width=width,height=height,samplesCompared=int(actual.size),maximumError=float(delta.max()),nonidenticalWords=int(np.count_nonzero(delta)),actualSampleSha256=sha(actual.tobytes()),referenceSampleSha256=sha(converted.tobytes()),outputBytes=a.output.stat().st_size,outputSha256=sha(a.output.read_bytes()),completeProfileExact=True)))
