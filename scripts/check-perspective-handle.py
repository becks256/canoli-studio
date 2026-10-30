"""Independently verify native PNG alpha near a dragged image corner's warp.
The reference uses a NumPy inverse solve, polygon coverage and Pillow original
pixels. It retains only each requested native bilinear neighborhood.
"""
import argparse,importlib.util,json,hashlib
from pathlib import Path
import numpy as np
from PIL import Image
spec=importlib.util.spec_from_file_location('projective_oracle',Path(__file__).with_name('generate-projective-fixtures.py'))
oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
p=argparse.ArgumentParser();p.add_argument('actual',type=Path);p.add_argument('--case',type=Path,required=True);p.add_argument('--source',type=Path,required=True);a=p.parse_args()
case=json.loads(a.case.read_text());quad=np.array([[v['x'],v['y']]for v in case['corners']],dtype=np.float64);output=case['output']
image=Image.open(a.source).convert('RGBA');width,height=image.size;origin,inverse=oracle.homography(width,height,quad)
actual=np.frombuffer(a.actual.read_bytes(),dtype=np.uint8).reshape(output['height'],output['width'],4);expected=np.zeros((output['height'],output['width']),dtype=np.float64)
for y in range(output['height']):
 for x in range(output['width']):
  px,py=output['x']+x,output['y']+y;coverage,centroid=oracle.pixel_polygon(quad,px,py)
  if not coverage:continue
  point=inverse@np.append(np.array([px,py])-origin+centroid,1);sx,sy=np.clip(point[:2]/point[2]-.5,[0,0],[width-1,height-1]);ix,iy=int(np.floor(sx)),int(np.floor(sy));fx,fy=sx-ix,sy-iy
  alpha=[image.getpixel((min(width-1,ix+dx),min(height-1,iy+dy)))[3]for dy in range(2)for dx in range(2)]
  expected[y,x]=coverage*((1-fy)*((1-fx)*alpha[0]+fx*alpha[1])+fy*((1-fx)*alpha[2]+fx*alpha[3]))
error=np.abs(actual[:,:,3].astype(np.float64)-expected);maximum=float(error.max());assert maximum<=1,maximum;assert actual[:,:,3].max()>0
print(json.dumps({'width':width,'height':height,'samplesCompared':int(expected.size),'maximumAlphaByteError':maximum,'nonzeroAlphaSamples':int(np.count_nonzero(actual[:,:,3])),'originalSha256':hashlib.sha256(a.source.read_bytes()).hexdigest(),'reference':'Independent NumPy inverse/polygon coverage and Pillow original PNG bilinear alpha.'}))
