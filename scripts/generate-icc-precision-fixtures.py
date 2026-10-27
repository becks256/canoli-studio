"""Independent Linux Little CMS references; no Canoli wrapper/WASM is imported.
Run explicitly against the pinned native library built by build-icc-reference.py.
"""
from pathlib import Path
import argparse, ctypes as C, hashlib, json, struct
p=argparse.ArgumentParser();p.add_argument('--native-lcms',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/icc-precision';out.mkdir(exist_ok=True)
lib=C.CDLL(str(a.native_lcms.resolve()));P=C.c_void_p;U=C.c_uint32

def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
version=fn('cmsGetEncodedCMMversion',[],U)();assert version==2190
open_profile=fn('cmsOpenProfileFromMem',[P,U],P);close=fn('cmsCloseProfile',[P],C.c_int)
create=fn('cmsCreateTransform',[P,U,P,U,U,U],P);delete=fn('cmsDeleteTransform',[P],None);apply=fn('cmsDoTransform',[P,P,P,U],None)
formats={'rgba8':(1,'B'), 'rgba16':(2,'H'), 'rgba-float32':(4,'f')}
def native_format(name):
 size,_=formats[name];return (4<<16)|(3<<3)|128|size|((1<<22)if size==4 else 0)
# Full 12-bit ramp in a 16-bit plane, with independently varying color and alpha.
# Float inputs include distinct values much closer than 1/255. Extended values
# are separately tested with a linear identity; ICC curves may clip other paths.
values={
 'rgba8':[(i*19%256,i*37%256,i*71%256,i*83%256)for i in range(513)],
 'rgba16':[(i*16,(i*31+7)%65536,(i*47+3)%65536,(i*53+11)%65536)for i in range(4096)],
 'rgba-float32':[(i/4096,(i*31%4096)/4096,(i*47%4096)/4096,(i*53%4096)/4096)for i in range(4096)],
}
files={};rows=[]
def store(name,data):
 (out/name).write_bytes(data);files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};return name
for name,samples in values.items():store('input-'+name+'.bin',b''.join(struct.pack('<4'+formats[name][1],*v)for v in samples))

def reference(source,destination,input_format,output_format,intent=1,bpc=False,input_file=None):
 profiles=[]
 for name in[source,destination]:
  data=(root/'tests/fixtures/icc-native'/(name+'.icc')).read_bytes();buf=C.create_string_buffer(data);handle=open_profile(buf,len(data));assert handle;profiles.append(handle)
 transform=None
 try:
  transform=create(profiles[0],native_format(input_format),profiles[1],native_format(output_format),intent,0x4000000|0x400|(0x2000 if bpc else 0));assert transform
  input_file=input_file or 'input-'+input_format+'.bin';data=(out/input_file).read_bytes();count=len(data)//(4*formats[input_format][0]);result=C.create_string_buffer(count*4*formats[output_format][0]);apply(transform,C.create_string_buffer(data),result,count)
  name=f'{len(rows):02}-{source}-{destination}-{input_format}-{output_format}-{intent}-{int(bpc)}.bin'
  rows.append({'source':source,'destination':destination,'inputFormat':input_format,'outputFormat':output_format,'intent':intent,'blackPointCompensation':bpc,'input':input_file,'output':store(name,result.raw),'pixels':count})
 finally:
  if transform:delete(transform)
  for handle in profiles:close(handle)
for input_format in formats:
 for output_format in formats:reference('display-p3','adobe-rgb',input_format,output_format)
for source,destination in [('adobe-rgb','linear-srgb'),('linear-srgb','display-p3'),('srgb','narrow-rgb')]:
 for name in formats:reference(source,destination,name,name)
for intent in range(4):reference('display-p3','srgb','rgba16','rgba16',intent,True)
reference('srgb','srgb','rgba16','rgba16')
extended=[(-.125,0,1.5,0),(-1,2,.00001,.125),(.50001,.50002,.50003,.625),(8,.00002,-.00003,1)]
store('extended-float32.bin',b''.join(struct.pack('<4f',*v)for v in extended));reference('linear-srgb','linear-srgb','rgba-float32','rgba-float32',input_file='extended-float32.bin')
manifest={'version':1,'reference':'Independent native Linux Little CMS 2.19.1; direct ctypes API, no Canoli wrapper','nativeVersion':version,'librarySha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'profileHashes':{name:hashlib.sha256((root/'tests/fixtures/icc-native'/(name+'.icc')).read_bytes()).hexdigest()for name in ['srgb','display-p3','adobe-rgb','linear-srgb','narrow-rgb']},'limits':'Exact integer samples; float RGB absolute error <= 0.000002, alpha exact for matching formats. Cross-format alpha follows CMM normalized quantization. Synthetic profiles; no physical, scene-editing, HDR display or photographic quality acceptance.','cases':rows,'files':files}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(rows),'bytes':sum(v['bytes']for v in files.values())}))
