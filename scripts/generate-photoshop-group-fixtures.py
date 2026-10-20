"""Independent layered PSD/PSB group and backdrop references (psd-tools 1.10.9)."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage, __version__
from psd_tools.api.layers import Group, PixelLayer
from psd_tools.constants import BlendMode, ChannelID, Compression, ProtectedFlags, Tag
from psd_tools.psd.layer_and_mask import ChannelData, ChannelDataList, ChannelInfo, MaskData, MaskFlags

target=Path('tests/fixtures/psd/groups');target.mkdir(exist_ok=True)
cases=[]
digest=lambda data:hashlib.sha256(data).hexdigest()

def folder(name,mode,parent,origin=(0,0)):
    group=Group.new(name,parent=parent);group.blend_mode=mode;group._setting.signature=b'8BIM'
    group._record.left,group._record.top=origin
    group._record.right,group._record.bottom=origin
    return group

def pixels(name,color,size,xy,parent,document,mode=BlendMode.NORMAL):
    image=Image.new('RGBA',size,color)
    layer=PixelLayer.frompil(image,document,layer_name=name,left=xy[0],top=xy[1],compression=Compression.ZIP)
    layer.blend_mode=mode;parent.append(layer)
    return layer

for name,mode,opacity,masked,hidden,locked,wide in [
    ('normal',BlendMode.NORMAL,255,False,False,False,False),
    ('multiply-group',BlendMode.MULTIPLY,255,False,False,False,False),
    ('pass',BlendMode.PASS_THROUGH,255,False,False,False,False),
    ('pass-opacity',BlendMode.PASS_THROUGH,128,False,False,False,False),
    ('normal-opacity',BlendMode.NORMAL,128,False,False,False,False),
    ('pass-mask',BlendMode.PASS_THROUGH,255,True,False,False,False),
    ('pass-opacity-mask',BlendMode.PASS_THROUGH,128,True,False,False,False),
    ('normal-mask',BlendMode.NORMAL,255,True,False,False,False),
    ('hidden',BlendMode.PASS_THROUGH,255,False,True,False,False),
    ('locked',BlendMode.NORMAL,255,False,False,True,False),
    ('alpha-locked',BlendMode.NORMAL,255,False,False,True,False),
    ('wide-psb',BlendMode.PASS_THROUGH,255,False,False,False,True),
]:
    width,height=(100000,3) if wide else (32,24)
    document=PSDImage.frompil(Image.new('RGBA',(width,height)),compression=Compression.ZIP)
    pixels('Backdrop',(255,0,0,255),(width,height),(0,0),document,document)
    outer=folder('Outer Ω',mode,document,(4,0) if wide else (4,3));outer.opacity=opacity;outer.visible=not hidden
    pixels('Multiply green',(0,255,0,255),(width-10,3) if wide else (12,8),(6,0) if wide else (6,5),outer,document,BlendMode.MULTIPLY)
    nested=folder('Inner isolated',BlendMode.NORMAL,outer,(8,0) if wide else (8,4))
    pixels('Blue',(0,0,255,255),(8,3) if wide else (8,8),(12,0) if wide else (12,6),nested,document)
    pixels('Screen white',(255,255,255,255),(5,3) if wide else (5,7),(9,0) if wide else (9,7),nested,document,BlendMode.SCREEN)
    pixels('Top yellow',(255,255,0,255),(6,3) if wide else (6,4),(8,0) if wide else (8,11),document,document)
    if name=='alpha-locked':outer._record.flags.transparency_protected=True
    elif locked:outer._record.tagged_blocks.set_data(Tag.PROTECTED_SETTING,int(ProtectedFlags.COMPLETE))
    if masked:
        # This released factory aliases header and bounding-divider channel
        # lists. Own the header list before adding the mask channel.
        outer._channels=ChannelDataList(list(outer._channels))
        coverage=np.where(np.indices((9,11)).sum(axis=0)%3==0,0,255).astype('uint8')
        outer._record.mask_data=MaskData(top=5,left=6,bottom=14,right=17,background_color=255,flags=MaskFlags())
        channel=ChannelData(compression=Compression.ZIP);channel.set_data(coverage.tobytes(),11,9,8,version=document.version)
        outer._channels.append(channel);outer._record.channel_info.append(ChannelInfo(id=ChannelID.USER_LAYER_MASK,length=len(channel.data)+2))
    document._update_record();document._record.layer_and_mask_information.layer_info.layer_count*=-1
    path=target/(name+('.psb' if wide else '.psd'))
    # Reopen the actual binary before rendering the independent reference.
    with path.open('wb') as file:document._record.write(file)
    reopened=PSDImage.open(path)
    assert reopened[1].name=='Outer Ω' and len(reopened[1])==2 and len(reopened[1][1])==2
    assert reopened[1].blend_mode==mode
    reference=reopened.composite(viewport=(0,0,width,height),force=True,apply_icc=False).convert('RGBA')
    raw_alpha=np.asarray(reference)[:,:,3]
    alpha_minimum=int(raw_alpha.min())
    assert alpha_minimum>=254
    # An opaque full-canvas backdrop under source-over/blend layers must stay
    # opaque. The independent PIL wrapper truncates some float values below 1
    # to 254; preserve the analytical invariant instead of allowing alpha error.
    reference.putalpha(255)
    data=np.asarray(reference).astype('uint16');alpha=data[:,:,3:4]
    matte=(data[:,:,:3]*alpha+255*(255-alpha)+127)//255
    reopened._record.image_data.set_data([matte[:,:,i].astype('uint8').tobytes() for i in range(3)]+[data[:,:,3].astype('uint8').tobytes()],reopened._record.header)
    with path.open('wb') as file:reopened._record.write(file)
    reference.save(path.with_suffix('.png'))
    decoded=PSDImage.open(path)
    assert decoded[1].blend_mode==mode and decoded[1].opacity==opacity
    if name=='alpha-locked':assert decoded[1]._record.flags.transparency_protected and Tag.PROTECTED_SETTING not in decoded[1]._record.tagged_blocks
    cases.append(dict(file=path.name,reference=path.with_suffix('.png').name,width=width,height=height,blendMode='pass-through' if mode==BlendMode.PASS_THROUGH else 'multiply' if mode==BlendMode.MULTIPLY else 'normal',opacity=opacity,masked=masked,hidden=hidden,locked=locked,sha256=digest(path.read_bytes()),referenceSha256=digest(path.with_suffix('.png').read_bytes()),rgbaSha256=digest(reference.tobytes()),records=len(decoded._record.layer_and_mask_information.layer_info.layer_records),independentRawAlphaMinimum=alpha_minimum,alphaReference='Canonical opaque-backdrop invariant; independent RGB retained.'))
    print(path,path.stat().st_size,flush=True)

# Full native source preservation with a pointwise, independently calculated
# pass-through multiply patch. Avoid a full-frame float compositor allocation.
source=Image.open('tests/fixtures/psd/native-50mp.png').convert('RGBA')
data=np.array(source);assert data[:,:,3].min()==255
# Choose an actual nonzero opaque source point. A green multiply patch over
# black is a no-op and cannot prove group opacity, movement or undo pixels.
nonzero=np.argwhere(data[:1024,:1024,0]>0)
patch_y,patch_x=map(int,nonzero[len(nonzero)//2])
region=data[patch_y:patch_y+600,patch_x:patch_x+1000,:3].astype('uint16')
after=region.copy();after[:,:,0]=0;after[:,:,2]=0
mixed=((region*127+after*128+127)//255).astype('uint8')
changed_pixels=int(np.any(region!=mixed,axis=2).sum());assert changed_pixels>0
data[patch_y:patch_y+600,patch_x:patch_x+1000,:3]=mixed
reference=Image.fromarray(data,'RGBA')
document=PSDImage.frompil(reference,compression=Compression.ZIP)
pixels('Native source',(0,0,0,255),(1,1),(0,0),document,document)
document.pop()
background=PixelLayer.frompil(source,document,layer_name='Native source',compression=Compression.ZIP);document.append(background)
outer=folder('Native pass',BlendMode.PASS_THROUGH,document,(patch_x,patch_y));outer.opacity=128
pixels('Multiply source',(0,255,0,255),(1000,600),(patch_x,patch_y),outer,document,BlendMode.MULTIPLY)
document._update_record();document._record.layer_and_mask_information.layer_info.layer_count*=-1
path=target/'native-50mp-group.psd'
with path.open('wb') as file:document._record.write(file)
reference.save(path.with_suffix('.png'))
reopened=PSDImage.open(path);assert reopened.size==(10000,5000) and reopened[1].blend_mode==BlendMode.PASS_THROUGH
cases.append(dict(file=path.name,reference=path.with_suffix('.png').name,width=10000,height=5000,blendMode='pass-through',opacity=128,masked=False,hidden=False,locked=False,patchOrigin=[patch_x,patch_y],changedPixels=changed_pixels,sha256=digest(path.read_bytes()),referenceSha256=digest(path.with_suffix('.png').read_bytes()),rgbaSha256=digest(reference.tobytes()),records=len(reopened._record.layer_and_mask_information.layer_info.layer_records),referenceMethod='Independent NumPy encoded-RGB opaque backdrop/multiply/opacity formula with a required nonzero effect; no app code or full-frame float compositor.'))
print(path,path.stat().st_size,flush=True)
Image.new('RGBA',(1,1),(0,0,255,128)).save(target/'alpha-blue.png')
Image.new('RGBA',(1,1),(255,0,0,128)).save(target/'alpha-red.png')

(target/'manifest.json').write_text(json.dumps(dict(generator='psd-tools',version=__version__,notes='Small/wide references are independently composited after reopening the serialized file. The native 50 MP reference uses an explicit pointwise NumPy formula. RGB primary colors keep ordinary cases exact; fractional group-opacity comparisons may allow one byte for native premultiplied rounding. This is not Photoshop desktop/color/precision certification.',cases=cases),indent=2)+'\n')
