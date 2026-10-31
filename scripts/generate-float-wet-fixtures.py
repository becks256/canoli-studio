"""Independent float64 linear wet-paint references, rounded once to float32."""
from pathlib import Path
import gzip,hashlib,json
import numpy as np

root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-wet';out.mkdir(exist_ok=True)
rng=np.random.default_rng(10431);count=8197
source=rng.uniform(-16,32,(count,4)).astype('<f4');source[:,3]=rng.random(count,dtype=np.float32)
pigment=rng.uniform(-12,24,(count,4)).astype('<f4');pigment[:,3]=rng.random(count,dtype=np.float32)
source[0]=[8,-4,2,0];source[1]=[-0.,3,9,1];source[2]=[1e20,-1e19,2,np.nextafter(np.float32(0),np.float32(1))]
pigment[0]=[9,-3,4,.5];pigment[1]=[5,1,-2,0]
coverage=rng.random(count,dtype=np.float32);coverage[:4]=[0,1,np.float32(1/4096),-0.]
def load(src,color,amount):
    s=src.astype(np.float64);a=s[:,3]*(1-amount)+color[3]*amount
    result=np.empty_like(src);result[:,3]=a.astype(np.float32)
    result[:,:3]=(s[:,:3]*s[:,3,None]*(1-amount)+np.array(color[:3])*color[3]*amount).astype(np.float32)
    result[result[:,3]==0,:3]=0
    return result
def mix(src,carried,flow=1,wetness=0,pickup=.5):
    s=src.astype(np.float64);p=carried.astype(np.float64);strength=coverage.astype(np.float64)*flow;d=strength*(1-wetness);k=strength*pickup
    result=src.copy();next=carried.copy();a=s[:,3]*(1-d)+p[:,3]*d;na=p[:,3]*(1-k)+s[:,3]*k
    active=d>0;result[active,3]=a[active].astype(np.float32)
    with np.errstate(divide='ignore',invalid='ignore'):
        value=(s[:,:3]*s[:,3,None]*(1-d[:,None])+p[:,:3]*d[:,None])/a[:,None]
    result[active,:3]=value[active].astype(np.float32);result[active&(result[:,3]==0),:3]=0
    active=k>0;next[active,3]=na[active].astype(np.float32)
    value=p[:,:3]*(1-k[:,None])+s[:,:3]*s[:,3,None]*k[:,None]
    next[active,:3]=value[active].astype(np.float32);next[active&(next[:,3]==0),:3]=0
    return result,next
def envelope(before,after,opacity):
    s=before.astype(np.float64);p=after.astype(np.float64);m=coverage.astype(np.float64)*opacity;result=before.copy()
    a=s[:,3]*(1-m);b=p[:,3]*m;alpha=a+b;active=(m>0)&(m<1)
    result[m==1]=after[m==1];result[active,3]=alpha[active].astype(np.float32)
    with np.errstate(divide='ignore',invalid='ignore'):value=(s[:,:3]*a[:,None]+p[:,:3]*b[:,None])/alpha[:,None]
    result[active,:3]=value[active].astype(np.float32);result[active&(result[:,3]==0),:3]=0
    return result
files={}
def save(name,value):
    raw=value.astype('<f4').tobytes();packed=gzip.compress(raw,mtime=0);out.joinpath(name+'.f32le.gz').write_bytes(packed)
    files[name]={'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest()}
for name,value in [('source',source),('pigment',pigment),('coverage',coverage)]:save(name,value)
loads=[]
for name,amount in [('zero',0),('partial',.37),('full',1)]:
    options={'color':[4.5,-2.25,13.125,.375],'load':amount};save('load-'+name,load(source,options['color'],amount));loads.append({'name':name,'options':options})
carried=load(pigment,[0,0,0,1],0);save('carried',carried)
mixes=[]
for name,options in [('default',{}),('zero-flow',{'flow':0}),('pickup-only',{'wetness':1,'pickup':1}),('partial',{'flow':.625,'wetness':.2,'pickup':.7}),('replace',{'pickup':0}),('partial-no-pickup',{'flow':.125,'pickup':0})]:
    pixels,next=mix(source,carried,**options);save('mix-'+name,pixels);save('carry-'+name,next);mixes.append({'name':name,'options':options})
envelopes=[]
for name,opacity in [('zero',0),('partial',.625),('full',1)]:save('envelope-'+name,envelope(source,pigment,opacity));envelopes.append({'name':name,'opacity':opacity})
manifest={'version':1,'pixels':count,'encoding':'linear RGB, straight source/destination, premultiplied carried pigment','oracle':'NumPy float64 weighted sums and one final float32 store; no editor code or WASM','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'loads':loads,'mixes':mixes,'envelopes':envelopes,'files':files}
out.joinpath('manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(files),'bytes':sum(v['bytes'] for v in files.values()),'pixels':count}))
