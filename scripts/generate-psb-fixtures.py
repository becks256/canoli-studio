"""Independent PSB RLE input corpus; no editor parser/writer is imported."""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
from psd_tools import PSDImage,__version__
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Compression

target=Path('tests/fixtures/psb');target.mkdir(exist_ok=True)
cases=[]
for width in [30001,100000]:
 height=3;x=np.arange(width,dtype=np.uint32);y=np.arange(height,dtype=np.uint32)[:,None]
 pixels=np.stack([np.broadcast_to((x*37)%256,(height,width)),(x*19+y*11+7)%256,(x*11+y*23+3)%256],axis=-1).astype('uint8')
 image=Image.fromarray(pixels,'RGB');document=PSDImage.frompil(image,compression=Compression.RLE)
 # This released reader's high-level layer factory defaults channel compression
 # to PSD v1. Use its version-aware codec API explicitly for genuine PSB rows.
 layer=PixelLayer.frompil(image,document,name='Independent PSB row',compression=Compression.RAW)
 for channel,info in zip(layer._channels,layer._record.channel_info):
  raw=b'\xff'*(width*height) if int(info.id)==-1 else image.getchannel(int(info.id)).tobytes()
  channel.compression=Compression.RLE;channel.set_data(raw,width,height,8,version=2);info.length=len(channel.data)+2
 document.append(layer)
 path=target/f'rle-{width}.psb';reference=path.with_suffix('.png');document.save(path);image.convert('RGBA').save(reference)
 assert document._record.header.version==2
 cases.append({'file':path.name,'reference':reference.name,'width':width,'height':height,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'referenceSha256':hashlib.sha256(reference.read_bytes()).hexdigest()})
(target/'manifest.json').write_text(json.dumps({'generator':'psd-tools','version':__version__,'cases':cases},indent=2)+'\n')
print('Generated independent PSB fixtures:',len(cases))
