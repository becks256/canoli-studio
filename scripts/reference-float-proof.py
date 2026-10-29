"""Independent native-CMM proof of captured linear-float scene samples.

The caller separately verifies the scene producer; this reference tests the
proof boundary without reusing the Canoli native wrapper or browser worker.
"""
from pathlib import Path
import argparse,ctypes as C,hashlib,json,math,struct
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('output',type=Path);p.add_argument('--native-lcms',type=Path,required=True);p.add_argument('--device',choices=['srgb','display-p3','adobe-rgb','narrow-rgb','synthetic-cmyk'],default='narrow-rgb');p.add_argument('--intent',type=int,choices=range(4),default=1);p.add_argument('--proof-intent',type=int,choices=range(4),default=1);p.add_argument('--bpc',action='store_true');p.add_argument('--gamut',action='store_true');p.add_argument('--warning',default='#c731e9');a=p.parse_args();root=Path(__file__).resolve().parents[1];P=C.c_void_p;U=C.c_uint32
lib=C.CDLL(str(a.native_lcms.resolve()))
def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
assert fn('cmsGetEncodedCMMversion',[],U)()==2190
context=fn('cmsCreateContext',[P,P],P)(None,None);assert context
open_profile=fn('cmsOpenProfileFromMemTHR',[P,P,U],P);close=fn('cmsCloseProfile',[P],C.c_int);handles=[];hashes={};transform=None
try:
 for n in ['linear-srgb','srgb',a.device]:
  data=(root/'tests/fixtures/icc-native'/(n+'.icc')).read_bytes();hashes[n]=hashlib.sha256(data).hexdigest();h=open_profile(context,C.create_string_buffer(data),len(data));assert h;handles.append(h)
 colors=bytes.fromhex(a.warning[1:]);assert a.warning.startswith('#')and len(colors)==3
 fn('cmsSetAlarmCodesTHR',[P,C.POINTER(C.c_uint16)],None)(context,(C.c_uint16*16)(*(v*257 for v in colors)))
 base=(4<<16)|(3<<3)|128;flags=0x4000000|0x400|0x4000|(0x2000 if a.bpc else 0)|(0x1000 if a.gamut else 0)
 transform=fn('cmsCreateProofingTransformTHR',[P,P,U,P,U,P,U,U,U],P)(context,handles[0],base|4|(1<<22),handles[1],base|1,handles[2],a.intent,a.proof_intent,flags);assert transform
 apply=fn('cmsDoTransform',[P,P,P,U],None);source_hash=hashlib.sha256();output_hash=hashlib.sha256();pixels=0
 with a.source.open('rb')as source,a.output.open('xb')as output:
  while data:=source.read(65536*16):
   assert len(data)%16==0
   for values in struct.iter_unpack('<4f',data):assert all(math.isfinite(v)for v in values)and 0<=values[3]<=1
   source_hash.update(data);count=len(data)//16;pixels+=count;result=C.create_string_buffer(count*4);apply(transform,C.create_string_buffer(data),result,count);output.write(result.raw);output_hash.update(result.raw)
 assert pixels>0
 print(json.dumps({'pixels':pixels,'inputSha256':source_hash.hexdigest(),'outputSha256':output_hash.hexdigest(),'profiles':hashes,'nativeLibrarySha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),'device':a.device,'intent':a.intent,'proofIntent':a.proof_intent,'bpc':a.bpc,'gamut':a.gamut,'warning':a.warning,'scope':'Direct native CMM proof of captured scene samples; independent scene fidelity is tested separately.'}))
finally:
 if transform:fn('cmsDeleteTransform',[P],None)(transform)
 for h in handles:close(h)
 fn('cmsDeleteContext',[P],None)(context)
