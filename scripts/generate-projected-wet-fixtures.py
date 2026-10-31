"""Independent NumPy DLT/bilinear references for coupled wet RGBA + coverage.
No editor geometry, compiled settings, worker, renderer or WASM code is used.
"""
from pathlib import Path
import copy,gzip,json,hashlib
import numpy as np
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/projected-wet';out.mkdir(exist_ok=True)
rng=np.random.default_rng(128473);width,height=39,33
coverage=rng.random((height,width)).astype(np.float32);alpha=(coverage*rng.random((height,width))).astype(np.float32)
pixels=np.empty((height,width,5),dtype=np.float32);pixels[:,:,:3]=(rng.random((height,width,3))*alpha[:,:,None]).astype(np.float32);pixels[:,:,3]=alpha;pixels[:,:,4]=coverage
pixels[10,12]=[0,0,0,0,1];pixels[3,4]=0

def emit(name,array):
 data=array.astype('<f4').tobytes();(out/name).write_bytes(gzip.compress(data,mtime=0));return hashlib.sha256(data).hexdigest()
source_sha=emit('source.f32le.gz',pixels)

def homography(w,h,quad):
 src=[(0,0),(w,0),(w,h),(0,h)];rows=[];values=[]
 for (x,y),(u,v) in zip(src,quad):
  rows.extend([[x,y,1,0,0,0,-u*x,-u*y],[0,0,0,x,y,1,-v*x,-v*y]]);values.extend([u,v])
 return np.r_[np.linalg.solve(np.asarray(rows,dtype=np.float64),values),1].reshape(3,3)

def expected(o):
 quad=np.asarray([[p['x'],p['y']]for p in o['corners']],dtype=np.float64);origin=quad[0];matrix=homography(o['sourceWidth'],o['sourceHeight'],quad-origin)
 field=o['field'];target=o['output'];xx,yy=np.meshgrid(np.arange(target['width'],dtype=np.float64)+target['x'],np.arange(target['height'],dtype=np.float64)+target['y'])
 if o.get('direction')=='source-to-quad':
  if 'input'in o:
   i=o['input'];a=i['matrix'];x=xx-i['origin']['x']+.5;y=yy-i['origin']['y']+.5;xx=a['a']*x+a['c']*y+a['e'];yy=a['b']*x+a['d']*y+a['f']
  else:xx=xx+.5;yy=yy+.5
  q=matrix@np.stack([xx.ravel(),yy.ravel(),np.ones(xx.size)])
  with np.errstate(divide='ignore',invalid='ignore'):u=q[0]/q[2]+(origin[0]-field['x'])-.5;v=q[1]/q[2]+(origin[1]-field['y'])-.5
 else:
  q=np.linalg.inv(matrix)@np.stack([(xx-origin[0]+.5).ravel(),(yy-origin[1]+.5).ravel(),np.ones(xx.size)])
  with np.errstate(divide='ignore',invalid='ignore'):u=q[0]/q[2]-field['x']-.5;v=q[1]/q[2]-field['y']-.5
 result=np.zeros((xx.size,5),dtype=np.float64)
 valid=np.isfinite(u)&np.isfinite(v)&(u>=-1)&(v>=-1)&(u<width)&(v<height)
 for index in np.nonzero(valid)[0]:
  x=int(np.floor(u[index]));y=int(np.floor(v[index]));fx=u[index]-x;fy=v[index]-y
  for dy in range(2):
   for dx in range(2):
    if 0<=x+dx<width and 0<=y+dy<height:result[index]+=pixels[y+dy,x+dx].astype(np.float64)*((fx if dx else 1-fx)*(fy if dy else 1-fy))
 return result.reshape(target['height'],target['width'],5).astype(np.float32)
rows=[]
for filename in ['manifest.json','forward-manifest.json']:
 for case in json.loads((root/'tests/fixtures/projective-field'/filename).read_text())['cases']:
  if case['name']in ['constant-one-border','fractional-background']:continue
  options=copy.deepcopy(case['options']);options['background']=0
  name=('forward-'if filename.startswith('forward')else'')+case['name'];reference=name+'.f32le.gz';digest=emit(reference,expected(options));rows.append({'name':name,'options':options,'reference':reference,'floatSha256':digest})
base=copy.deepcopy(rows[-1]['options']);base['output']={'x':2**40,'y':-(2**40),'width':20,'height':15};base['input']={'origin':{'x':2**40+.125,'y':-(2**40)+.375},'matrix':{'a':1,'b':.125,'c':-.25,'d':1,'e':7.125,'f':.375}};reference='affine-large-origin.f32le.gz';rows.append({'name':'affine-large-origin','options':base,'reference':reference,'floatSha256':emit(reference,expected(base))})
manifest={'version':1,'reference':'Independent NumPy DLT and bilinear five-channel fields; fixed relative frames for large coordinates.','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'absoluteError':2e-7,'sourceSha256':source_sha,'cases':rows};(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(rows),'source':source_sha}))
