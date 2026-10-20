"""Independent PSD/PSB preview/layer gate, using released psd-tools, not editor code."""
import hashlib,json,sys
import numpy as np
from PIL import Image
from psd_tools import PSDImage,__version__

def compare(image,reference,rgb_limit,alpha_limit):
 image=image.convert('RGBA');reference=reference.convert('RGBA');assert image.size==reference.size
 maximum=0;alpha_max=0
 for y in range(0,image.height,64):
  box=(0,y,image.width,min(image.height,y+64))
  a=np.asarray(image.crop(box)).astype(np.int32);b=np.asarray(reference.crop(box)).astype(np.int32)
  alpha_max=max(alpha_max,int(np.abs(a[:,:,3]-b[:,:,3]).max()))
  maximum=max(maximum,float(np.abs(a[:,:,:3]*a[:,:,3:4]/255-b[:,:,:3]*b[:,:,3:4]/255).max()))
 assert maximum<=rgb_limit,('premultiplied RGB',maximum,rgb_limit)
 assert alpha_max<=alpha_limit,('alpha',alpha_max,alpha_limit)
 return {'maximumPremultipliedRgbError':maximum,'maximumAlphaError':alpha_max}

with open(sys.argv[1]) as source:cases=json.load(source)
results=[]
for case in cases:
 document=PSDImage.open(case['path']);reference=Image.open(case['reference'])
 assert document.size==reference.size
 assert document._record.header.version==(2 if case['format']=='psb' else 1)
 assert document._record.header.depth==8
 assert [layer.name for layer in document]==case['names']
 assert [layer.visible for layer in document]==case['visibility']
 preview=compare(document.topil(apply_icc=False),reference,1.01,0)
 if case.get('singleLayerReference'):
  assert len(document)==1 and document[0].opacity==255
  recomposed=compare(document[0].topil(apply_icc=False),reference,0,0)
 else:recomposed=compare(document.composite(force=True,apply_icc=False),reference,3,1)
 layers=[{'name':layer.name,'bbox':layer.bbox,'visible':layer.visible,'opacity':layer.opacity,'blendMode':layer.blend_mode.value.decode('ascii')} for layer in document]
 with open(case['path'],'rb') as source:digest=hashlib.file_digest(source,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(source.read()).hexdigest()
 results.append({'fileSha256':digest,'format':case['format'],'width':document.width,'height':document.height,'preview':preview,'recomposed':recomposed,'layers':layers})
print(json.dumps({'reader':'psd-tools','version':__version__,'cases':results,'limits':'Encoded 8-bit sRGB comparisons with ICC conversion disabled. Single-layer large fixtures verify decoded layer samples directly; small layered fixtures force independent recomposition. Not general Photoshop/device/color or peak-memory acceptance.'}))
