"""Independent native display reference; imports no editor or WASM code."""
from pathlib import Path
import argparse,ctypes as C,hashlib,json,sys
p=argparse.ArgumentParser();p.add_argument('--native-lcms',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-display';out.mkdir(exist_ok=True);sha=lambda b:hashlib.sha256(b).hexdigest();assert sys.byteorder=='little'
manifest=json.loads((root/'tests/fixtures/icc-precision/manifest.json').read_text());assert sha(a.native_lcms.read_bytes())==manifest['librarySha256']
paths=['tests/fixtures/icc-precision/input-rgba-float32.bin','tests/fixtures/icc-precision/extended-float32.bin','tests/fixtures/icc-native/linear-srgb.icc','tests/fixtures/icc-native/srgb.icc'];inputs={rel:sha((root/rel).read_bytes())for rel in paths}
for rel in paths[:2]:assert inputs[rel]==manifest['files'][Path(rel).name]['sha256']
for name in ['linear-srgb','srgb']:assert inputs['tests/fixtures/icc-native/'+name+'.icc']==manifest['profileHashes'][name]
data=b''.join((root/rel).read_bytes()for rel in paths[:2]);count=len(data)//16;assert count==4100
lib=C.CDLL(str(a.native_lcms.resolve()));P=C.c_void_p;U=C.c_uint32

def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
version=fn('cmsGetEncodedCMMversion',[],U)();assert version==2190
op=fn('cmsOpenProfileFromMem',[P,U],P);close=fn('cmsCloseProfile',[P],C.c_int);create=fn('cmsCreateTransform',[P,U,P,U,U,U],P);delete=fn('cmsDeleteTransform',[P],None);apply=fn('cmsDoTransform',[P,P,P,U],None)
handles=[];transform=None
try:
 for rel in paths[2:]:
  raw=(root/rel).read_bytes();handle=op(C.create_string_buffer(raw),len(raw));assert handle;handles.append(handle)
 base=(4<<16)|(3<<3)|128;transform=create(handles[0],base|4|(1<<22),handles[1],base|1,1,0x4000000|0x400);assert transform
 output=C.create_string_buffer(count*4);apply(transform,C.create_string_buffer(data),output,count)
 files={'native-input.f32le':data,'native-display.rgba8':output.raw}
 for name,value in files.items():(out/name).write_bytes(value)
 d={'version':1,'reference':'Independent Linux Little CMS 2.19.1 direct ctypes API; complete native f32 ramp plus extended/hidden RGB and alpha. No editor/WASM/Canvas expected samples.','nativeVersion':version,'librarySha256':sha(a.native_lcms.read_bytes()),'generatorSha256':sha(Path(__file__).read_bytes()),'inputs':inputs,'pixels':count,'source':'linear-srgb','destination':'srgb','intent':1,'blackPointCompensation':False,'files':{name:{'bytes':len(value),'sha256':sha(value)}for name,value in files.items()},'limits':'Exact RGBA8 native display words; synthetic profiles and one pinned CMM. No physical display, sustained-performance or whole-editor acceptance.'};(out/'manifest.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps({'pixels':count,'nativeVersion':version,'files':d['files']}))
finally:
 if transform:delete(transform)
 for h in handles:close(h)
