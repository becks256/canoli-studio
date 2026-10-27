"""Independent libtiff/native Linux CMM float fixtures; no Canoli code.
Optional --large streams the genuine 50 MP dcraw_emu RGB16 reference.
"""
from pathlib import Path
import argparse,ctypes as C,ctypes.util,gzip,hashlib,json,struct,zlib
import numpy as np
from PIL import Image
p=argparse.ArgumentParser();p.add_argument('--native-lcms',type=Path,required=True);p.add_argument('--large',action='store_true');a=p.parse_args();root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/tiff-float';out.mkdir(exist_ok=True)
P=C.c_void_p;U=C.c_uint32;lib=C.CDLL(ctypes.util.find_library('tiff'));cms=C.CDLL(str(a.native_lcms.resolve()))
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);field=fn(lib,'TIFFSetField',[P,U],C.c_int);close=fn(lib,'TIFFClose',[P],None);tile=fn(lib,'TIFFWriteEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t);strip=fn(lib,'TIFFWriteEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t);libversion=fn(lib,'TIFFGetVersion',[],C.c_char_p)().decode().splitlines()[0]
assert fn(cms,'cmsGetEncodedCMMversion',[],U)()==2190
cp=fn(cms,'cmsOpenProfileFromMem',[P,U],P);pc=fn(cms,'cmsCloseProfile',[P],C.c_int);ct=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);td=fn(cms,'cmsDeleteTransform',[P],None);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None);fmt=(4<<16)|(3<<3)|128;profiles={n:(root/'tests/fixtures/icc-native'/(n+'.icc')).read_bytes()for n in ['srgb','linear-srgb','display-p3']}
def transform(source,destination,ib,ob):
 hs=[cp(C.create_string_buffer(profiles[n]),len(profiles[n]))for n in[source,destination]];assert all(hs)
 try:t=ct(hs[0],fmt|ib,hs[1],fmt|ob,1,0x4000000|0x400);assert t;return t
 finally:[pc(h)for h in hs]
def write(name,data,*,compression=8,big=False,endian='little',tiled=False,planar=False,predictor=1,photo=2,associated=False,profile='display-p3',orientation=1,compensate=True):
 h,w=data.shape[:2];channels=data.shape[2];handle=op(str(out/(name+'.tif')).encode(),('w'+('8'if big else'')+('b'if endian=='big'else'l')).encode());assert handle;keep=[]
 def setfield(tag,*args):assert field(handle,tag,*args),tag
 try:
  for tag,value in[(256,w),(257,h),(258,32),(259,compression),(262,photo),(274,orientation),(277,channels),(284,2 if planar else 1),(339,3)]:setfield(tag,U(value))
  if predictor!=1:setfield(317,U(predictor))
  if channels==(4 if photo==2 else 2):extra=C.c_uint16(1 if associated else 2);keep.append(extra);setfield(338,U(1),C.byref(extra))
  if profile:buf=C.create_string_buffer(profiles[profile]);keep.append(buf);setfield(34675,U(len(profiles[profile])),C.cast(buf,P))
  if tiled:setfield(322,U(64));setfield(323,U(32))
  else:setfield(278,U(19))
  index=0
  for plane in range(channels if planar else 1):
   values=data[:,:,plane]if planar else data
   for y in range(0,h,32 if tiled else 19):
    for x in range(0,w,64 if tiled else w):
     if tiled:block=np.zeros((32,64)+values.shape[2:],dtype=np.float32);part=values[y:y+32,x:x+64];block[:part.shape[0],:part.shape[1]]=part
     else:block=values[y:y+19].copy()
     block=np.ascontiguousarray(block,dtype=np.float32);
     # libtiff 4.3.0 swabs cross-endian FP input before predictor 3.
     # Compensate the writer input, never the independent decoder/reference.
     if endian=='big'and predictor==3 and compensate:block=block.byteswap()
     assert(tile if tiled else strip)(handle,index,block.ctypes.data,block.nbytes)>=0;index+=1
 finally:close(handle)
 handle=op(str(out/(name+'.tif')).encode(),b'r');assert handle
 try:
  read=fn(lib,'TIFFReadEncodedTile'if tiled else'TIFFReadEncodedStrip',[P,U,P,C.c_ssize_t],C.c_ssize_t);actual=np.empty_like(data);index=0
  for plane in range(channels if planar else 1):
   for y in range(0,h,32 if tiled else 19):
    for x in range(0,w,64 if tiled else w):
     shape=((32,64)if tiled else(min(19,h-y),w))+(()if planar else(channels,));buffer=C.create_string_buffer(int(np.prod(shape))*4);assert read(handle,index,buffer,-1)==len(buffer);block=np.frombuffer(buffer,dtype=np.float32).reshape(shape);rows=min(shape[0],h-y);cols=min(shape[1],w-x)
     if planar:actual[y:y+rows,x:x+cols,plane]=block[:rows,:cols]
     else:actual[y:y+rows,x:x+cols]=block[:rows,:cols]
     index+=1
  assert np.array_equal(actual,data if compensate else data.byteswap(),equal_nan=True),('Independent libtiff writer/readback mismatch',name)
 finally:close(handle)
 return name+'.tif'
