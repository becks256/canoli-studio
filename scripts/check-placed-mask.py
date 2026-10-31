"""Independent input-affine/forward homography and byte mask composition."""
import argparse,hashlib,importlib.util,json
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates
spec=importlib.util.spec_from_file_location('oracle',Path(__file__).with_name('generate-projective-field-fixtures.py'))
oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
p=argparse.ArgumentParser();p.add_argument('actual',type=Path);p.add_argument('--case',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--before',type=Path);p.add_argument('--scalar',action='store_true');a=p.parse_args()
c=json.loads(a.case.read_text());field=c['field'];source=np.frombuffer(a.source.read_bytes(),dtype='<f4').reshape(field['height'],field['width']);b=c['output'];y,x=np.mgrid[:b['height'],:b['width']]
input=c.get('input',{'origin':{'x':0,'y':0},'matrix':{'a':1,'b':0,'c':0,'d':1,'e':0,'f':0}});m=input['matrix'];origin=input['origin'];px=x+(b['x']-origin['x'])+.5;py=y+(b['y']-origin['y'])+.5
points=np.stack([m['a']*px+m['c']*py+m['e'],m['b']*px+m['d']*py+m['f'],np.ones_like(px)])
offset,inverse=oracle.homography(c['sourceWidth'],c['sourceHeight'],np.array([[p['x'],p['y']]for p in c['corners']],dtype=np.float64));mapped=np.einsum('ij,jkl->ikl',np.linalg.inv(inverse),points);valid=mapped[2]!=0;coords=np.zeros((2,b['height'],b['width']))
coords[0,valid]=mapped[1,valid]/mapped[2,valid]+offset[1]-field['y']-.5;coords[1,valid]=mapped[0,valid]/mapped[2,valid]+offset[0]-field['x']-.5
alpha=map_coordinates(source.astype(np.float64),coords,order=1,prefilter=False,mode='grid-constant',cval=0);alpha[~valid]=0;alpha=alpha.astype('<f4').ravel();actual=np.frombuffer(a.actual.read_bytes(),dtype='<f4')
if a.scalar:expected=alpha;error=float(np.abs(actual.astype(np.float64)-expected.astype(np.float64)).max());assert error<=2**-21,error;extra={}
else:
 before=np.frombuffer(a.before.read_bytes(),dtype='<f4').reshape(-1,4);actual=actual.reshape(-1,4);mask=np.floor(alpha.astype(np.float64)*255+.5)
 if c['mode']=='hide':mask=255-mask
 expected=before.copy();expected[:,3]=(before[:,3].astype(np.float64)*(mask/255).astype('<f4').astype(np.float64)).astype('<f4');expected[expected[:,3]==0]=0
 error=float(np.abs(actual[:,3].astype(np.float64)-expected[:,3].astype(np.float64)).max());assert error<=2**-21,error
 visible=actual[:,3]>0;rgb=int(np.count_nonzero(actual[visible,:3].view('<u4')!=before[visible,:3].view('<u4')));assert rgb==0,rgb;extra={'retainedRgbWordDifferences':rgb,'nonzeroAlphaSamples':int(np.count_nonzero(actual[:,3]))}
print(json.dumps({'samplesCompared':int(actual.size),'maximumAbsoluteError':error,'actualSha256':hashlib.sha256(actual.tobytes()).hexdigest(),'referenceSha256':hashlib.sha256(expected.tobytes()).hexdigest(),'reference':'Independent NumPy homography solve, input affine and SciPy constant-border interpolation, then captured byte mask composition.',**extra}))
