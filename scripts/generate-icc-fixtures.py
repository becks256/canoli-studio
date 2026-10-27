"""Generate owned synthetic ICC fixtures and independent Pillow/CMM references.

Requires Pillow 10.3.0 with Little CMS 2.16. Invoke explicitly after generating
standard profiles; normal builds/tests never rewrite fixtures.
"""
from pathlib import Path
import argparse,ctypes as C,hashlib,io,itertools,json,struct
from PIL import Image,ImageCms
p=argparse.ArgumentParser();p.add_argument('--directory',type=Path,default=Path('tests/fixtures/icc-native'));p.add_argument('--native-lcms',type=Path,required=True);a=p.parse_args();root=a.directory;root.mkdir(parents=True,exist_ok=True)
if Image.__version__!='10.3.0'or ImageCms.core.littlecms_version!='2.16':raise SystemExit('Expected independent Pillow 10.3.0 / Little CMS 2.16.')
lib=C.CDLL(ImageCms.core.__file__);P=C.c_void_p;U=C.c_uint32;D=C.c_double
class xyY(C.Structure):_fields_=[('x',D),('y',D),('Y',D)]
class Triple(C.Structure):_fields_=[('r',xyY),('g',xyY),('b',xyY)]
class XYZ(C.Structure):_fields_=[('X',D),('Y',D),('Z',D)]
def fn(name,args,result):
 f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
rgbprofile=fn('cmsCreateRGBProfile',[C.POINTER(xyY),C.POINTER(Triple),C.POINTER(P)],P)
gamma=fn('cmsBuildGamma',[P,D],P);freecurve=fn('cmsFreeToneCurve',[P],None)
placeholder=fn('cmsCreateProfilePlaceholder',[P],P);setclass=fn('cmsSetDeviceClass',[P,U],None);setspace=fn('cmsSetColorSpace',[P,U],None);setpcs=fn('cmsSetPCS',[P,U],None);setversion=fn('cmsSetProfileVersion',[P,D],None)
write=fn('cmsWriteTag',[P,U,P],C.c_int);close=fn('cmsCloseProfile',[P],C.c_int)
save=fn('cmsSaveProfileToMem',[P,P,C.POINTER(U)],C.c_int)
mlu=fn('cmsMLUalloc',[P,U],P);mluset=fn('cmsMLUsetASCII',[P,C.c_char_p,C.c_char_p,C.c_char_p],C.c_int);mlufree=fn('cmsMLUfree',[P],None)
pipeline=fn('cmsPipelineAlloc',[P,U,U],P);freepipe=fn('cmsPipelineFree',[P],None)
clut=fn('cmsStageAllocCLut16bit',[P,U,U,U,C.POINTER(C.c_uint16)],P);insert=fn('cmsPipelineInsertStage',[P,C.c_int,P],C.c_int)
sig=lambda value:int.from_bytes(value.encode(),'big')
def label(profile,tag,value):
 text=mlu(None,1);assert text
 try:assert mluset(text,b'en',b'US',value.encode());assert write(profile,sig(tag),text)
 finally:mlufree(text)
def store(profile,name,description):
 try:
  assert profile;setversion(profile,2.4);label(profile,'desc',description);label(profile,'cprt','Canoli Studio synthetic test profile, CC0; no physical device calibration')
  size=U();assert save(profile,None,C.byref(size));data=C.create_string_buffer(size.value);assert save(profile,data,C.byref(size));data=bytearray(data.raw[:size.value]);data[24:36]=struct.pack('>6H',2026,10,27,0,0,0);data[84:100]=bytes(16);(root/name).write_bytes(data)
 finally:close(profile)
curve=gamma(None,2.2);assert curve
try:
 curves=(P*3)(curve,curve,curve);store(rgbprofile(C.byref(xyY(.3127,.3290,1)),C.byref(Triple(xyY(.54,.34,1),xyY(.30,.54,1),xyY(.20,.15,1))),curves),'narrow-rgb.icc','Canoli synthetic narrow RGB device')
finally:freecurve(curve)
# Explicit educational CMYK device LUTs, not a measured printer. Forward CMYK
# uses (1-C/M/Y)*(1-K). Reverse RGB uses 50 percent gray-component replacement.
# Independent Pillow transforms supply D50 Lab samples; v2 Lab16 tables use
# 0xff00, not 0xffff, for their normalized upper bound.
profile=placeholder(None);assert profile;setclass(profile,sig('prtr'));setspace(profile,sig('CMYK'));setpcs(profile,sig('Lab '));setversion(profile,2.4)
white=XYZ(.9642,1,.8249);assert write(profile,sig('wtpt'),C.byref(white))
steps=9;rgb=[]
for c,m,y,k in itertools.product(range(steps),repeat=4):rgb.extend(round(255*(1-ink/(steps-1))*(1-k/(steps-1)))for ink in [c,m,y])
srgb=ImageCms.createProfile('sRGB');lab=ImageCms.createProfile('LAB');to_lab=ImageCms.buildTransform(srgb,lab,'RGB','LAB',renderingIntent=1);to_rgb=ImageCms.buildTransform(lab,srgb,'LAB','RGB',renderingIntent=1)
lab_values=ImageCms.applyTransform(Image.frombytes('RGB',(steps**4,1),bytes(rgb)),to_lab).tobytes();values=(C.c_uint16*len(lab_values))(*(v*256 for v in lab_values));pipe=pipeline(None,4,3);assert pipe
try:assert insert(pipe,1,clut(None,steps,4,3,values));assert write(profile,sig('A2B0'),pipe)
finally:freepipe(pipe)
# Table input spans the encoded Lab grid; a*b* and L* values beyond the
# physical domain clip in the reference sRGB conversion before GCR.
lab_grid=bytes(round(i*255/(steps-1))for sample in itertools.product(range(steps),repeat=3)for i in sample);rgb_values=ImageCms.applyTransform(Image.frombytes('LAB',(steps**3,1),lab_grid),to_rgb).tobytes();table=[]
for i in range(0,len(rgb_values),3):
 c,m,y=(1-v/255 for v in rgb_values[i:i+3]);k=min(c,m,y)*.5;table.extend(round(65535*(v-k)/(1-k))for v in [c,m,y]);table.append(round(65535*k))
