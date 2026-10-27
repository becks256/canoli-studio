"""Independently read original/output float TIFF with native libtiff, convert
source ICC with native Linux CMM, and evaluate affine/source-over in NumPy.
No Canoli code, WASM, canvas or 8-bit sample reference participates.
"""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,hashlib,json
import numpy as np
p=argparse.ArgumentParser();p.add_argument('output',type=Path);p.add_argument('--source',required=True,type=Path);p.add_argument('--native-lcms',required=True,type=Path);a=p.parse_args();P=C.c_void_p;U=C.c_uint32;lib=C.CDLL(ctypes.util.find_library('tiff'));cms=C.CDLL(str(a.native_lcms.resolve()))
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn(lib,'TIFFClose',[P],None);get=fn(lib,'TIFFGetField',[P,U],C.c_int);is_tiled=fn(lib,'TIFFIsTiled',[P],C.c_int)
class Reader:
 def __init__(self,file):
  self.handle=op(str(file.resolve()).encode(),b'r');assert self.handle
  def scalar(tag,t=U,default=None):
   value=t();found=get(self.handle,tag,C.byref(value));assert found or default is not None,tag;return value.value if found else default
  self.width=scalar(256);self.height=scalar(257)
  assert scalar(258,C.c_uint16)==32 and scalar(277,C.c_uint16)==4 and scalar(339,C.c_uint16)==3 and scalar(284,C.c_uint16)==1 and scalar(262,C.c_uint16)==2
  extra_count=C.c_uint16();extra=P();assert get(self.handle,338,C.byref(extra_count),C.byref(extra))and extra_count.value==1 and C.cast(extra,C.POINTER(C.c_uint16))[0]==2
  self.tiled=bool(is_tiled(self.handle));self.tw=scalar(322)if self.tiled else self.width;self.th=scalar(323)if self.tiled else min(self.height,scalar(278));self.read=fn(lib,'TIFFReadEncodedTile'if self.tiled else'TIFFReadEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t);self.across=(self.width+self.tw-1)//self.tw
  length=U();pointer=P();assert get(self.handle,34675,C.byref(length),C.byref(pointer));self.profile=C.string_at(pointer,length.value);self.band_y=-1;self.band=None
 def rows(self,top,count):
  result=np.empty((count,self.width,4),dtype=np.float32);at=0
  while at<count:
   y=top+at;block_y=y//self.th
   if self.band_y!=block_y:
    height=min(self.th,self.height-block_y*self.th);self.band=np.empty((height,self.width,4),dtype=np.float32)
    for col in range(self.across):
     shape=(self.th if self.tiled else height,self.tw,4);buffer=np.empty(shape,dtype=np.float32);assert self.read(self.handle,block_y*self.across+col,buffer.ctypes.data,-1)==buffer.nbytes;cols=min(self.tw,self.width-col*self.tw);self.band[:,col*self.tw:col*self.tw+cols]=buffer[:height,:cols]
    self.band_y=block_y
   row=y-block_y*self.th;size=min(count-at,self.band.shape[0]-row);result[at:at+size]=self.band[row:row+size];at+=size
  return result
 def close(self):close(self.handle)
source=Reader(a.source);output=Reader(a.output);assert(source.width,source.height)==(output.width,output.height)
expected_profile=(Path(__file__).resolve().parents[1]/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes();assert output.profile==expected_profile,'Complete linear RGB ICC differs'
cp=fn(cms,'cmsOpenProfileFromMem',[P,U],P);pc=fn(cms,'cmsCloseProfile',[P],C.c_int);ct=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);td=fn(cms,'cmsDeleteTransform',[P],None);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None);handles=[cp(C.create_string_buffer(profile),len(profile))for profile in[source.profile,output.profile]];assert all(handles);fmt=(4<<16)|(3<<3)|128|4|(1<<22);transform=ct(handles[0],fmt,handles[1],fmt,1,0x4000000|0x400);assert transform
for h in handles:pc(h)
maximum=0.;alpha_max=0.;samples=0;extended=0;different=0;actual_hash=hashlib.sha256();reference_hash=hashlib.sha256();width=source.width;matrix=np.array([[4,0,0,-.125],[0,4,0,-.25],[0,0,4,.0625]],dtype=np.float64)
try:
 for top in range(0,source.height,64):
  count=min(64,source.height-top);original=source.rows(top,count);linear=np.empty_like(original);apply(transform,original.ctypes.data,linear.ctypes.data,width*count);adjusted=(linear[:,:,:3].astype(np.float64)@matrix[:,:3].T+matrix[:,3]).astype(np.float32).astype(np.float64)
  y,x=np.mgrid[top:top+count,0:width];mask=((x+y*7)%257)/256;sa=linear[:,:,3].astype(np.float64)*.71321*mask;ba=.625;alpha=sa+ba*(1-sa);rgb=(sa[:,:,None]*adjusted+(1-sa)[:,:,None]*ba*np.array([.25,.125,.75]))/alpha[:,:,None];expected=np.concatenate([rgb,alpha[:,:,None]],axis=2).astype(np.float32);actual=output.rows(top,count)
  assert np.isfinite(actual).all();difference=np.abs(actual.astype(np.float64)-expected.astype(np.float64));maximum=max(maximum,float(difference[:,:,:3].max()));alpha_max=max(alpha_max,float(difference[:,:,3].max()));different+=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)));extended+=int(np.count_nonzero((actual[:,:,:3]<0)|(actual[:,:,:3]>1)));samples+=actual.size;actual_hash.update(actual.tobytes());reference_hash.update(expected.tobytes())
finally:source.close();output.close();td(transform)
# Declared absolute float32 rounding bound for this fixture. Alpha is exact.
# Different float64 association is disclosed by both hashes/count, never hidden.
assert maximum<=2**-20 and alpha_max==0 and extended>0,(maximum,alpha_max,extended)
print(json.dumps(dict(width=source.width,height=source.height,samplesCompared=samples,maximumColorError=maximum,maximumAlphaError=alpha_max,nonidenticalFloatWords=different,extendedColorSamples=extended,completeProfileExact=True,actualFloatSha256=actual_hash.hexdigest(),referenceFloatSha256=reference_hash.hexdigest(),sourceSha256=hashlib.sha256(a.source.read_bytes()).hexdigest(),outputBytes=a.output.stat().st_size,outputSha256=hashlib.sha256(a.output.read_bytes()).hexdigest(),reference='Independent native libtiff/Little CMS and NumPy float64 affine/source-over, final float32.')))
