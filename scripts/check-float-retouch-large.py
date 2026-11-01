"""Independent dense Dirichlet solve on recorded native 50 MP edit windows."""
import json,sys
import numpy as np
r=json.load(open(sys.argv[1]));w,h=r['scope']['width'],r['scope']['height'];before=np.array(r['base'],dtype=np.float32).reshape(h,w,4);actual=np.array(r['actual'],dtype=np.float32).reshape(h,w,4);rect=r['selection'];dx,dy=r['offset']['x'],r['offset']['y'];coords=[(y,x)for y in range(rect['y'],rect['y']+rect['height'])for x in range(rect['x'],rect['x']+rect['width'])];indices={p:i for i,p in enumerate(coords)};A=np.zeros((len(coords),len(coords)));b=np.zeros((len(coords),3))
for (y,x),i in indices.items():
 A[i,i]=4
 for oy,ox in [(0,-1),(0,1),(-1,0),(1,0)]:
  qy,qx=y+oy,x+ox
  b[i]+=before[y+dy,x+dx,:3].astype(np.float64)-before[qy+dy,qx+dx,:3]
  if(qy,qx)in indices:A[i,indices[qy,qx]]=-1
  else:b[i]+=before[qy,qx,:3]
reference=np.linalg.solve(A,b);expected=before.copy()
for (y,x),i in indices.items():expected[y,x,:3]=reference[i]
residual=float(np.max(np.abs(A@reference-b)));inverse_bound=float(np.max(np.linalg.solve(A,np.ones(len(coords)))));bound=inverse_bound*(1e-7+residual)+2**-23;error=float(np.max(np.abs(actual.astype(np.float64)-expected)))
assert error<=bound,(error,bound)
assert np.array_equal(actual[:,:,3].view(np.uint32),before[:,:,3].view(np.uint32))
outside=np.ones((h,w),dtype=bool)
for y,x in coords:outside[y,x]=False
assert np.array_equal(actual[outside].view(np.uint32),before[outside].view(np.uint32))
changed=int(np.count_nonzero(actual.view(np.uint32)!=before.view(np.uint32)));assert changed>0
print(json.dumps({'reference':'Independent NumPy dense Float64 Dirichlet solve from native captured target/donor windows','originalDimensions':r['dimensions'],'scope':r['scope'],'words':int(actual.size),'maxError':error,'equationAndStorageBound':bound,'alphaExact':True,'outsideExact':True,'changedWords':changed,'sourceExact':r['sourceExact']}))
