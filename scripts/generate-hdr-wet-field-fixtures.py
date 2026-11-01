"""Independent Float64 prepared HDR field and final Float32 replacement references."""
from pathlib import Path
import gzip,hashlib,json,math
import numpy as np
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/hdr-wet-field';out.mkdir(exist_ok=True)
rng=np.random.default_rng(10441);count=8197
before=rng.uniform(-16,32,(count,4)).astype('<f4');before[:,3]=rng.random(count,dtype=np.float32)
after=rng.uniform(-32,64,(count,4)).astype('<f4');after[:,3]=rng.random(count,dtype=np.float32)
coverage=rng.random(count,dtype=np.float32);coverage[:5]=[0,1,1/4096,.375,1]
after[:,3]=(after[:,3].astype(np.float64)*coverage.astype(np.float64)).astype('<f4');after[0]=[2,-4,8,0];after[1]=[-0.,2.7182817,-3.1415927,.375]
before[0]=[-0.,9,-7,0]
field=np.empty((count,5),dtype='<f8');field[:,:3]=after[:,:3].astype(np.float64)*after[:,3,None].astype(np.float64);field[:,3]=after[:,3];field[:,4]=coverage
full=field.copy();full[:,4]=1
files={}
def save(name,value):
    raw=value.tobytes();packed=gzip.compress(raw,mtime=0);(out/(name+'.bin.gz')).write_bytes(packed);files[name]={'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'dtype':value.dtype.str,'shape':list(value.shape)}
for name,value in [('before',before),('after',after),('coverage',coverage),('field',field),('full-field',full)]:save(name,value)
def composite(f,opacity):
    result=before.copy()
    for i in range(count):
        if opacity==0 or f[i,4]==0:continue
        left=1-opacity*f[i,4];alpha=f[i,3]*opacity if left==0 else float(before[i,3])*left+f[i,3]*opacity;result[i,3]=alpha
        for c in range(3):
            p=f[i,c]*opacity;n=p if left==0 else float(before[i,c])*float(before[i,3])*left+p
            result[i,c]=0 if result[i,3]==0 else n/alpha
    return result
for name,f,opacity in [('zero',field,0),('partial',field,.625),('covered',field,1),('full',full,1)]:save('composite-'+name,composite(f,opacity))
old=full[:,:4].astype('<f4');positive=old[:,3]>0;decoded=np.zeros_like(after);decoded[:,3]=old[:,3];decoded[positive,:3]=(old[positive,:3].astype(np.float64)/old[positive,3,None].astype(np.float64)).astype('<f4')
expected=after.copy();expected[~positive,:3]=0
old_mismatch=int(np.count_nonzero(decoded.view(np.uint32)!=expected.view(np.uint32)))
origin={'x':2**38,'y':-(2**38)};bounds={'x':origin['x']-7,'y':origin['y']+3,'width':23,'height':17};small=field[:23*17].reshape(17,23,5).copy();save('spatial-source',small)
input_origin={'x':origin['x']+100,'y':origin['y']-200};window={'x':input_origin['x']-12,'y':input_origin['y']-10,'width':31,'height':23}
mappings=[{'matrix':[1,.125,-.25,-.25,1,.5,.015625,-.0078125,1],'inputOrigin':input_origin,'sourceOrigin':origin},{'matrix':[1,0,0,0,1,0,.125,0,.0625],'inputOrigin':input_origin,'sourceOrigin':origin}]
for index,mapping in enumerate(mappings):
    m=mapping['matrix'];values=np.zeros((window['height'],window['width'],5),dtype='<f8')
    for row in range(window['height']):
        for col in range(window['width']):
            x=window['x']+col-input_origin['x']+.5;y=window['y']+row-input_origin['y']+.5;w=m[6]*x+m[7]*y+m[8]
            if w==0:continue
            u=(m[0]*x+m[1]*y+m[2])/w-.5;v=(m[3]*x+m[4]*y+m[5])/w-.5;ix=math.floor(u);iy=math.floor(v);fx=u-ix;fy=v-iy
            if u< -8 or v<2 or u>=16 or v>=20:continue
            for c in range(5):
                value=None
                for dy in range(2):
                    for dx in range(2):
                        weight=(fx if dx else 1-fx)*(fy if dy else 1-fy)
                        if weight==0:continue
                        sx=ix+dx;sy=iy+dy;sample=float(small[sy-3,sx+7,c]) if -7<=sx<16 and 3<=sy<20 else 0
                        term=sample*weight;value=term if value is None else value+term
                values[row,col,c]=value or 0
            if values[row,col,3]==0:values[row,col,:3]=0
    save('spatial-'+str(index),values)
codec=np.resize(after,(79,131,4)).astype('<f4');save('codec',codec)
manifest={'version':1,'oracle':'Independent scalar/NumPy Float64 weighted math; one final Float32 store; no editor imports or WASM','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'pixels':count,'oldFloat32PremultipliedMismatchWords':old_mismatch,'bounds':bounds,'window':window,'mappings':mappings,'files':files}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'files':len(files),'bytes':sum(v['bytes'] for v in files.values()),'oldPremultipliedMismatchWords':old_mismatch}))
