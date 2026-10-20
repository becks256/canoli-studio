"""Independent native 50 MP PSD input, generated with released psd-tools/Pillow."""
import hashlib,json
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage,__version__
from psd_tools.constants import Compression
source=Path('tests/fixtures/matting/native-50mp.png')
# This fixture explicitly has three opaque RGB channels; source PNG alpha is
# not part of this PSD. The separate reference records those exact input pixels.
image=Image.open(source).convert('RGB')
assert image.size==(10000,5000)
target=Path('tests/fixtures/psd/native-50mp.psd');reference=target.with_suffix('.png')
PSDImage.frompil(image,compression=Compression.RLE).save(target)
image.convert('RGBA').save(reference)
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
target.with_suffix('.json').write_text(json.dumps({'generator':'psd-tools','version':__version__,'source':str(source),'sourceSha256':digest(source),'width':10000,'height':5000,'channels':3,'precision':8,'format':'PSD v1 with RLE merged RGB','layers':0,'fileSha256':digest(target),'referenceSha256':digest(reference),'limits':'Opaque RGB fixture intentionally discards the source PNG alpha before constructing input; reference is the exact PSD RGB input, not the earlier RGBA source.'},indent=2)+'\n')
print(target,target.stat().st_size)

# Actual independent records for bounded preflight paging; no fabricated DTOs.
from psd_tools.api.layers import PixelLayer
small=PSDImage.frompil(Image.new('RGB',(16,16),(255,255,255)),compression=Compression.RLE)
for index in range(250):
 small.append(PixelLayer.frompil(Image.new('RGB',(1,1),(index%256,0,0)),small,layer_name=f'Record {index+1:03}',compression=Compression.RLE))
paged=target.with_name('paged-records.psd');small.save(paged)
paged.with_suffix('.json').write_text(json.dumps({'generator':'psd-tools','version':__version__,'width':16,'height':16,'layers':250,'sha256':digest(paged)},indent=2)+'\n')
print(paged,paged.stat().st_size)

# Preserve historical mixed-codec inputs. psd-tools 1.10.9 automatically writes
# four merged planes beneath a three-channel header after append/save. Its own
# ZIP reader rejects those merged streams (748 vs 561 bytes); they are retained
# as corruption regressions, not valid ZIP references. The dedicated ZIP fixture
# generator writes declared planes explicitly and independently verifies them.
import numpy as np
x=np.arange(17,dtype=np.uint8)[None,:];y=np.arange(11,dtype=np.uint8)[:,None]
pixels=np.stack([np.broadcast_to(x*13,(11,17)),np.broadcast_to(y*19,(11,17)),(x*7+y*11)%256],axis=-1).astype('uint8')
image=Image.fromarray(pixels,'RGB');image.convert('RGBA').save(target.with_name('zip-reference.png'))
for name,merged,layer in [('zip-layer-raw-merged',Compression.RAW,Compression.ZIP),('raw-layer-zip-merged',Compression.ZIP,Compression.RAW),('zip-unsupported',Compression.ZIP,Compression.ZIP)]:
 document=PSDImage.frompil(image,compression=merged);document.append(PixelLayer.frompil(image,document,layer_name='Codec pixels',compression=layer));path=target.with_name(name+'.psd');document.save(path);print(path,path.stat().st_size)

# Grayscale merged input must expand one source channel into neutral RGB.
gray=Image.fromarray(np.arange(187,dtype='uint8').reshape((11,17)),'L')
PSDImage.frompil(gray,compression=Compression.RLE).save(target.with_name('gray8-rle.psd'))
gray.convert('RGBA').save(target.with_name('gray8-rle.png'))
