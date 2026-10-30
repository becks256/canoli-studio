"""Independent reverse-transport coverage references for placed-plane editing.
NumPy solves source-to-quad homography; SciPy samples the finite scalar field.
The origin difference is formed before division to retain subpixel precision
when a brush/coverage field is translated far from the original pixel grid.
"""
import gzip,hashlib,json,importlib.util
from pathlib import Path
import numpy as np
import scipy
from scipy.ndimage import map_coordinates
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tests/fixtures/projective-field'
spec=importlib.util.spec_from_file_location('oracle',Path(__file__).with_name('generate-projective-field-fixtures.py'));oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)

def reference(source,options):
 q=np.array([[p['x'],p['y']]for p in options['corners']],dtype=np.float64);origin,inverse=oracle.homography(options['sourceWidth'],options['sourceHeight'],q);forward=np.linalg.inv(inverse)
 b,field=options['output'],options['field'];y,x=np.mgrid[:b['height'],:b['width']];points=np.einsum('ij,jkl->ikl',forward,np.stack([x+b['x']+.5,y+b['y']+.5,np.ones_like(x)],axis=0));valid=points[2]!=0;coords=np.zeros((2,b['height'],b['width']),dtype=np.float64)
 coords[0,valid]=points[1,valid]/points[2,valid]+(origin[1]-field['y'])-.5;coords[1,valid]=points[0,valid]/points[2,valid]+(origin[0]-field['x'])-.5
 result=map_coordinates(source.astype(np.float64),coords,order=1,prefilter=False,mode='grid-constant',cval=options['background']);result[~valid]=options['background'];return result.astype('<f4')

if __name__=='__main__':
 source=np.frombuffer(gzip.decompress((OUT/'source.f32le.gz').read_bytes()),dtype='<f4').reshape(33,39);cases=[]
 definitions=[
  ('identity',31,23,[[0,0],[31,0],[31,23],[0,23]],[-7,-5,39,33],[-10,-8,48,42],0),
  ('fractional-background',31,23,[[1.125,.375],[32.125,.375],[32.125,23.375],[1.125,23.375]],[-7,-5,39,33],[-10,-8,48,42],.37),
  ('reflection',31,23,[[36,2],[2,4],[5,29],[31,26]],[-7,-5,39,33],[-15,-12,70,60],.37),
  ('perspective',31,23,[[3.25,1.125],[39.5,4.25],[31,29],[7.5,25.75]],[-7,-5,39,33],[-15,-12,70,60],1),
  ('forward-horizon',6,3,[[0,0],[6,0],[2,1],[0,1]],[-7,-15,39,33],[-12,-8,36,36],1),
  ('strong-perspective',31,23,[[1,1],[39.5,3],[7.75,30],[6,28]],[-7,-5,39,33],[-15,-12,70,60],.37),
  ('large-placement',31,23,[[1099511627779.25,-2199023255550.875],[1099511627815.5,-2199023255547.75],[1099511627807,-2199023255523],[1099511627783.5,-2199023255526.25]],[1099511627772,-2199023255556,39,33],[-15,-12,70,60],1),
 ]
 for name,w,h,q,field,output,bg in definitions:
  options={'sourceWidth':w,'sourceHeight':h,'corners':[dict(zip(['x','y'],v))for v in q],'direction':'source-to-quad','field':dict(zip(['x','y','width','height'],field)),'source':dict(zip(['x','y','width','height'],field)),'output':dict(zip(['x','y','width','height'],output)),'background':bg};raw=reference(source,options).tobytes();filename='forward-'+name+'.f32le.gz';(OUT/filename).write_bytes(gzip.compress(raw,compresslevel=9,mtime=0));cases.append({'name':name,'options':options,'reference':filename,'floatSha256':hashlib.sha256(raw).hexdigest()})
 manifest={'version':1,'reference':'Independent NumPy homography solve and SciPy grid-constant bilinear interpolation, with separately rebased coverage field.','numpy':np.__version__,'scipy':scipy.__version__,'absoluteError':2**-21,'sourceSha256':hashlib.sha256(source.tobytes()).hexdigest(),'cases':cases};(OUT/'forward-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'cases':len(cases),'samples':sum(v['options']['output']['width']*v['options']['output']['height']for v in cases)}))
