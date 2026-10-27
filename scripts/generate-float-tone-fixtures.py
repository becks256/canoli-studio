"""Independent NumPy float64 tone reference, rounded once to original float32.
No editor, canvas, JS or WASM supplies expected values. Neutral stages are exact
identities; active contrast pivots at .5 in working RGB, then Rec.709 saturation.
"""
from pathlib import Path
import gzip,hashlib,json
import numpy as np
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-tone';out.mkdir(exist_ok=True)
rng=np.random.default_rng(20261028);source=rng.uniform(-4,8,(8195,4)).astype(np.float32);source[:,3]=rng.random(len(source),dtype=np.float32);source[::17,3]=0;source[::19,3]=1
source[:5]=np.array([[0,-0.,1,1],[1e-30,-1e-30,1e-20,.5],[-1.125,2.75,8.000031,.375],[.18,.5,.75,0],[0,0,0,0]],dtype=np.float32)
settings=[{},dict(exposure=1),dict(exposure=-3),dict(contrast=100),dict(contrast=-100),dict(saturation=-100),dict(saturation=100),dict(exposure=.7,contrast=37,saturation=-43),dict(exposure=-1.25,contrast=-61,saturation=79)]
files={};cases=[]
def write(name,data):
 raw=np.ascontiguousarray(data,dtype='<f4').tobytes();packed=gzip.compress(raw,mtime=0);(out/name).write_bytes(packed);files[name]=dict(bytes=len(packed),sha256=hashlib.sha256(packed).hexdigest(),rawSha256=hashlib.sha256(raw).hexdigest())
write('source.f32le.gz',source)
for i,values in enumerate(settings):
 options={key:values.get(key,0)for key in ['exposure','contrast','saturation']};v=source.astype(np.float64);rgb=v[:,:3]*2**options['exposure']
 if options['contrast']!=0:rgb=(rgb-.5)*2**(options['contrast']/100)+.5
 if options['saturation']!=0:
  lum=rgb[:,0]*.2126+rgb[:,1]*.7152+rgb[:,2]*.0722;rgb=lum[:,None]+(rgb-lum[:,None])*(1+options['saturation']/100)
 result=np.column_stack([rgb,v[:,3]]).astype(np.float32);assert np.isfinite(result).all();name='tone-'+str(i)+'.f32le.gz';write(name,result);cases.append(dict(options=options,reference=name))
manifest=dict(version=1,samples=len(source),cases=cases,files=files,generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),reference='Independent NumPy float64 exposure -> active .5-pivot contrast -> active Rec.709 saturation, with one final float32 rounding and exact alpha.')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(dict(samples=len(source),cases=len(cases))))
