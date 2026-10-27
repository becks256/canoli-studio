"""Independent unsigned TIFF -> normalized float32 -> native Linux CMM oracle.

libtiff writes and rereads all original integer words. Double-precision
normalization/unassociation precedes float32 rounding and native ICC conversion.
No editor decoder, WASM, canvas or byte proxy supplies expected values.
"""
from pathlib import Path
import argparse, ctypes as C, ctypes.util, gzip, hashlib, json
import numpy as np
p=argparse.ArgumentParser()
p.add_argument('--native-lcms',type=Path,required=True)
p.add_argument('--large',action='store_true')
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/uint16-float';out.mkdir(exist_ok=True)
P=C.c_void_p;U=C.c_uint32
lib=C.CDLL(ctypes.util.find_library('tiff'));cms=C.CDLL(str(a.native_lcms.resolve()))
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P)
field=fn(lib,'TIFFSetField',[P,U],C.c_int);get=fn(lib,'TIFFGetField',[P,U],C.c_int)
close=fn(lib,'TIFFClose',[P],None)
cp=fn(cms,'cmsOpenProfileFromMem',[P,U],P);pc=fn(cms,'cmsCloseProfile',[P],C.c_int)
ct=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);td=fn(cms,'cmsDeleteTransform',[P],None)
apply=fn(cms,'cmsDoTransform',[P,P,P,U],None)
profiles={n:(root/'tests/fixtures/icc-native'/(n+'.icc')).read_bytes()for n in ['srgb','linear-srgb','display-p3']}
fmt=(4<<16)|(3<<3)|128|4|(1<<22)

def samples(width,top,rows,photo,associated,opaque=False,ramp=False):
 x=np.arange(width,dtype=np.uint32)[None,:];y=np.arange(top,top+rows,dtype=np.uint32)[:,None]
 if width==10000:
  # Original dimensions are 50 MP. Periodic synthetic colors keep artifacts
  # portable; this fixture is not a photographic-quality/performance claim.
  red=np.broadcast_to((x%256*193+(y%16)*257)%65536,(rows,width))
 else:red=(x+y*width if ramp else x*313+y*997)%65536
 green=(red*73+103)%65536;blue=(red*271+17)%65536
 alpha=np.full((rows,width),65535,dtype=np.uint32)if opaque or ramp else np.broadcast_to((x+y)%5*16383,(rows,width)).copy()
 alpha[(x+y)%5==4]=65535 if not opaque and not ramp else 65535
 rgb=np.stack([red,green,blue],axis=2)
 if photo!=2:rgb=rgb[:,:,:1]
 if associated:rgb=(rgb.astype(np.uint64)*alpha[:,:,None]//65535).astype(np.uint32)
 if photo==0:rgb=65535-rgb
 return np.ascontiguousarray(rgb if opaque else np.concatenate([rgb,alpha[:,:,None]],axis=2),dtype=np.uint16)

cases=[]
def generate(name,*,width=131,height=79,photo=2,associated=False,opaque=False,ramp=False,profile='display-p3',compression=8,predictor=1,planar=False,tiled=False,big=False,endian='little',omit_format=False):
 file=out/(name+'.tif');channels=(3 if photo==2 else 1)+(0 if opaque else 1)
 tw=256 if tiled else width;th=32 if tiled else 19
 across=(width+tw-1)//tw;down=(height+th-1)//th
 write=fn(lib,'TIFFWriteEncodedTile'if tiled else'TIFFWriteEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t)
 handle=op(str(file).encode(),('w'+('8'if big else'')+('b'if endian=='big'else'l')).encode());assert handle
 keep=[]
 try:
  for tag,value in [(256,width),(257,height),(258,16),(259,compression),(262,photo),(274,1),(277,channels),(284,2 if planar else 1)]+([]if omit_format else[(339,1)]):assert field(handle,tag,U(value)),tag
  if predictor!=1:assert field(handle,317,U(predictor))
  if not opaque:
   extra=C.c_uint16(1 if associated else 2);keep.append(extra);assert field(handle,338,U(1),C.byref(extra))
  if profile:
   buf=C.create_string_buffer(profiles[profile]);keep.append(buf);assert field(handle,34675,U(len(profiles[profile])),C.cast(buf,P))
  if tiled:assert field(handle,322,U(tw))and field(handle,323,U(th))
  else:assert field(handle,278,U(th))
  index=0
  for plane in range(channels if planar else 1):
   for top in range(0,height,th):
    rows=min(th,height-top);band=samples(width,top,rows,photo,associated,opaque,ramp)
    for col in range(across):
     cols=min(tw,width-col*tw);block=np.zeros((th if tiled else rows,tw,1 if planar else channels),dtype=np.uint16)
     part=band[:,col*tw:col*tw+cols,plane:plane+1]if planar else band[:,col*tw:col*tw+cols]
     block[:rows,:cols]=part;assert write(handle,index,block.ctypes.data,block.nbytes)>=0;index+=1
 finally:close(handle)
 # Read original words independently of the writer buffers, then convert.
 handle=op(str(file).encode(),b'r');assert handle
 read=fn(lib,'TIFFReadEncodedTile'if tiled else'TIFFReadEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t)
 source=profiles[profile or 'linear-srgb'];handles=[cp(C.create_string_buffer(b),len(b))for b in[source,profiles['linear-srgb']]];assert all(handles)
 transform=ct(handles[0],fmt,handles[1],fmt,1,0x4000000|0x400);assert transform
 for h in handles:pc(h)
 reference=name+'-linear.f32le.gz';digest=hashlib.sha256();original_digest=hashlib.sha256()
 try:
  with open(out/reference,'wb')as raw:
   with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0)as packed:
    for by in range(down):
     rows=min(th,height-by*th);band=np.empty((rows,width,channels),dtype=np.uint16)
     for plane in range(channels if planar else 1):
      for col in range(across):
       block=np.empty((th if tiled else rows,tw,1 if planar else channels),dtype=np.uint16)
       assert read(handle,plane*across*down+by*across+col,block.ctypes.data,-1)==block.nbytes
       cols=min(tw,width-col*tw)
       if planar:band[:,col*tw:col*tw+cols,plane]=block[:rows,:cols,0]
       else:band[:,col*tw:col*tw+cols]=block[:rows,:cols]
     assert np.array_equal(band,samples(width,by*th,rows,photo,associated,opaque,ramp)),name
     original_digest.update(np.ascontiguousarray(band,dtype='<u2').tobytes())
     values=band.astype(np.float64)/65535
     colors=3 if photo==2 else 1;rgb=values[:,:,:colors];alpha=np.ones((rows,width))if opaque else values[:,:,colors]
     if photo==0:rgb=1-rgb
     if associated:rgb=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]!=0)
     if colors==1:rgb=np.repeat(rgb,3,axis=2)
     input_=np.ascontiguousarray(np.concatenate([rgb,alpha[:,:,None]],axis=2),dtype=np.float32)
     result=np.empty_like(input_);apply(transform,input_.ctypes.data,result.ctypes.data,rows*width)
     assert np.isfinite(result).all();data=np.ascontiguousarray(result,dtype='<f4').tobytes();packed.write(data);digest.update(data)
 finally:close(handle);td(transform)
 cases.append(dict(file=file.name,width=width,height=height,samples=width*height*4,reference=reference,floatSha256=digest.hexdigest(),originalWordSha256=original_digest.hexdigest(),sourceSha256=hashlib.sha256(file.read_bytes()).hexdigest(),sourceProfileSha256=hashlib.sha256(source).hexdigest(),assumption=None if profile else'linear-srgb'))

