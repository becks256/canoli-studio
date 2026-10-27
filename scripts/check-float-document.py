"""Independent complete-file oracle for an original float document + exposure.

Reads the separately generated native CMM reference, applies exact power-of-two
exposure, canonicalizes transparent composition, and converts directly with the
pinned Linux CMM. Native libtiff, Pillow and MuPDF read actual file samples.
No editor code, browser canvas, WASM or editor decoder supplies expected values.
"""
from pathlib import Path
import argparse, ctypes as C, ctypes.util, gzip, hashlib, json, re
import numpy as np

p=argparse.ArgumentParser()
p.add_argument('output',type=Path)
p.add_argument('--source-name',required=True)
p.add_argument('--native-lcms',type=Path,required=True)
p.add_argument('--precision',choices=['uint8','uint16','float32'],default='float32')
p.add_argument('--profile',default='linear-srgb')
p.add_argument('--exposure',type=int,default=1)
p.add_argument('--tone',action='append',type=json.loads,default=[],help='Ordered original-space tone settings; replaces exposure-only reference when supplied')
p.add_argument('--clipping',type=json.loads,help='Independent sibling clipping scene; replaces exposure/tone-only reference')
p.add_argument('--page',type=int,default=0)
p.add_argument('--pages',type=int)
a=p.parse_args()
root=Path(__file__).resolve().parents[1]
fixtures=root/'tests/fixtures/float-source'
manifest=json.loads((fixtures/'manifest.json').read_text())
for directory in ['float-document','uint16-float']:
 if any(row['file']==a.source_name for row in manifest['cases']):break
 fixtures=root/'tests/fixtures'/directory
 manifest=json.loads((fixtures/'manifest.json').read_text())
