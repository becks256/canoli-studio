"""Independent complete RGBA8 comparisons for the real 50 MP SVG clip workflow."""
import json,sys,hashlib
import numpy as np
from PIL import Image
source=Image.open(sys.argv[1]).convert('RGBA');assert source.size==(10000,5000)
cases=json.load(open(sys.argv[2]));results=[]
for item in cases:
 actual=Image.open(item['path']).convert('RGBA');assert actual.size==source.size
 for y in range(0,5000,32):
  box=(0,y,10000,min(5000,y+32));original=np.asarray(source.crop(box));expected=original.copy()if item['released']else np.zeros(original.shape,dtype='uint8')
  if not item['released']and y<2400 and y+32>2000:expected[max(0,2000-y):min(32,2400-y),2000:2600]=original[max(0,2000-y):min(32,2400-y),2000:2600]
  assert np.array_equal(np.asarray(actual.crop(box)),expected),(item['path'],y)
 results.append({'path':item['path'],'rgbaSamples':200000000,'exact':True,'released':item['released'],'sha256':hashlib.sha256(open(item['path'],'rb').read()).hexdigest()})
print(json.dumps({'reader':'Independent Pillow/NumPy, no editor code imported','cases':results,'limits':'Exact integer clipping fixture and complete original pixels; no general SVG sampling, device or memory guarantee.'}))
