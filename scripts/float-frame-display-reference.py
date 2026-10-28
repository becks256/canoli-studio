"""Convert independently generated completed-scene references with native LCMS.
Writes raw sRGB8 RGBA; browser readback rounding is checked separately by the UI test.
"""
from pathlib import Path
import argparse,ctypes as C,gzip,hashlib,json,sys
p=argparse.ArgumentParser();p.add_argument('frame',choices=['half','native']);p.add_argument('--native-lcms',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[1];base=root/'tests/fixtures/float-frame';m=json.loads((base/'manifest.json').read_text());name='ordinary-'+a.frame+'.f32le.gz';packed=(base/name).read_bytes();assert hashlib.sha256(packed).hexdigest()==m['files'][name]['sha256'];raw=gzip.decompress(packed);assert hashlib.sha256(raw).hexdigest()==m['files'][name]['rawSha256']
if a.frame=='native':raw=b''.join(raw[y*131*16:(y*131+130)*16]for y in range(78))
assert hashlib.sha256(a.native_lcms.read_bytes()).hexdigest()=='dc021a3a70e82f88eadff2deff512d155f846a87935658f5313d7cbb3ef9bcc6'
cms=C.CDLL(str(a.native_lcms.resolve()));P=C.c_void_p;U=C.c_uint32
def fn(name,args,result):
 f=getattr(cms,name);f.argtypes=args;f.restype=result;return f
op=fn('cmsOpenProfileFromMem',[P,U],P);close=fn('cmsCloseProfile',[P],C.c_int);create=fn('cmsCreateTransform',[P,U,P,U,U,U],P);apply=fn('cmsDoTransform',[P,P,P,U],None);delete=fn('cmsDeleteTransform',[P],None)
profiles=[]
try:
 for name in ['linear-srgb','srgb']:
  data=(root/'tests/fixtures/icc-native'/(name+'.icc')).read_bytes();profiles.append(op(C.create_string_buffer(data),len(data)))
 assert all(profiles);base_format=(4<<16)|(3<<3)|128;transform=create(profiles[0],base_format|4|(1<<22),profiles[1],base_format|1,1,0x4000000|0x400);assert transform
 try:
  output=C.create_string_buffer(len(raw)//4);apply(transform,C.create_string_buffer(raw),output,len(raw)//16);sys.stdout.buffer.write(output.raw)
 finally:delete(transform)
finally:
 for handle in profiles:
  if handle:close(handle)
