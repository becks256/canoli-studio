"""Independent SciPy direct solves and scalar donor scores for native retouch.

No editor code is imported. Inputs are rounded to Float32 before building the
four-neighbor sparse Dirichlet system; references retain Float64 solutions.
"""
from pathlib import Path
import json,gzip,hashlib,ctypes as C,ctypes.util
import numpy as np
import scipy
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve

root=Path('tests/fixtures/float-retouch');root.mkdir(parents=True,exist_ok=True)
files={}
def save(name,data):
 raw=data.tobytes();packed=gzip.compress(raw,mtime=0);(root/name).write_bytes(packed);files[name]={'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'rawSha256':hashlib.sha256(raw).hexdigest()}

w,h=17,13;y,x=np.mgrid[:h,:w]
target=np.empty((h,w,4),dtype='<f4');target[:,:,0]=4+x*.125-y*.375+np.sin(x*.7+y*.3)*2.5;target[:,:,1]=-3+x*.3+y*.13+np.cos(x*.5)*.7;target[:,:,2]=8+x*.45-y*.2+np.sin(y*.6)*3;target[:,:,3]=np.where((x+3*y)%17==0,0,np.where((x+y)%3==0,.375,.625))
target[0,0]=[-0.,4,-3,-0.]
donor=target.copy();donor[:,:,:3]=np.stack([2+x*.21+np.cos(y*.7),-5+y*.37+np.sin(x*.9),12+np.sin(x*.3+y*.7)*4],axis=2);donor[:,:,3]=np.where((3*x+y)%19==0,0,.75)
coverage=np.zeros((h,w),dtype=np.uint8);coverage[2:-2,2:-2]=((x[2:-2,2:-2]*23+y[2:-2,2:-2]*17)%255+1);coverage[3:10,9]=0;coverage[6,7]=0
save('target.f32.gz',target);save('donor.f32.gz',donor);save('coverage.u8.gz',coverage)
cases=[]
for mode in ['source','mixed']:
 for soft in [False,True]:
  mask=coverage if soft else np.where(coverage,255,0).astype(np.uint8);active=np.flatnonzero((mask.ravel()!=0)&(target[:,:,3].ravel()!=0));indices={int(p):i for i,p in enumerate(active)};A=lil_matrix((len(active),len(active)),dtype=np.float64);rhs=np.zeros((len(active),3));t=target.reshape(-1,4).astype(np.float64);d=donor.reshape(-1,4).astype(np.float64)
  for p,i in indices.items():
   A[i,i]=4
   for q in [p-1,p+1,p-w,p+w]:
    a=t[p,:3]-t[q,:3];b=d[p,:3]-d[q,:3] if d[p,3]!=0 and d[q,3]!=0 else a;rhs[i]+=np.where(np.abs(a)>np.abs(b),a,b) if mode=='mixed' else b
    if q in indices:A[i,indices[q]]=-1
    else:rhs[i]+=t[q,:3]
  A=A.tocsr();solution=spsolve(A,rhs);residual=float(np.max(np.abs(A@solution-rhs)));inverse_bound=float(np.max(spsolve(A,np.ones(len(active)))));expected=t.copy()
  for p,i in indices.items():expected[p,:3]=t[p,:3]+float(mask.ravel()[p])/255*(solution[i]-t[p,:3])
  name=mode+('-soft' if soft else '-binary');save(name+'.f64.gz',expected.astype('<f8'));cases.append({'name':name,'mode':mode,'soft':soft,'reference':name+'.f64.gz','referenceResidual':residual,'inverseInfinityBound':inverse_bound,'active':len(active)})

dw,dh=31,25;yy,xx=np.mgrid[:dh,:dw];texture=np.empty((dh,dw,4),dtype='<f4');texture[:,:,0]=(xx%7)*.5+(yy%5)*.25-2;texture[:,:,1]=(xx%7)**2*.125-5;texture[:,:,2]=((xx+yy)%3)*4;texture[:,:,3]=.375
support=np.zeros((dh,dw),dtype=np.uint8);support[10:13,11:15]=255;texture[support!=0,:3]=[1e6,-1e6,32]
ring=set();selected=np.flatnonzero(support.ravel());rgba=texture.reshape(-1,4);flat=support.ravel()
for p in selected:
 for q in [int(p)-1,int(p)+1,int(p)-dw,int(p)+dw]:
  if 0<=q<dw*dh and flat[q]==0 and rgba[q,3]!=0:ring.add(q)
winner=None;candidates=0
for dy in range(-9,10):
 for dx in range(-9,10):
  if dx==0 and dy==0:continue
  shift=dy*dw+dx;valid=True
  for p in set(map(int,selected))|ring:
   q=p+shift;px=p%dw;py=p//dw
   if not(0<=px+dx<dw and 0<=py+dy<dh) or flat[q] or rgba[q,3]==0 or rgba[q,3]<rgba[p,3]:valid=False;break
  if not valid:continue
  differences=np.array([rgba[p+shift,:3].astype(np.float64)-rgba[p,:3] for p in sorted(ring)]);mean=np.mean(differences,axis=0);score=float(np.sum(np.maximum(0,np.mean(differences**2,axis=0)-mean**2)+.01*mean**2));candidates+=1;key=(score,dx*dx+dy*dy,dy,dx)
  if winner is None or key<winner[0]:winner=(key,dx,dy)
assert winner is not None
save('donor-search.f32.gz',texture);save('donor-search.u8.gz',support)

# Original-bearing browser fixture: a periodic linear field with a local defect.
pw,ph=257,193;yy,xx=np.mgrid[:ph,:pw];clean=np.empty((ph,pw,4),dtype='<f4');clean[:,:,0]=-.25+xx/512+yy/1024+(xx%8)*.125;clean[:,:,1]=-2+xx/1024-yy/512+(yy%8)*.25;clean[:,:,2]=4+xx/256+yy/1024+((xx+yy)%8)*.5;clean[:,:,3]=.375+xx/4096+yy/8192
damaged=clean.copy();defect=(xx-128)**2+(yy-96)**2<=9;damaged[defect,:3]+=np.array([16,-8,32],dtype=np.float32);save('clean-original.f32.gz',clean);save('damaged-original.f32.gz',damaged)
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32;lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P;lib.TIFFSetField.argtypes=[P,U];lib.TIFFSetField.restype=C.c_int;lib.TIFFWriteScanline.argtypes=[P,P,U,C.c_uint16];lib.TIFFWriteScanline.restype=C.c_int;lib.TIFFClose.argtypes=[P]
def tiff(name,pixels):
 path=root/name;handle=lib.TIFFOpen(str(path).encode(),b'w');assert handle
 try:
  for tag,value in [(256,pixels.shape[1]),(257,pixels.shape[0]),(258,32),(259,8),(262,2),(274,1),(277,4),(278,32),(284,1),(339,3)]:assert lib.TIFFSetField(handle,tag,U(value))
  alpha=C.c_uint16(2);assert lib.TIFFSetField(handle,338,C.c_int(1),C.byref(alpha));profile=Path('tests/fixtures/icc-native/linear-srgb.icc').read_bytes();buf=C.create_string_buffer(profile);assert lib.TIFFSetField(handle,34675,U(len(profile)),buf)
  for row in range(pixels.shape[0]):assert lib.TIFFWriteScanline(handle,pixels[row].ctypes.data,row,0)==1
 finally:lib.TIFFClose(handle)
 raw=path.read_bytes();files[name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
tiff('damaged-original.tif',damaged)
invalid=np.zeros((3,517,4),dtype='<f4');invalid[:,:,3]=.5;invalid[-1,-1,0]=np.nan;tiff('invalid-tail.tif',invalid)
manifest={'version':1,'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'environment':{'numpy':np.__version__,'scipy':scipy.__version__},'width':w,'height':h,'cases':cases,'donor':{'width':dw,'height':dh,'radius':9,'x':winner[1],'y':winner[2],'score':winner[0][0],'candidates':candidates},'original':{'width':pw,'height':ph,'defectCenter':[128,96],'defectRadius':3},'files':files}
(root/'manifest.json').write_text(json.dumps(manifest,sort_keys=True,indent=2)+'\n');print(json.dumps({'cases':len(cases),'donor':manifest['donor'],'files':len(files),'bytes':sum(v['bytes'] for v in files.values())}))