for name,options in [
 ('u16-raw',dict(compression=1,omit_format=True)),
 ('u16-deflate-be',dict(endian='big',big=True,predictor=2)),
 ('u16-lzw-predictor2',dict(compression=5,predictor=2)),
 ('u16-planar-tiled',dict(planar=True,tiled=True,predictor=2)),
 ('u16-packbits',dict(compression=32773)),
 ('u16-associated',dict(associated=True,tiled=True)),
 ('u16-gray-black',dict(photo=1,profile=None,predictor=2)),
 ('u16-gray-white-associated',dict(photo=0,profile=None,associated=True,planar=True,tiled=True,predictor=2,endian='big')),
 ('u16-rgb-opaque',dict(opaque=True,profile='srgb')),
 ('u16-all-levels',dict(width=256,height=256,ramp=True,profile='linear-srgb',tiled=True,predictor=2)),
]:generate(name,**options)
if a.large:generate('u16-native-50mp',width=10000,height=5000,profile='linear-srgb',opaque=True,tiled=True,predictor=2,big=True)
files={f.name:dict(bytes=f.stat().st_size,sha256=hashlib.sha256(f.read_bytes()).hexdigest())for f in sorted(out.iterdir())if f.suffix in['.gz','.tif']}
manifest=dict(version=1,reference='Independent libtiff original uint16 readback; float64 normalization/unassociation, float32 rounding, native Linux Little CMS RGB -> linear-sRGB. No byte intermediate.',nativeCmmSha256=hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),libtiff=fn(lib,'TIFFGetVersion',[],C.c_char_p)().decode().splitlines()[0],cases=cases,files=files)
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(dict(cases=len(cases),samples=sum(c['samples']for c in cases),bytes=sum(f['bytes']for f in files.values()))))
