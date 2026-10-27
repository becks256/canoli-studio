"""Independent streaming 50 MP RGB16 -> RGBA16 reference using native Little CMS.
No browser/Canoli/WASM output participates in the reference. Fixed 100k-pixel
windows keep input/output planes bounded; the digest covers every output byte.
"""
from pathlib import Path
import argparse,array,ctypes as C,gzip,hashlib,json,sys
p=argparse.ArgumentParser();p.add_argument('--native-lcms',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parents[1]
if sys.byteorder!='little':raise SystemExit('Reference requires little endian arrays.')
lib=C.CDLL(str(a.native_lcms.resolve()));P=C.c_void_p;U=C.c_uint32

def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
assert fn('cmsGetEncodedCMMversion',[],U)()==2190
open_profile=fn('cmsOpenProfileFromMem',[P,U],P);close=fn('cmsCloseProfile',[P],C.c_int);create=fn('cmsCreateTransform',[P,U,P,U,U,U],P);delete=fn('cmsDeleteTransform',[P],None);apply=fn('cmsDoTransform',[P,P,P,U],None)
profiles=[];profile_hashes={}
for name in ['linear-srgb','display-p3']:
 data=(root/'tests/fixtures/icc-native'/(name+'.icc')).read_bytes();profile_hashes[name]=hashlib.sha256(data).hexdigest();buf=C.create_string_buffer(data);handle=open_profile(buf,len(data));assert handle;profiles.append(handle)
fmt=(4<<16)|(3<<3)|128|2;transform=create(profiles[0],fmt,profiles[1],fmt,1,0x4000000|0x400);assert transform
source=root/'tests/fixtures/raw/native-50mp.rgb16le.gz';window=100000;pixels=0;hashes=[];input_sha=hashlib.sha256();distinct=[set(),set(),set()]
try:
 with gzip.open(source,'rb')as file:
  while data:=file.read(window*6):
   assert len(data)%6==0;input_sha.update(data);rgb=array.array('H');rgb.frombytes(data);count=len(rgb)//3;[distinct[c].update(rgb[c::3])for c in range(3)];rgba=array.array('H',[0])*(count*4)
   for channel in range(3):rgba[channel::4]=rgb[channel::3]
   rgba[3::4]=array.array('H',((i*53+11)&65535 for i in range(pixels,pixels+count)))
   input_=C.create_string_buffer(rgba.tobytes());output=C.create_string_buffer(count*8);apply(transform,input_,output,count);hashes.append(hashlib.sha256(output.raw).digest());pixels+=count
finally:delete(transform);[close(profile)for profile in profiles]
assert pixels==50000000;assert input_sha.hexdigest()=='2318a0fdc66bf94cb4e8cc439c6d58158086c7723ecbc32d53c0161dd9d66620';assert max(map(len,distinct))>256
result={'version':1,'reference':'Independent native Linux Little CMS 2.19.1; direct ctypes, every stored sample','librarySha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest(),'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'source':'native-50mp.rgb16le.gz','compressedSourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'rgb16Sha256':input_sha.hexdigest(),'sourceProfiles':profile_hashes,'width':10000,'height':5000,'pixels':pixels,'inputChannelLevels':[len(v)for v in distinct],'windowPixels':window,'windows':len(hashes),'outputFormat':'rgba16','outputBytes':pixels*8,'windowDigestRootSha256':hashlib.sha256(b''.join(hashes)).hexdigest(),'digestDefinition':'SHA256(concat(SHA256(each contiguous output RGBA16LE window))). 100000 pixels/window, alpha=(globalPixel*53+11)&65535. Relative-colorimetric, no BPC.','limits':'Genuine synthetic sensor-development reference; bounded native sample conversion, not editor high-precision input/edit/export or a physical fidelity/resource/throughput acceptance.'}
(root/'tests/fixtures/icc-precision/large-reference.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
