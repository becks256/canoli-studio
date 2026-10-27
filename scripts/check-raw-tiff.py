"""Independent libtiff + native Linux Little CMS check of every native sample.
Reads TIFF's decoded native tile layout (never 8-bit RGBA convenience APIs),
and dcraw_emu's independently developed RGB16 source. No Canoli code is used.
"""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,gzip,hashlib,json
import numpy as np
p=argparse.ArgumentParser();p.add_argument('tiff',type=Path);p.add_argument('--rgb16',type=Path,required=True);p.add_argument('--width',type=int,required=True);p.add_argument('--height',type=int,required=True);p.add_argument('--channels',type=int,default=3);p.add_argument('--profile',type=Path,required=True);p.add_argument('--native-lcms',type=Path,required=True);p.add_argument('--float',action='store_true');p.add_argument('--lens-json',type=Path);a=p.parse_args()
P=C.c_void_p;U=C.c_uint32;H=C.c_uint16;lib=C.CDLL(ctypes.util.find_library('tiff'));cms=C.CDLL(str(a.native_lcms.resolve()))
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
version=fn(lib,'TIFFGetVersion',[],C.c_char_p)().decode();op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn(lib,'TIFFClose',[P],None);field=fn(lib,'TIFFGetField',[P,U],C.c_int);size=fn(lib,'TIFFTileSize64',[P],C.c_uint64);read=fn(lib,'TIFFReadEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t)
assert fn(cms,'cmsGetEncodedCMMversion',[],U)()==2190
open_profile=fn(cms,'cmsOpenProfileFromMem',[P,U],P);close_profile=fn(cms,'cmsCloseProfile',[P],C.c_int);create=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);delete=fn(cms,'cmsDeleteTransform',[P],None);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None)
root=Path(__file__).resolve().parents[1];source_profile=(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes();destination=a.profile.read_bytes();handles=[]
for data in[source_profile,destination]:
 h=open_profile(C.create_string_buffer(data),len(data));assert h;handles.append(h)
fmt=(4<<16)|(3<<3)|128;outfmt=fmt|4|(1<<22)if a.float else fmt|2;transform=create(handles[0],fmt|2,handles[1],outfmt,1,0x4000000|0x400);assert transform
handle=op(str(a.tiff).encode(),b'r');assert handle
lens=json.loads(a.lens_json.read_text())if a.lens_json else None

def scalar(tag,type_):
 v=type_();assert field(handle,tag,C.byref(v)),tag;return v.value

def correct(source,settings):
 # Independent float64 inverse geometry and bilinear source sampling. Preserve
 # uint16 color before ICC, and exactly the established 8-bit coverage policy.
 height,width,_=source.shape;cx=width*settings.get('center',{}).get('x',.5)-.5;cy=height*settings.get('center',{}).get('y',.5)-.5;norm=min(width,height)*.5;diagonal=(width*width+height*height)*.25
 y,x=np.mgrid[0:height,0:width].astype(np.float64);u=(x-cx)/(norm*settings.get('scale',1));v=(y-cy)/(norm*settings.get('scale',1));r2=u*u+v*v;d=settings.get('distortion',{});vg=settings.get('vignette',{});factor=1+r2*(d.get('k1',0)+r2*(d.get('k2',0)+r2*d.get('k3',0)));coverage=np.ones((height,width));result=np.zeros((height,width,4),dtype='<u2')
 for c,scale in enumerate([settings.get('chromatic',{}).get('red',1),1,settings.get('chromatic',{}).get('blue',1)]):
  xx=cx+u*factor*norm*scale;yy=cy+v*factor*norm*scale;left=np.floor(xx).astype(np.int64);top=np.floor(yy).astype(np.int64);fx=xx-left;fy=yy-top;total=np.zeros_like(xx);weight_sum=np.zeros_like(xx)
  for j in range(2):
   for i in range(2):
    sx=left+i;sy=top+j;weight=(fx if i else 1-fx)*(fy if j else 1-fy);valid=(sx>=0)&(sx<width)&(sy>=0)&(sy<height)&(weight!=0);sx=np.clip(sx,0,width-1);sy=np.clip(sy,0,height-1);radius2=((sx-cx)**2+(sy-cy)**2)/diagonal;attenuation=1+radius2*(vg.get('k1',0)+radius2*(vg.get('k2',0)+radius2*vg.get('k3',0)))
    total+=np.where(valid,weight*source[sy,sx,min(c,a.channels-1)]/attenuation,0);weight_sum+=np.where(valid,weight,0)
  result[:,:,c]=np.floor(np.clip(np.divide(total,weight_sum,out=np.zeros_like(total),where=weight_sum!=0),0,65535)+.5).astype('<u2');coverage=np.minimum(coverage,weight_sum)
 result[:,:,3]=np.floor(np.clip(coverage,0,1)*255+.5).astype('<u2')*257;result[:,:,:3][result[:,:,3]==0]=0
 return result
try:
 width=scalar(256,U);height=scalar(257,U);bits=scalar(258,H);samples=scalar(277,H);sample_format=scalar(339,H);tw=scalar(322,U);th=scalar(323,U)
 assert(width,height)==(a.width,a.height);assert bits==(32 if a.float else 16)and samples==4 and sample_format==(3 if a.float else 1)
 assert scalar(259,H)==8 and scalar(262,H)==2 and scalar(284,H)==1
 extra_count=H();extra=P();assert field(handle,338,C.byref(extra_count),C.byref(extra))and extra_count.value==1 and C.cast(extra,C.POINTER(H))[0]==2
 icc_size=U();icc=P();assert field(handle,34675,C.byref(icc_size),C.byref(icc));assert C.string_at(icc,icc_size.value)==destination
 max_rgb=0.;max_alpha=0.;tiles=0;compared=0;distinct=[set(),set(),set()];sha=hashlib.sha256();source_sha=hashlib.sha256();dtype='<f4'if a.float else'<u2';tile_bytes=size(handle)
 opener=gzip.open if a.rgb16.suffix=='.gz'else open
 with opener(a.rgb16,'rb')as source:
  if lens:
   data=source.read();source_sha.update(data);plane=np.frombuffer(data,dtype='<u2').reshape(height,width,a.channels);corrected=correct(plane,lens)
  for y in range(0,height,th):
   rows=min(th,height-y)
   if lens:band=corrected[y:y+rows]
   else:
    data=source.read(rows*width*a.channels*2);assert len(data)==rows*width*a.channels*2;source_sha.update(data);rgb=np.frombuffer(data,dtype='<u2').reshape(rows,width,a.channels);band=np.empty((rows,width,4),dtype='<u2');band[:,:,:3]=np.repeat(rgb,3,axis=2)if a.channels==1 else rgb;band[:,:,3]=65535
   for c in range(3):distinct[c].update(np.unique(band[:,:,c]).tolist())
   for x in range(0,width,tw):
    cols=min(tw,width-x);buffer=C.create_string_buffer(tile_bytes);assert read(handle,tiles,buffer,-1)==tile_bytes
    actual=np.frombuffer(buffer,dtype=dtype).reshape(th,tw,4);input_=np.ascontiguousarray(band[:,x:x+cols]);expected=np.zeros((th,tw,4),dtype=dtype);out=np.empty((rows,cols,4),dtype=dtype);apply(transform,input_.ctypes.data,out.ctypes.data,rows*cols);expected[:rows,:cols]=out
    difference=np.abs(actual.astype(np.float64)-expected.astype(np.float64));max_rgb=max(max_rgb,float(np.max(difference[:,:,:3])));max_alpha=max(max_alpha,float(np.max(difference[:,:,3])));sha.update(actual.tobytes());tiles+=1;compared+=rows*cols*4
  assert not source.read(1)
 assert max_alpha==0;assert max_rgb<=(0.000002 if a.float else 1 if lens else 0),(max_rgb,max_alpha)
 result={'decoder':version.splitlines()[0],'reference':'Independent Linux Little CMS 2.19.1 over dcraw_emu RGB16; NumPy lens equations if requested','referenceLibrarySha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),'width':width,'height':height,'bits':bits,'sampleFormat':sample_format,'tiles':tiles,'samplesCompared':compared,'maximumColorError':max_rgb,'maximumAlphaError':max_alpha,'sourceChannelLevels':[len(v)for v in distinct],'sourceRgb16Sha256':source_sha.hexdigest(),'completeProfileExact':True,'paddedTilesSha256':sha.hexdigest(),'limits':'Synthetic native source/correctness checks; not scene precision, physical photographic quality, sustained throughput or peak-memory acceptance.'};print(json.dumps(result))
finally:close(handle);delete(transform);[close_profile(h)for h in handles]
