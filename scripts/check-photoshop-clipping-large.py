"""Bounded-row independent verification of the authored 50 MP clipping fixture."""
import hashlib,json,sys
import numpy as np
from PIL import Image
from psd_tools import PSDImage,__version__

source=Image.open(sys.argv[1]).convert('RGBA');png=Image.open(sys.argv[2]).convert('RGBA');doc=PSDImage.open(sys.argv[3])
assert source.size==png.size==doc.size==(10000,5000)
assert doc.version==2 and len(doc)==3
assert [layer.clipping_layer for layer in doc]==[False,False,True]
assert [layer.opacity for layer in doc]==[255]*3
assert doc[1].name=='Native clipping base'and doc[2].name=='Native clipped color'
preview=doc.topil(apply_icc=False).convert('RGBA')
native=doc[0].topil(apply_icc=False).convert('RGBA');base=doc[1].topil(apply_icc=False).convert('RGBA');member=doc[2].topil(apply_icc=False).convert('RGBA')
assert native.size==base.size==member.size==source.size
for y in range(0,5000,32):
 box=(0,y,10000,min(5000,y+32));original=np.array(source.crop(box));expected=original.copy()
 if y<2400 and y+32>2000:expected[max(0,2000-y):min(32,2400-y),2000:2600]=[36,104,172,255]
 assert np.array_equal(np.asarray(png.crop(box)),expected),'Native PNG samples'
 assert np.array_equal(np.asarray(preview.crop(box)),expected),'Photoshop preview samples'
 assert np.array_equal(np.asarray(native.crop(box)),original),'Complete original raster samples'
 assert np.all(np.asarray(member.crop(box))==np.array([36,104,172,255],dtype='uint8')),'Complete unclipped member samples'
 coverage=np.zeros((box[3]-box[1],10000),dtype='uint8')
 if y<2400 and y+32>2000:coverage[max(0,2000-y):min(32,2400-y),2000:2600]=255
 assert np.array_equal(np.asarray(base.crop(box))[:,:,3],coverage),'Independent base transparency'
print(json.dumps(dict(reader='psd-tools',version=__version__,dimensions=doc.size,rgbaSamplesPerImage=200000000,previewExact=True,nativePngExact=True,sourcePlaneExact=True,completeMemberPlaneExact=True,baseAlphaExact=True,clipping=[False,False,True],fileSha256=hashlib.sha256(open(sys.argv[3],'rb').read()).hexdigest(),limits='Pointwise exact fixture with binary base coverage; no full-float recomposition, desktop/color/device/peak-memory claim.')))