values=(C.c_uint16*len(table))(*table);pipe=pipeline(None,3,4);assert pipe
try:assert insert(pipe,1,clut(None,steps,3,4,values));assert write(profile,sig('B2A0'),pipe)
finally:freepipe(pipe)
store(profile,'synthetic-cmyk.icc','Canoli synthetic CMYK LUT device')
levels=[0,1,2,5,12,32,64,128,255];rgb=bytes(v for color in itertools.product(levels,repeat=3)for v in color);count=len(rgb)//3;source=Image.frombytes('RGB',(count,1),rgb);rgba=bytes(v for i in range(count)for v in [*rgb[i*3:i*3+3],(i*37)%256]);(root/'source.rgba').write_bytes(rgba)
rows=[];base=ImageCms.Flags.HIGHRESPRECALC
for name in ['srgb','display-p3','adobe-rgb','linear-srgb','narrow-rgb','synthetic-cmyk']:
 target=ImageCms.ImageCmsProfile(str(root/(name+'.icc')))
 for mode,intent,proof_intent,bpc in [('convert',1,1,False),('proof',1,1,False),('proof',0,0,True),('proof',3,3,False)]:
  if name=='synthetic-cmyk'and mode=='convert':continue
  flags=base|(ImageCms.Flags.BLACKPOINTCOMPENSATION if bpc else 0)
  transform=ImageCms.buildTransform(srgb,target,'RGB','RGB',renderingIntent=intent,flags=flags)if mode=='convert'else ImageCms.buildProofTransform(srgb,srgb,target,'RGB','RGB',renderingIntent=intent,proofRenderingIntent=proof_intent,flags=flags|ImageCms.Flags.SOFTPROOFING)
  out=ImageCms.applyTransform(source,transform).tobytes();expected=bytes(v for i in range(count)for v in [*out[i*3:i*3+3],rgba[i*4+3]]);file=f'{name}-{mode}-{intent}-{proof_intent}-{int(bpc)}.rgba';(root/file).write_bytes(expected);rows.append({'profile':name+'.icc','mode':mode,'intent':intent,'proofIntent':proof_intent,'blackPointCompensation':bpc,'pixels':file})
# Perceptual black-point estimation differs substantially between CMM 2.16
# and 2.19 for this deliberately coarse synthetic v2 CMYK LUT. Preserve the
# old reader result, and use an independent native build of the pinned engine
# for that one version-sensitive reference. No color threshold is widened.
native=C.CDLL(str(a.native_lcms.resolve()))
def nf(name,args,result):
 f=getattr(native,name);f.argtypes=args;f.restype=result;return f
version=nf('cmsGetEncodedCMMversion',[],U)();assert version==2190
ns=nf('cmsCreate_sRGBProfile',[],P)();nb=(root/'synthetic-cmyk.icc').read_bytes();nbuf=C.create_string_buffer(nb);np=nf('cmsOpenProfileFromMem',[P,U],P)(nbuf,len(nb));assert ns and np
nclose=nf('cmsCloseProfile',[P],C.c_int);ndel=nf('cmsDeleteTransform',[P],None)
try:
 fmt=(4<<16)|(3<<3)|1|128;flags=0x400|0x2000|0x4000|0x4000000
 nt=nf('cmsCreateProofingTransform',[P,U,P,U,P,U,U,U],P)(ns,fmt,ns,fmt,np,0,0,flags);assert nt
 try:
  input_=C.create_string_buffer(rgba);output=C.create_string_buffer(len(rgba));nf('cmsDoTransform',[P,P,P,U],None)(nt,input_,output,count);expected=output.raw
 finally:ndel(nt)
finally:nclose(ns);nclose(np)
old=(root/'synthetic-cmyk-proof-0-0-1.rgba').read_bytes();file='synthetic-cmyk-proof-0-0-1-native-2191.rgba';(root/file).write_bytes(expected)
for row in rows:
 row['reference']='Pillow 10.3.0 / Little CMS 2.16'
 if row['profile']=='synthetic-cmyk.icc'and row['intent']==0:
  row['previousReference']=row['pixels'];row['pixels']=file;row['reference']='Independent native Little CMS 2.19.1';row['crossVersionMaximumColorError']=max(abs(a-b)for i,(a,b)in enumerate(zip(old,expected))if i%4<3)
manifest={'version':1,'pillow':Image.__version__,'littleCms':ImageCms.core.littlecms_version,'nativeLittleCms':{'macroVersion':version,'librarySha256':hashlib.sha256(a.native_lcms.read_bytes()).hexdigest()},'pixels':count,'source':'source.rgba','cases':rows,'files':{p.name:{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in sorted(root.iterdir())if p.suffix in {'.icc','.rgba'}},'limits':'Synthetic unmeasured devices and finite color cube; not physical color/printer fidelity. Matrix/RGB cross-version samples and the pinned-version native reference require exact bytes; remaining CMYK cross-version proof color permits one code value, with exact alpha. The version-sensitive v2 CMYK perceptual/BPC reference retains the older result separately.'};(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'directory':str(root),'independentCases':len(rows),'pixelsPerCase':count}))
