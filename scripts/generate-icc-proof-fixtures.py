"""Independent pinned native Little CMS proof references; no Canoli/WASM code.

Explicitly run with --native-lcms; ordinary builds never rewrite references.
"""
from pathlib import Path
import argparse,ctypes as C,hashlib,json,struct
parser=argparse.ArgumentParser();parser.add_argument('--native-lcms',type=Path,required=True);args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/icc-proof';out.mkdir(exist_ok=True);profiles=root/'tests/fixtures/icc-native';lib=C.CDLL(str(args.native_lcms.resolve()));P=C.c_void_p;U=C.c_uint32

def fn(name,types,result):
 f=getattr(lib,name);f.argtypes=types;f.restype=result;return f
version=fn('cmsGetEncodedCMMversion',[],U)();assert version==2190
context=fn('cmsCreateContext',[P,P],P)(None,None);assert context
open_profile=fn('cmsOpenProfileFromMemTHR',[P,P,U],P);close=fn('cmsCloseProfile',[P],C.c_int);delete=fn('cmsDeleteTransform',[P],None);apply=fn('cmsDoTransform',[P,P,P,U],None)
proof_transform=fn('cmsCreateProofingTransformTHR',[P,P,U,P,U,P,U,U,U],P);rgb_transform=fn('cmsCreateTransformTHR',[P,P,U,P,U,U,U],P);alarms=fn('cmsSetAlarmCodesTHR',[P,C.POINTER(C.c_uint16)],None)
formats={'rgba8':(1,'B'),'rgba16':(2,'H'),'rgba-float32':(4,'f')};files={};cases=[];hashes={}
def store(name,data):
 (out/name).write_bytes(data);files[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()};return name
def native_format(name):
 size,_=formats[name];return(4<<16)|(3<<3)|128|size|((1<<22)if size==4 else 0)
def handle(name):
 data=(profiles/(name+'.icc')).read_bytes();hashes[name]=hashlib.sha256(data).hexdigest();value=open_profile(context,C.create_string_buffer(data),len(data));assert value;return value
values={
 'rgba8':[(i*19%256,i*37%256,i*71%256,i*83%256)for i in range(1024)],
 'rgba16':[(i*64,(i*131+7)%65536,(i*193+3)%65536,(i*211+11)%65536)for i in range(1024)],
 'rgba-float32':[(i/1024,(i*31%1024)/1024,(i*47%1024)/1024,(i*53%1024)/1024)for i in range(1024)]+[(-.125,2,.50001,.625),(8,.00002,-.00003,1),(.50001,.50002,.50003,-0.0)],
}
for name,rows in values.items():store('input-'+name+'.bin',b''.join(struct.pack('<4'+formats[name][1],*v)for v in rows))
def reference(device,input_format='rgba-float32',output_format='rgba8',intent=1,proof_intent=1,bpc=False,gamut=False,warning='#c731e9',source='linear-srgb',destination='srgb'):
 handles=[handle(n)for n in[source,destination,device]];transform=None
 try:
  color=bytes.fromhex(warning[1:]);codes=(C.c_uint16*16)(*(v*257 for v in color));alarms(context,codes)
  flags=0x4000000|0x400|0x4000|(0x2000 if bpc else 0)|(0x1000 if gamut else 0)
  transform=proof_transform(context,handles[0],native_format(input_format),handles[1],native_format(output_format),handles[2],intent,proof_intent,flags);assert transform
  name='input-'+input_format+'.bin';data=(out/name).read_bytes();pixels=len(data)//(4*formats[input_format][0]);result=C.create_string_buffer(pixels*4*formats[output_format][0]);apply(transform,C.create_string_buffer(data),result,pixels)
  output=f'{len(cases):02}-{device}-{input_format}-{output_format}-{intent}-{proof_intent}-{int(bpc)}-{int(gamut)}.bin';store(output,result.raw)
  cases.append({'source':source,'destination':destination,'device':device,'inputFormat':input_format,'outputFormat':output_format,'intent':intent,'proofIntent':proof_intent,'blackPointCompensation':bpc,'gamutWarning':gamut,'warningColor':warning,'input':name,'output':output,'pixels':pixels});return result.raw
 finally:
  if transform:delete(transform)
  for h in handles:close(h)
for input_format in formats:
 for output_format in formats:reference('narrow-rgb',input_format,output_format)
for device in ['narrow-rgb','synthetic-cmyk']:
 for intent in range(4):
  for gamut in [False,True]:reference(device,intent=intent,proof_intent=(intent+1)%4,bpc=True,gamut=gamut)
for device in ['srgb','display-p3','adobe-rgb']:reference(device,gamut=True)
# A direct float proof must differ from proofing an sRGB8 display proxy.
# Both alternatives are independently computed by the native CMM.
source=handle('linear-srgb');display=handle('srgb');device=handle('narrow-rgb');convert=None;proof=None
try:
 data=(out/'input-rgba-float32.bin').read_bytes();pixels=len(data)//16;proxy=C.create_string_buffer(pixels*4);convert=rgb_transform(context,source,native_format('rgba-float32'),display,native_format('rgba8'),1,0x4000000|0x400);assert convert;apply(convert,C.create_string_buffer(data),proxy,pixels)
 proof=proof_transform(context,display,native_format('rgba8'),display,native_format('rgba8'),device,1,1,0x4000000|0x400|0x4000);assert proof;result=C.create_string_buffer(pixels*4);apply(proof,proxy,result,pixels);store('quantized-display-proof.bin',result.raw)
 direct=next(row for row in cases if row['device']=='narrow-rgb'and row['inputFormat']=='rgba-float32'and row['outputFormat']=='rgba8'and not row['gamutWarning']and not row['blackPointCompensation']);native=(out/direct['output']).read_bytes();differences=sum(a!=b for i,(a,b)in enumerate(zip(native,result.raw))if i%4!=3);assert differences>0
finally:
 for t in [convert,proof]:
  if t:delete(t)
 for h in [source,display,device]:close(h)
fn('cmsDeleteContext',[P],None)(context)
manifest={'version':1,'reference':'Independent native Linux Little CMS 2.19.1, direct ctypes API, without Canoli wrapper/WASM','nativeVersion':version,'nativeLibrarySha256':hashlib.sha256(args.native_lcms.read_bytes()).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'profileHashes':hashes,'cases':cases,'files':files,'directVersusByteProxyDifferentColorChannels':differences,'limits':'Synthetic RGB/CMYK device models; exact integer samples and same-format alpha, float color absolute error <= 2e-6. No measured physical printer/display or HDR acceptance.'};(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(cases),'bytes':sum(v['bytes']for v in files.values()),'directVersusByteProxyDifferentColorChannels':differences}))
