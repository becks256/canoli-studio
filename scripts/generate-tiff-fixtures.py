"""Independent TIFF fixtures from system libtiff, Pillow and NumPy; no editor codec."""
import ctypes as C
import ctypes.util
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageCms,features,__version__
out=Path('tests/fixtures/tiff');out.mkdir(exist_ok=True)
lib=C.CDLL(ctypes.util.find_library('tiff'))
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=C.c_void_p
lib.TIFFSetField.argtypes=[C.c_void_p,C.c_uint32];lib.TIFFSetField.restype=C.c_int
lib.TIFFWriteEncodedStrip.argtypes=[C.c_void_p,C.c_uint32,C.c_void_p,C.c_ssize_t];lib.TIFFWriteEncodedStrip.restype=C.c_ssize_t
lib.TIFFWriteEncodedTile.argtypes=lib.TIFFWriteEncodedStrip.argtypes;lib.TIFFWriteEncodedTile.restype=C.c_ssize_t
lib.TIFFClose.argtypes=[C.c_void_p]
y,x=np.indices((173,211));rgba=np.stack([(x*37+y*7)%256,(y*29+x*3)%256,(x^y)%256,(x*13+y*17)%256],axis=2).astype('uint8');rgb=rgba[:,:,:3].copy();gray=((x*251+y*113)%65536).astype('uint16')
manifest=[]
def write(name,data,compression=1,big=False,endian='little',tile=False,planar=False,predictor=False,orientation=1,associated=False,icc=False):
 h,w=data.shape[:2];samples=data.shape[2]if data.ndim==3 else 1;bits=data.dtype.itemsize*8;path=out/(name+'.tif');handle=lib.TIFFOpen(str(path).encode(),('w'+('8'if big else '')+('b'if endian=='big' else 'l')).encode());assert handle
 keep=[]
 def field(tag,*args):assert lib.TIFFSetField(handle,tag,*args)
 try:
  for tag,value in [(256,w),(257,h),(258,bits),(259,compression),(262,2 if samples>=3 else 1),(274,orientation),(277,samples),(284,2 if planar else 1)]:field(tag,C.c_uint32(value))
  if predictor:field(317,C.c_uint32(2))
  if samples==4:
   extra=C.c_uint16(1 if associated else 2);keep.append(extra);field(338,C.c_uint32(1),C.byref(extra))
  if icc:
   profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes();buf=C.create_string_buffer(profile);keep.append(buf);field(34675,C.c_uint32(len(profile)),C.cast(buf,C.c_void_p))
  if tile:field(322,C.c_uint32(64));field(323,C.c_uint32(32))
  else:field(278,C.c_uint32(37))
  index=0
  for plane in range(samples if planar else 1):
   source=data[:,:,plane]if planar else data
   for top in range(0,h,32 if tile else 37):
    for left in range(0,w,64 if tile else w):
     if tile:
      block=np.zeros((32,64)+source.shape[2:],dtype=source.dtype);piece=source[top:top+32,left:left+64];block[:piece.shape[0],:piece.shape[1]]=piece
     else:block=source[top:top+37].copy()
     block=np.ascontiguousarray(block);encoded=lib.TIFFWriteEncodedTile if tile else lib.TIFFWriteEncodedStrip
     assert encoded(handle,index,block.ctypes.data,block.nbytes)>=0;index+=1
 finally:lib.TIFFClose(handle)
 # Reference encoded samples before native canvas premultiplication (browser tests compare premultiplied pixels separately).
 if bits==16:ref=((data.astype(np.uint32)*255+32767)//65535).astype('uint8');ref=np.stack([ref,ref,ref,np.full_like(ref,255)],axis=2)
 elif samples==3:ref=np.concatenate([data,np.full((h,w,1),255,dtype='uint8')],axis=2)
 else:
  ref=data.copy()
  if associated:
   a=ref[:,:,3].astype(float);ref[:,:,:3]=np.clip(np.floor(np.divide(ref[:,:,:3].astype(float)*255,a[:,:,None],out=np.zeros((h,w,3)),where=a[:,:,None]!=0)+.5),0,255).astype('uint8')
 reference=out/(name+'.png');Image.fromarray(ref,'RGBA').save(reference)
 manifest.append({'file':path.name,'reference':reference.name,'width':w,'height':h,'orientation':orientation,'allowPrecisionLoss':bits==16,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'big':big})
for codec in [1,5,8,32773]:write('rgba-'+str(codec),rgba,compression=codec)
write('big-tiled-deflate',rgba,compression=8,big=True,tile=True,predictor=True,icc=True)
write('big-endian-lzw',rgb,compression=5,endian='big',predictor=True)
write('planar-deflate',rgba,compression=8,planar=True,predictor=True,tile=True)
write('gray16-le',gray,compression=8,predictor=True)
write('gray16-be',gray,compression=5,predictor=True,endian='big')
premult=rgba.copy();premult[:,:,:3]=((rgba[:,:,:3].astype(np.uint32)*rgba[:,:,3:4]+127)//255).astype('uint8');write('associated',premult,compression=5,associated=True)
for orientation in range(2,9):write('orientation-'+str(orientation),rgb,compression=8,orientation=orientation)
# Packed palette, bilevel/min-is-white, and multipage samples use independent Pillow encoding.
for name,image in [('palette',Image.fromarray(((x+y)%16).astype('uint8'),'P')),('bilevel',Image.fromarray(((x+y)%2*255).astype('uint8')).convert('1'))]:
 if name=='palette':image.putpalette([v for i in range(256) for v in (i,255-i,(i*17)%256)])
 path=out/(name+'.tif');image.save(path,compression='packbits');reference=out/(name+'.png');image.convert('RGBA').save(reference);manifest.append({'file':path.name,'reference':reference.name,'width':211,'height':173,'orientation':1,'allowPrecisionLoss':False,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'big':False})
Image.fromarray(rgb).save(out/'multipage.tif',save_all=True,append_images=[Image.fromarray(rgb[::-1].copy()),Image.fromarray(rgb[:,::-1].copy())],compression='tiff_lzw')
(out/'manifest.json').write_text(json.dumps({'generator':'system libtiff/Pillow/NumPy','pillow':__version__,'libtiff':features.version_codec('libtiff'),'cases':manifest},indent=2)+'\n')
print('Generated',len(manifest),'independent TIFF cases plus multipage')