def png_reference(data,profile,photo=2,associated=False):
 colors=3 if photo==2 else 1;alpha=data[:,:,colors].astype(np.float64)if data.shape[2]>colors else np.ones(data.shape[:2]);rgb=data[:,:,:colors].astype(np.float64);rgb=1-rgb if photo==0 else rgb
 if associated:rgb=np.divide(rgb,alpha[:,:,None],out=np.zeros_like(rgb),where=alpha[:,:,None]!=0)
 if colors==1:rgb=np.repeat(rgb,3,axis=2)
 rgba=np.ascontiguousarray(np.concatenate([rgb,alpha[:,:,None]],axis=2),dtype=np.float32);result=np.empty(rgba.shape,dtype=np.uint8);t=transform(profile,'srgb',4|(1<<22),1)
 try:apply(t,rgba.ctypes.data,result.ctypes.data,rgba.size//4)
 finally:td(t)
 return result
x,y=np.meshgrid(np.arange(131),np.arange(79));rgba=np.stack([(x*17+y*11)%4096/4096,(x*31+y*29)%4096/4096,(x*13+y*47)%4096/4096,((x+y)%5)/4],axis=2).astype(np.float32);rows=[]
for name,options in[
 ('rgba-raw-le',dict(compression=1)),('rgba-deflate-be',dict(endian='big',big=True)),('rgba-lzw-predictor3',dict(compression=5,predictor=3)),('rgba-deflate-predictor3-be',dict(predictor=3,endian='big',tiled=True)),('rgba-planar-predictor3',dict(predictor=3,planar=True,tiled=True)),('rgba-deflate-predictor2',dict(predictor=2)),('rgba-associated',dict(associated=True,tiled=True)),('rgba-packbits',dict(compression=32773)),('rgb-opaque',dict()),('unprofiled-linear',dict(profile=None)),('gray-linear',dict(profile=None,photo=1)),('gray-white-associated',dict(profile=None,photo=0,associated=True))]:
 data=rgba.copy()
 if name=='rgb-opaque':data=data[:,:,:3].copy()
 if options.get('photo',2)!=2:
  data=np.stack([rgba[:,:,0],rgba[:,:,3]],axis=2)
  if options.get('associated'):data[:,:,0]*=data[:,:,1]
  if options.get('photo')==0:data[:,:,0]=1-data[:,:,0]
 elif options.get('associated'):data[:,:,:3]*=data[:,:,3:4]
 file=write(name,data,**options);source_profile=options.get('profile','display-p3')or'linear-srgb';expected=png_reference(data,source_profile,options.get('photo',2),options.get('associated',False));ref=name+'.png';Image.fromarray(expected,'RGBA').save(out/ref);rows.append({'file':file,'reference':ref,'assumption':None if options.get('profile','display-p3')else'linear-srgb','width':131,'height':79,'profile':source_profile,'options':options})
write('diagnostic-byteswapped-predictor3-be',rgba,endian='big',predictor=3,tiled=True,compensate=False)
for name,value in [('nan',float('nan')),('infinite',float('inf')),('hdr-high',1.5),('hdr-negative',-.125),('alpha-invalid',1.5)]:
 data=rgba.copy();data[2,3,3 if name=='alpha-invalid'else 0]=value;write(name,data)
# Known HDR declarations must reject independently of finite normalized samples.
for name,transfer in [('pq',16),('hlg',18)]:
 original=profiles['srgb'];count=struct.unpack_from('>I',original,128)[0];end=132+12*count;header=bytearray(original[:132]);struct.pack_into('>I',header,128,count+1);table=bytearray()
 for i in range(count):
  signature,offset,length=struct.unpack_from('>4sII',original,132+i*12);table.extend(struct.pack('>4sII',signature,offset+12,length))
 tag=b'cicp'+bytes(4)+bytes([9,transfer,0,1]);profile=header+table+struct.pack('>4sII',b'cicp',len(original)+12,12)+original[end:]+tag;struct.pack_into('>I',profile,0,len(profile));profile[8:12]=bytes([4,0x40,0,0]);profile[84:100]=bytes(16);profiles[name]=bytes(profile);write('hdr-icc-'+name,rgba,profile=name)
large=None
if a.large:
 width=10000;height=5000;tw=2048;th=64;profile=profiles['display-p3'];handle=op(str(out/'native-50mp.tif').encode(),b'w8l');assert handle
 for tag,value in[(256,width),(257,height),(258,32),(259,8),(262,2),(274,1),(277,4),(284,1),(339,3),(317,3),(322,tw),(323,th)]:assert field(handle,tag,U(value))
 extra=C.c_uint16(2);assert field(handle,338,U(1),C.byref(extra));icc=C.create_string_buffer(profile);assert field(handle,34675,U(len(profile)),C.cast(icc,P))
 to_float=transform('linear-srgb','display-p3',2,4|(1<<22));to_proxy=transform('display-p3','srgb',4|(1<<22),1);source_hash=hashlib.sha256();proxy_hash=hashlib.sha256();index=0
 png=open(out/'native-50mp.png','wb');png.write(bytes([137,80,78,71,13,10,26,10]))
 def chunk(kind,data):png.write(struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff))
 chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0));chunk(b'sRGB',bytes([0]));compress=zlib.compressobj()
 try:
  with gzip.open(root/'tests/fixtures/raw/native-50mp.rgb16le.gz','rb')as source:
   for top in range(0,height,th):
    count=min(th,height-top);data=source.read(count*width*6);assert len(data)==count*width*6;source_hash.update(data);rgb=np.frombuffer(data,dtype='<u2').reshape(count,width,3);input_=np.empty((count,width,4),dtype='<u2');input_[:,:,:3]=rgb;input_[:,:,3]=65535;floating=np.empty(input_.shape,dtype=np.float32);apply(to_float,input_.ctypes.data,floating.ctypes.data,count*width);assert np.isfinite(floating).all()and floating.min()>=0 and floating.max()<=1
    proxy=np.empty(input_.shape,dtype=np.uint8);apply(to_proxy,floating.ctypes.data,proxy.ctypes.data,count*width);proxy_hash.update(proxy.tobytes())
    for row in proxy:
     encoded=compress.compress(bytes([0])+row.tobytes())
     if encoded:chunk(b'IDAT',encoded)
    for left in range(0,width,tw):
     block=np.zeros((th,tw,4),dtype=np.float32);part=floating[:,left:left+tw];block[:count,:part.shape[1]]=part;assert tile(handle,index,block.ctypes.data,block.nbytes)>=0;index+=1
   assert not source.read(1)
  chunk(b'IDAT',compress.flush());chunk(b'IEND',bytes())
 finally:png.close();close(handle);td(to_float);td(to_proxy)
 assert source_hash.hexdigest()=='2318a0fdc66bf94cb4e8cc439c6d58158086c7723ecbc32d53c0161dd9d66620'
 large={'file':'native-50mp.tif','reference':'native-50mp.png','width':width,'height':height,'tiles':index,'sourceRgb16Sha256':source_hash.hexdigest(),'expectedRgba8Sha256':proxy_hash.hexdigest(),'floatSamples':width*height*4,'referenceEngine':'Independent native CMM linearRGB16 -> P3float32 -> sRGB8, libtiff predictor-3 output'}
files={p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(out.iterdir())if p.suffix in{'.tif','.png'}}
manifest={'version':1,'libtiff':libversion,'nativeCmm':'Independent Linux Little CMS 2.19.1','nativeCmmSha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':rows,'large':large,'reject':['nan.tif','infinite.tif','hdr-high.tif','hdr-negative.tif','alpha-invalid.tif','hdr-icc-pq.tif','hdr-icc-hlg.tif'],'files':files,'limits':'Synthetic normalized SDR float32, exact independent RGBA8 reference; retained originals do not imply high-precision canvas or HDR tone mapping.'};(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(rows),'rejects':7}))