case=next(row for row in manifest['cases']if row['file']==a.source_name)
reference=fixtures/case['reference']
assert hashlib.sha256(reference.read_bytes()).hexdigest()==manifest['files'][reference.name]['sha256']
assert hashlib.sha256(a.native_lcms.read_bytes()).hexdigest()==manifest['nativeCmmSha256']
P=C.c_void_p; U=C.c_uint32
def fn(lib,name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
profile=(root/'tests/fixtures/icc-native'/(a.profile+'.icc')).read_bytes()
dtype={'uint8':np.dtype('u1'),'uint16':np.dtype('<u2'),'float32':np.dtype('<f4')}[a.precision]
width=case['width'];height=case['height'];extension=a.output.suffix.lower()
handle=None;image=None;document=None
if extension in ['.tif','.tiff']:
 lib=C.CDLL(ctypes.util.find_library('tiff'))
 op=fn(lib,'TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn(lib,'TIFFClose',[P],None);get=fn(lib,'TIFFGetField',[P,U],C.c_int)
 handle=op(str(a.output.resolve()).encode(),b'r');assert handle
 assert 0<=a.page<65536
 if a.pages is not None:assert fn(lib,'TIFFNumberOfDirectories',[P],C.c_uint16)(handle)==a.pages
 assert fn(lib,'TIFFSetDirectory',[P,C.c_uint16],C.c_int)(handle,a.page)
 def scalar(tag,t=U,default=None):
  v=t();found=get(handle,tag,C.byref(v));assert found or default is not None,tag;return v.value if found else default
 assert(scalar(256),scalar(257))==(width,height)
 assert scalar(258,C.c_uint16)==dtype.itemsize*8 and scalar(339,C.c_uint16,1)==(3 if a.precision=='float32'else 1)
 assert scalar(277,C.c_uint16)==4 and scalar(284,C.c_uint16)==1 and scalar(262,C.c_uint16)==2
 count=C.c_uint16();ptr=P();assert get(handle,338,C.byref(count),C.byref(ptr))and count.value==1 and C.cast(ptr,C.POINTER(C.c_uint16))[0]==2
 length=U();assert get(handle,34675,C.byref(length),C.byref(ptr));assert C.string_at(ptr,length.value)==profile
 tw=scalar(322);th=scalar(323);across=(width+tw-1)//tw
 read=fn(lib,'TIFFReadEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t)
 def rows(top,count):
  band=np.empty((count,width,4),dtype=dtype)
  for col in range(across):
   tile=np.empty((th,tw,4),dtype=dtype);assert read(handle,(top//th)*across+col,tile.ctypes.data,-1)==tile.nbytes
   cols=min(tw,width-col*tw);band[:,col*tw:col*tw+cols]=tile[:count,:cols]
  return band
elif extension=='.png':
 assert a.page==0 and a.pages is None
 from PIL import Image
 Image.MAX_IMAGE_PIXELS=None;image=Image.open(a.output)
 assert image.size==(width,height)and image.info['icc_profile']==profile and a.precision=='uint8'
 th=64
 def rows(top,count):return np.asarray(image.crop((0,top,width,top+count)).convert('RGBA'))
elif extension=='.pdf':
 assert a.page==0 and a.pages is None
 import pymupdf
 document=pymupdf.open(a.output);assert not document.is_repaired and len(document)==1 and a.precision=='uint8'
 xref,mask,w,h=document[0].get_images(full=True)[0][:4];assert(w,h)==(width,height)
 profile_xref=int(re.search(r'/ICCBased\s+(\d+)\s+0\s+R',document.xref_object(xref)).group(1))
 assert document.xref_stream(profile_xref)==profile
 rgb=document.xref_stream(xref);alpha=document.xref_stream(mask)if mask else bytes([255])*width*height
 th=64
 def rows(top,count):
  band=np.empty((count,width,4),dtype=np.uint8)
  band[:,:,:3]=np.frombuffer(rgb,dtype=np.uint8,count=count*width*3,offset=top*width*3).reshape(count,width,3)
  band[:,:,3]=np.frombuffer(alpha,dtype=np.uint8,count=count*width,offset=top*width).reshape(count,width)
  return band
else:raise ValueError('Use TIFF, PNG or PDF')
cms=C.CDLL(str(a.native_lcms.resolve()))
cp=fn(cms,'cmsOpenProfileFromMem',[P,U],P);pc=fn(cms,'cmsCloseProfile',[P],C.c_int)
ct=fn(cms,'cmsCreateTransform',[P,U,P,U,U,U],P);td=fn(cms,'cmsDeleteTransform',[P],None);apply=fn(cms,'cmsDoTransform',[P,P,P,U],None)
handles=[]
for data in[(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes(),profile]:
 handles.append(cp(C.create_string_buffer(data),len(data)))
assert all(handles)
base=(4<<16)|(3<<3)|128
transform=ct(handles[0],base|4|(1<<22),handles[1],base|dtype.itemsize|((1<<22)if a.precision=='float32'else 0),1,0x4000000|0x400);assert transform
for value in handles:pc(value)
clipping_reference=None
if a.clipping is not None:
 import runpy
 assert isinstance(a.clipping,list)and not a.tone
 clipping_reference=runpy.run_path(str(root/'scripts/float_clipping_reference.py'))['render']
samples=0;different=0;maximum=0.;extended=0;actual_hash=hashlib.sha256();expected_hash=hashlib.sha256()
try:
 with gzip.open(reference,'rb')as original:
  for top in range(0,height,th):
   count=min(th,height-top);raw=original.read(count*width*16);assert len(raw)==count*width*16
   linear=np.frombuffer(raw,dtype='<f4').reshape(count,width,4).copy()
   if clipping_reference is not None:linear=clipping_reference(linear,a.clipping,origin=(0,top))
   elif a.tone:
    for settings in a.tone:
     assert isinstance(settings,dict)and set(settings)<=set(['exposure','contrast','saturation'])
     exposure=settings.get('exposure',0);contrast=settings.get('contrast',0);saturation=settings.get('saturation',0)
     assert all(np.isfinite(v)for v in [exposure,contrast,saturation])and -3<=exposure<=3 and -100<=contrast<=100 and -100<=saturation<=100
     working_rgb=linear[:,:,:3].astype(np.float64)*2.**exposure
     if contrast!=0:working_rgb=(working_rgb-.5)*2.**(contrast/100)+.5
     if saturation!=0:
      lum=working_rgb[:,:,0]*.2126+working_rgb[:,:,1]*.7152+working_rgb[:,:,2]*.0722;working_rgb=lum[:,:,None]+(working_rgb-lum[:,:,None])*(1+saturation/100)
     linear[:,:,:3]=working_rgb.astype(np.float32)
   else:linear[:,:,:3]*=2.**a.exposure
   if clipping_reference is None:linear[linear[:,:,3]==0,:3]=0
   expected=np.empty((count,width,4),dtype=dtype);apply(transform,linear.ctypes.data,expected.ctypes.data,count*width)
   actual=rows(top,count);assert np.isfinite(actual).all()
   different+=int(np.count_nonzero(actual.view('u'+str(dtype.itemsize))!=expected.view('u'+str(dtype.itemsize))))
   maximum=max(maximum,float(np.abs(actual.astype(np.float64)-expected.astype(np.float64)).max()))
   if a.precision=='float32':extended+=int(np.count_nonzero((actual[:,:,:3]<0)|(actual[:,:,:3]>1)))
   samples+=actual.size;actual_hash.update(actual.tobytes());expected_hash.update(expected.tobytes())
  assert original.read(1)==b''
finally:
 td(transform)
 if handle:close(handle)
 if image:image.close()
 if document:document.close()
assert different==0 and maximum==0 and samples==case['samples'],(different,maximum,samples)
print(json.dumps(dict(page=a.page,width=width,height=height,samplesCompared=samples,nonidenticalWords=different,maximumError=maximum,extendedSamples=extended,precision=a.precision,profile=a.profile,completeProfileExact=True,tone=a.tone,clipping=a.clipping,actualSampleSha256=actual_hash.hexdigest(),referenceSampleSha256=expected_hash.hexdigest(),outputBytes=a.output.stat().st_size,outputSha256=hashlib.sha256(a.output.read_bytes()).hexdigest(),reference='Independent native Linux CMM source references, NumPy clipping/tone/exposure, native Linux CMM output, libtiff/Pillow/MuPDF readback.')))
