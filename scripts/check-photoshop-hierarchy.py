"""Independent folder/mask/plane gate using released psd-tools, Pillow and NumPy.

Large cases verify every preview/source sample and structure without allocating
an external full-frame float compositor. Small cases also force recomposition.
"""
import hashlib,json,sys
from pathlib import Path
import numpy as np
from PIL import Image
from psd_tools import PSDImage,__version__
from psd_tools.constants import Tag

def compare(actual,reference,rgb_limit=1.01,alpha_limit=0):
    a=actual if actual.mode=='RGBA' else actual.convert('RGBA')
    b=reference if reference.mode=='RGBA' else reference.convert('RGBA')
    assert a.size==b.size,(a.size,b.size)
    rgb=0.;alpha=0
    try:
        for y in range(0,a.height,64):
            box=(0,y,a.width,min(a.height,y+64))
            x=np.asarray(a.crop(box)).astype('int32');z=np.asarray(b.crop(box)).astype('int32')
            alpha=max(alpha,int(np.abs(x[:,:,3]-z[:,:,3]).max()))
            rgb=max(rgb,float(np.abs(x[:,:,:3]*x[:,:,3:4]/255-z[:,:,:3]*z[:,:,3:4]/255).max()))
        assert rgb<=rgb_limit,('premultiplied RGB',rgb,rgb_limit)
        assert alpha<=alpha_limit,('alpha',alpha,alpha_limit)
        return dict(maximumPremultipliedRgbError=rgb,maximumAlphaError=alpha)
    finally:
        if a is not actual:a.close()
        if b is not reference:b.close()

def tree(nodes):
    result=[]
    for layer in nodes:
        group=layer.is_group();mask=layer.mask
        value=dict(name=layer.name,kind='group' if group else 'pixel',visible=layer.visible,
            opacity=layer.opacity,fill=layer.tagged_blocks.get_data(Tag.BLEND_FILL_OPACITY,255),
            blend=layer.blend_mode.value.decode('ascii').strip(),
            locked=bool(layer._record.flags.transparency_protected or layer.tagged_blocks.get_data(Tag.PROTECTED_SETTING,0)),
            maskEnabled=None if mask is None else not mask.disabled)
        if group:value['children']=tree(layer)
        result.append(value)
    return result

def leaves(nodes):
    for node in nodes:
        if node.is_group():yield from leaves(node)
        else:yield node

results=[]
for case in json.loads(Path(sys.argv[1]).read_text()):
    output=PSDImage.open(case['path']);reference=Image.open(case['reference'])
    assert output.size==reference.size
    assert output._record.header.version==(2 if case['format']=='psb' else 1)
    assert output._record.header.depth==8
    structure=tree(output)
    planes=[]
    if case.get('source') or case.get('sourcePlanes'):
        source=PSDImage.open(case.get('source') or case['sourcePlanes'])
        if case.get('source'):assert structure==tree(source),(structure,tree(source))
        original=list(leaves(source));exported=list(leaves(output));assert len(original)==len(exported)
        for before,after in zip(original,exported):
            assert before.name==after.name,(before.name,after.name)
            assert before.bbox==after.bbox,(before.name,before.bbox,after.bbox)
            a=before.topil(apply_icc=False);b=after.topil(apply_icc=False)
            try:planes.append(dict(name=before.name,**compare(b,a)))
            finally:a.close();b.close()
    if case.get('expectedTree') is not None:assert structure==case['expectedTree'],(structure,case['expectedTree'])
    preview=output.topil(apply_icc=False)
    try:preview_error=compare(preview,reference)
    finally:preview.close()
    recomposed=None
    if not case.get('large'):
        image=output.composite(force=True,apply_icc=False)
        try:recomposed=compare(image,reference,3,1)
        finally:image.close()
    masks=[]
    def inspect_masks(nodes):
        for layer in nodes:
            if layer.mask:
                assert layer.mask.bbox==(0,0,output.width,output.height),(layer.name,layer.mask.bbox)
                image=layer.mask.topil();assert image.size==output.size
                try:
                    value=dict(name=layer.name,bounds=layer.mask.bbox,disabled=layer.mask.disabled,extrema=image.getextrema())
                    if case.get('expectedMaskExtrema') is not None:assert list(value['extrema'])==case['expectedMaskExtrema'],value
                    if case.get('maskAlphaReference'):
                        alpha=reference.getchannel('A');maximum=0
                        try:
                            for y in range(0,image.height,64):
                                box=(0,y,image.width,min(image.height,y+64));maximum=max(maximum,int(np.abs(np.asarray(image.crop(box)).astype('int16')-np.asarray(alpha.crop(box)).astype('int16')).max()))
                        finally:alpha.close()
                        assert maximum==0,('mask versus independent reference alpha',maximum)
                        value['maximumIndependentMaskError']=maximum
                    masks.append(value)
                finally:image.close()
            if layer.is_group():inspect_masks(layer)
    inspect_masks(output)
    reference.close()
    results.append(dict(format=case['format'],width=output.width,height=output.height,tree=structure,preview=preview_error,recomposed=recomposed,rawPlanes=planes,masks=masks,sha256=hashlib.sha256(Path(case['path']).read_bytes()).hexdigest()))
print(json.dumps(dict(reader='psd-tools',version=__version__,cases=results,limits='Encoded 8-bit RGB with ICC conversion disabled. Small cases force independent recomposition (RGB <=3, alpha <=1); every merged preview alpha and source plane alpha are exact. Large cases verify all decoded preview/plane samples and actual hierarchy/masks without a full external float compositor. Native mask source geometry/settings and off-canvas coverage are baked; this is not full Photoshop desktop/color/precision or peak-memory certification.')))
