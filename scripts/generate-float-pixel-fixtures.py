"""Independent NumPy float reference; no Canoli engine or WASM imports.
W3C Compositing Level 1 formulas, plus explicitly bounded Linear Light/Burn.
"""
from pathlib import Path
import gzip,hashlib,json
import numpy as np
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-pixels';out.mkdir(exist_ok=True)
modes=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity','linear-light','linear-burn']
count=8195;rng=np.random.default_rng(20261027);source=rng.random((count,4),dtype=np.float32);backdrop=rng.random((count,4),dtype=np.float32);mask=rng.random(count,dtype=np.float32)
edges=np.array([0,1,.25,.5,.75],dtype=np.float32)
for i in range(125):source[i,:3]=[edges[i%5],edges[(i//5)%5],edges[i//25]];backdrop[i,:3]=source[124-i,:3]if i>=63 else [1,0,.5]
source[::17,3]=0;source[::19,3]=1;backdrop[::23,3]=0;backdrop[::29,3]=1;mask[::13]=0;mask[::11]=1
opacity=.71321
# All reference arithmetic starts from the exact original float32 samples.
s=source.astype(np.float64);b=backdrop.astype(np.float64);sr=s[:,:3];br=b[:,:3];sa=s[:,3]*opacity*mask.astype(np.float64);ba=b[:,3];alpha=sa+ba*(1-sa)
def lum(c):return c@np.array([.3,.59,.11])
def sat(c):return np.ptp(c,axis=1)
def set_sat(c,value):
 lo=np.min(c,axis=1);hi=np.max(c,axis=1);return np.divide(c-lo[:,None],(hi-lo)[:,None],out=np.zeros_like(c),where=(hi>lo)[:,None])*value[:,None]
def set_lum(c,value):
 c=c+(value-lum(c))[:,None];lo=np.min(c,axis=1);hi=np.max(c,axis=1);idx=lo<0;c[idx]=value[idx,None]+(c[idx]-value[idx,None])*np.divide(value[idx],value[idx]-lo[idx])[:,None];idx=hi>1;c[idx]=value[idx,None]+(c[idx]-value[idx,None])*np.divide(1-value[idx],hi[idx]-value[idx])[:,None];return c
results=[]
with np.errstate(divide='ignore',invalid='ignore'):
 for mode in modes:
  if mode=='normal':mixed=sr
  elif mode=='multiply':mixed=sr*br
  elif mode=='screen':mixed=1-(1-sr)*(1-br)
  elif mode=='overlay':mixed=np.where(br<=.5,2*sr*br,1-2*(1-sr)*(1-br))
  elif mode=='darken':mixed=np.minimum(sr,br)
  elif mode=='lighten':mixed=np.maximum(sr,br)
  elif mode=='color-dodge':mixed=np.where(br==0,0,np.where(sr==1,1,np.minimum(1,br/(1-sr))))
  elif mode=='color-burn':mixed=np.where(br==1,1,np.where(sr==0,0,1-np.minimum(1,(1-br)/sr)))
  elif mode=='hard-light':mixed=np.where(sr<=.5,2*sr*br,1-2*(1-sr)*(1-br))
  elif mode=='soft-light':mixed=np.where(sr<=.5,br-(1-2*sr)*br*(1-br),br+(2*sr-1)*(np.where(br<=.25,((16*br-12)*br+4)*br,np.sqrt(br))-br))
  elif mode=='difference':mixed=np.abs(br-sr)
  elif mode=='exclusion':mixed=br+sr-2*br*sr
  elif mode=='hue':mixed=set_lum(set_sat(sr,sat(br)),lum(br))
  elif mode=='saturation':mixed=set_lum(set_sat(br,sat(sr)),lum(br))
  elif mode=='color':mixed=set_lum(sr,lum(br))
  elif mode=='luminosity':mixed=set_lum(br,lum(sr))
  elif mode=='linear-light':mixed=np.clip(br+2*sr-1,0,1)
  else:mixed=np.maximum(0,br+sr-1)
  premult=(sa*(1-ba))[:,None]*sr+(sa*ba)[:,None]*mixed+((1-sa)*ba)[:,None]*br;rgb=np.divide(premult,alpha[:,None],out=np.zeros_like(premult),where=(alpha>0)[:,None]);rgba=np.column_stack([rgb,alpha]);rgba[sa==0]=b[sa==0];assert np.isfinite(rgba).all();results.append(rgba.astype('<f4'))
matrix=np.array([[1.7,.05,-.2,-.4],[.1,.7,.11,.01],[-.13,.08,2.1,.25]],dtype=np.float64);adjusted=np.column_stack([sr@matrix[:,:3].T+matrix[:,3],s[:,3]]).astype('<f4')
files={}
for name,value in [('source',source),('backdrop',backdrop),('mask',mask),('composites',np.stack(results)),('affine',adjusted)]:
 data=np.ascontiguousarray(value,dtype='<f4').tobytes();packed=gzip.compress(data,mtime=0);path=out/(name+'.f32le.gz');path.write_bytes(packed);files[path.name]={'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'decodedBytes':len(data),'decodedSha256':hashlib.sha256(data).hexdigest()}
manifest={'version':1,'samples':count,'modes':modes,'opacity':opacity,'matrix':matrix.ravel().tolist(),'files':files,'sourceChannelLevels':[len(np.unique(source[:,c]))for c in range(3)],'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'reference':'Independent NumPy float64 W3C compositing, source-over with float mask and opacity; straight float32 output.','referenceUrl':'https://www.w3.org/TR/2024/CRD-compositing-1-20240321/','tolerance':2**-22}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'pixels':count,'modes':len(modes),'levels':manifest['sourceChannelLevels']}))
