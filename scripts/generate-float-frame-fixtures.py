"""Independent scalar-f64 projection of completed native float scene fixtures.
No application sampler, mask engine, WASM or canvas supplies expected samples.
"""
from pathlib import Path
import numpy as np
import math,gzip,json,hashlib
root=Path(__file__).resolve().parents[1];base=root/'tests/fixtures/float-transfer';out=root/'tests/fixtures/float-frame';out.mkdir(exist_ok=True);manifest=json.loads((base/'manifest.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
identity=[1,0,0,1,0,0]
frames=[
 dict(name='native',region=dict(x=0,y=0,width=131,height=79),width=131,height=79,root=identity,exact=True),
 dict(name='padded',region=dict(x=-3,y=-2,width=138,height=86),width=138,height=86,root=identity,exact=True),
 dict(name='half',region=dict(x=0,y=0,width=130,height=78),width=65,height=39,root=identity,exact=True),
 dict(name='double',region=dict(x=0,y=0,width=131,height=79),width=262,height=158,root=identity,exact=True),
 dict(name='shear',region=dict(x=-5.5,y=-7.25,width=150,height=110),width=150,height=110,root=[.75,.25,-.25,1,4.25,-3.5],exact=False),
 dict(name='quarter-turn',region=dict(x=-2,y=-3,width=100,height=140),width=100,height=140,root=[0,1,-1,0,90.25,-2.5],exact=True),
 dict(name='reflected',region=dict(x=-3.25,y=-4.5,width=150,height=90),width=150,height=90,root=[-1,0,0,.75,135.5,2.25],exact=True),
]
def cut(poly,axis,edge,above):
 result=[]
 for i,p in enumerate(poly):
  q=poly[i-1];inside=(p[axis]>=edge)if above else(p[axis]<=edge);prior=(q[axis]>=edge)if above else(q[axis]<=edge)
  if inside!=prior:
   t=(edge-q[axis])/(p[axis]-q[axis]);result.append([q[0]+(p[0]-q[0])*t,q[1]+(p[1]-q[1])*t])
  if inside:result.append(p)
 return result

def project(source,frame):
 h,w=source.shape[:2];r=frame['region'];sx=frame['width']/r['width'];sy=frame['height']/r['height'];a,b,c,d,e,f=frame['root'];a*=sx;b*=sy;c*=sx;d*=sy;e=(e-r['x'])*sx;f=(f-r['y'])*sy
 output=np.zeros((frame['height'],frame['width'],4),dtype=np.float32)
 if a==d==1 and b==c==0 and int(e)==e and int(f)==f:
  for y in range(frame['height']):
   for x in range(frame['width']):
    nx=x-int(e);ny=y-int(f)
    if 0<=nx<w and 0<=ny<h:output[y,x]=source[ny,nx]
  return output
 scale=max(abs(a),abs(b),abs(c),abs(d));aa,bb,cc,dd=a/scale,b/scale,c/scale,d/scale;det=aa*dd-bb*cc;ia,ib,ic,id=dd/det/scale,-bb/det/scale,-cc/det/scale,aa/det/scale
 corners=[[a*x+c*y+e,b*x+d*y+f]for x,y in [(0,0),(w,0),(w,h),(0,h)]];left=min(p[0]for p in corners);right=max(p[0]for p in corners);top=min(p[1]for p in corners);bottom=max(p[1]for p in corners);axis=b==c==0 or a==d==0
 for y in range(frame['height']):
  for x in range(frame['width']):
   if axis:coverage=max(0,min(x+1,right)-max(x,left))*max(0,min(y+1,bottom)-max(y,top))
   else:
    poly=[[p[0]-x,p[1]-y]for p in corners]
    for ax,edge,above in [(0,0,True),(0,1,False),(1,0,True),(1,1,False)]:
     poly=cut(poly,ax,edge,above)
     if not poly:break
    coverage=min(1,max(0,abs(sum(p[0]*poly[i-1][1]-poly[i-1][0]*p[1]for i,p in enumerate(poly)))/2))if poly else 0
   if coverage<=0:continue
   dx=x+.5-e;dy=y+.5-f;u=max(0,min(w-1,ia*dx+ic*dy-.5));v=max(0,min(h-1,ib*dx+id*dy-.5));ix=math.floor(u);iy=math.floor(v);fx=u-ix;fy=v-iy;alpha=0.;red=green=blue=0.
   for oy in range(2):
    for ox in range(2):
     weight=(fx if ox else 1-fx)*(fy if oy else 1-fy)
     if weight==0:continue
     p=source[min(h-1,iy+oy),min(w-1,ix+ox)];amount=float(p[3])*weight;alpha+=amount;red+=float(p[0])*amount;green+=float(p[1])*amount;blue+=float(p[2])*amount
   if alpha>0:output[y,x]=[red/alpha,green/alpha,blue/alpha,alpha*coverage]
 return output
files={};cases=[];native_sources=[]
for scene in manifest['scenes']:
 path=base/scene['reference'];data=path.read_bytes();assert sha(data)==manifest['files'][scene['reference']]['sha256'];native_sources.append(dict(path=str(path.relative_to(root)),sha256=sha(data),rawSha256=scene['rawSha256']));source=np.frombuffer(gzip.decompress(data),dtype='<f4').reshape(79,131,4)
 for frame in frames:
  name=scene['name']+'-'+frame['name']+'.f32le.gz';raw=project(source,frame).astype('<f4').tobytes();packed=gzip.compress(raw,mtime=0);(out/name).write_bytes(packed);files[name]=dict(bytes=len(packed),sha256=sha(packed),rawSha256=sha(raw));cases.append(dict(scene=scene['name'],layers=scene['layers'],frame=frame,reference=name,rawSha256=sha(raw)))
(out/'manifest.json').write_text(json.dumps(dict(generatorSha256=sha(Path(__file__).read_bytes()),nativeSources=native_sources,cases=cases,files=files,colorTolerance=2**-20,alphaTolerance=2**-22),indent=2)+'\n');print(len(cases),'independent frame references')
