"""Independent native libtiff + Linux Little CMS float source references.
No Canoli modules, WASM, canvas or byte proxy participates.
"""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,gzip,hashlib,json
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--native-lcms',type=Path,required=True);p.add_argument('--large',action='store_true');a=p.parse_args();root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-document';out.mkdir(exist_ok=True);inputs=root/'tests/fixtures/tiff-float';P=C.c_void_p;U=C.c_uint32
lib=C.CDLL(ctypes.util.find_library('tiff'));cms=C.CDLL(str(a.native_lcms.resolve()))
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn(lib,'TIFFClose',[P],None);get=fn(lib,'TIFFGetField',[P,U],C.c_int);tiled=fn(lib,'TIFFIsTiled',[P],C.c_int)
cp=fn(cms,'cmsOpenProfileFromMem',[P,U],P);pc=fn(cms,'cmsCloseProfile',[P],C.c_int);ct=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);td=fn(cms,'cmsDeleteTransform',[P],None);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None)
linear=(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes();fmt=(4<<16)|(3<<3)|128|4|(1<<22)
class Reader:
 def __init__(self,file,assumption=None):
  self.handle=op(str(file).encode(),b'r');assert self.handle
  def scalar(tag,t=U,default=None):
   v=t();present=get(self.handle,tag,C.byref(v));assert present or default is not None,tag;return v.value if present else default
  self.width=scalar(256);self.height=scalar(257);self.samples=scalar(277,C.c_uint16);self.planar=scalar(284,C.c_uint16);self.photo=scalar(262,C.c_uint16);assert scalar(258,C.c_uint16)==32 and scalar(339,C.c_uint16)==3
  n=C.c_uint16();value=P();self.alpha=0
  if get(self.handle,338,C.byref(n),C.byref(value)):assert n.value==1;self.alpha=C.cast(value,C.POINTER(C.c_uint16))[0]
  self.is_tiled=bool(tiled(self.handle));self.tw=scalar(322)if self.is_tiled else self.width;self.th=scalar(323)if self.is_tiled else min(self.height,scalar(278));self.across=(self.width+self.tw-1)//self.tw;self.down=(self.height+self.th-1)//self.th
  self.read=fn(lib,'TIFFReadEncodedTile'if self.is_tiled else'TIFFReadEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t);length=U();pointer=P()
  if get(self.handle,34675,C.byref(length),C.byref(pointer)):self.profile=C.string_at(pointer,length.value)
  else:assert assumption in['srgb','linear-srgb'];self.profile=(root/'tests/fixtures/icc-native'/(assumption+'.icc')).read_bytes()
 def bands(self):
  for by in range(self.down):
   rows=min(self.th,self.height-by*self.th);band=np.empty((rows,self.width,self.samples),dtype=np.float32)
   for plane in range(self.samples if self.planar==2 else 1):
    for col in range(self.across):
     channels=1 if self.planar==2 else self.samples;block=np.empty((self.th if self.is_tiled else rows,self.tw,channels),dtype=np.float32);index=plane*self.across*self.down+by*self.across+col;assert self.read(self.handle,index,block.ctypes.data,-1)==block.nbytes;cols=min(self.tw,self.width-col*self.tw)
     if self.planar==2:band[:,col*self.tw:col*self.tw+cols,plane]=block[:rows,:cols,0]
     else:band[:,col*self.tw:col*self.tw+cols]=block[:rows,:cols]
   colors=3 if self.photo==2 else 1;alpha=band[:,:,colors].astype(np.float64)if self.alpha else np.ones((rows,self.width));rgb=band[:,:,:colors].astype(np.float64)
   if self.photo==0:rgb=1-rgb
   if self.alpha==1:rgb=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]!=0)
   if colors==1:rgb=np.repeat(rgb,3,axis=2)
   yield np.ascontiguousarray(np.concatenate([rgb,alpha[:,:,None]],axis=2),dtype=np.float32)
 def close(self):close(self.handle)
rows=[dict(file='hdr-high.tif',assumption=None)];cases=[]
if a.large:rows=rows+[dict(file='native-50mp.tif',assumption=None)]
for row in rows:
 original=inputs/row['file'];reader=Reader(original,row.get('assumption'));handles=[cp(C.create_string_buffer(profile),len(profile))for profile in[reader.profile,linear]];assert all(handles);transform=ct(handles[0],fmt,handles[1],fmt,1,0x4000000|0x400);assert transform
 for handle in handles:pc(handle)
 name=row['file'].removesuffix('.tif')+'-linear.f32le.gz';digest=hashlib.sha256();samples=0
 try:
  with open(out/name,'wb')as raw:
   with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0)as packed:
    for band in reader.bands():
     output=np.empty_like(band);apply(transform,band.ctypes.data,output.ctypes.data,band.size//4);assert np.isfinite(output).all();data=np.ascontiguousarray(output,dtype='<f4').tobytes();packed.write(data);digest.update(data);samples+=output.size
 finally:reader.close();td(transform)
 cases.append(dict(file=row['file'],assumption=row.get('assumption'),width=reader.width,height=reader.height,reference=name,samples=samples,floatSha256=digest.hexdigest(),sourceSha256=hashlib.sha256(original.read_bytes()).hexdigest(),sourceProfileSha256=hashlib.sha256(reader.profile).hexdigest()))
files={p.name:dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())for p in sorted(out.glob('*.gz'))};manifest=dict(version=1,reference='Independent native libtiff float sample readback, native Linux Little CMS float32 original ICC -> linear-sRGB; no 8-bit intermediate.',libtiff=fn(lib,'TIFFGetVersion',[],C.c_char_p)().decode().splitlines()[0],nativeCmmSha256=hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),targetProfileSha256=hashlib.sha256(linear).hexdigest(),cases=cases,files=files);(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(cases),'samples':sum(row['samples']for row in cases)}))
