"""Independent RGB8 clipping inputs; no Canoli implementation is imported."""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
from psd_tools import PSDImage,__version__
from psd_tools.api.layers import PixelLayer,Group
from psd_tools.constants import Compression,BlendMode,Tag

target=Path('tests/fixtures/psd/clipping');target.mkdir(exist_ok=True)
cases=[]
for name in ['normal','soft','multiply','opacity','masked','nested','hidden','wide','ungrouped','base-fill','group-member','orphan','knockout']:
 width,height=(30001,3) if name=='wide' else (32,24)
 doc=PSDImage.frompil(Image.new('RGBA',(width,height)),compression=Compression.ZIP)
 def pixels(label,array,parent=doc,xy=(0,0)):
  layer=PixelLayer.frompil(Image.fromarray(array.astype('uint8'),'RGBA'),doc,layer_name=label,left=xy[0],top=xy[1],compression=Compression.ZIP)
  parent.append(layer);return layer
 def solid(color,w=width,h=height):return np.tile(np.array(color,dtype='uint8'),(h,w,1))
 pixels('Backdrop',solid([255,255,255,255]))
 parent=doc
 if name=='nested':
  parent=Group.new('Folder',parent=doc);parent.blend_mode=BlendMode.NORMAL;parent._setting.signature=b'8BIM'
 bw,bh=(18,3) if name=='wide' else (16,12);xy=(width-24,0) if name=='wide' else (4,3)
 base=solid([255,0,0,255],bw,bh)
 if name in ['soft','multiply','opacity','masked']:base[:,:,3]=np.tile(np.array([0,64,128,255],dtype='uint8'),(bh,bw//4))
 b=pixels('Base',base,parent,xy)
 if name=='multiply':b.blend_mode=BlendMode.MULTIPLY
 if name=='opacity':b.opacity=128
 if name=='ungrouped':b._record.tagged_blocks.set_data(Tag.BLEND_CLIPPING_ELEMENTS,0)
 if name=='base-fill':b._record.tagged_blocks.set_data(Tag.BLEND_FILL_OPACITY,128)
 if name=='knockout':b._record.tagged_blocks.set_data(Tag.KNOCKOUT_SETTING,1)
 if name=='group-member':
  member=Group.new('Clipped group',parent=parent);member.blend_mode=BlendMode.NORMAL;member._setting.signature=b'8BIM';pixels('Green',solid([0,255,0,255]),member)
 else:member=pixels('Clipped green',solid([0,255,0,255]),parent)
 member.clipping_layer=True
 if name=='hidden':member.visible=False
 if name=='masked':
  from psd_tools.psd.layer_and_mask import MaskData,MaskFlags,ChannelData,ChannelInfo
  from psd_tools.constants import ChannelID
  b._record.mask_data=MaskData(top=4,left=6,bottom=10,right=12,background_color=255,flags=MaskFlags())
  channel=ChannelData(compression=Compression.ZIP);channel.set_data(bytes([0,255]*18),6,6,8,version=doc.version)
  b._channels.append(channel);b._record.channel_info.append(ChannelInfo(id=ChannelID.USER_LAYER_MASK,length=len(channel.data)+2))
 if name=='orphan':
  # Every root is clipped: native orphan behavior cannot be inferred safely.
  for layer in doc:layer.clipping_layer=True
 doc._update_record();doc._record.layer_and_mask_information.layer_info.layer_count*=-1
 path=target/(name+('.psb' if name=='wide' else '.psd'))
 with path.open('wb')as f:doc._record.write(f)
 reopened=PSDImage.open(path)
 reference=reopened.composite(viewport=(0,0,width,height),force=True,apply_icc=False).convert('RGBA')
 # The full white backdrop is analytically opaque. PIL float truncation is
 # recorded separately and cannot weaken the native alpha assertion.
 minimum=int(np.asarray(reference)[:,:,3].min());reference.putalpha(255)
 data=np.asarray(reference)
 reopened._record.image_data.set_data([data[:,:,i].tobytes()for i in range(4)],reopened._record.header)
 with path.open('wb')as f:reopened._record.write(f)
 reference.save(path.with_suffix('.png'))
 cases.append(dict(name=name,file=path.name,reference=path.with_suffix('.png').name,width=width,height=height,editable=name not in ['soft','multiply','opacity','masked','ungrouped','base-fill','group-member','orphan','knockout'],rawReferenceAlphaMinimum=minimum,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),referenceSha256=hashlib.sha256(path.with_suffix('.png').read_bytes()).hexdigest()))
(target/'manifest.json').write_text(json.dumps(dict(generator='psd-tools',version=__version__,cases=cases),indent=2)+'\n')
print(json.dumps(cases,indent=2))
