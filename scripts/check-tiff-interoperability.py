"""Independent TIFF/Pillow-libTIFF gate, without any editor decoder code.

Usage: python3 scripts/check-tiff-interoperability.py cases.json
Requires Pillow and NumPy (same local image-validation environment as PSD checks).
Each case supplies path, referencePng (or rawRgba path), width, height and bigTiff.
"""
import hashlib
import io
import json
import sys
import numpy as np
from PIL import Image, ImageCms, __version__, features

Image.MAX_IMAGE_PIXELS = None  # Product geometry is not limited by this test reader.
results=[]
for case in json.load(open(sys.argv[1],encoding='utf8')):
    path=case['path']
    with open(path,'rb') as f:
        header=f.read(16)
    assert header[:2]==b'II'
    magic=int.from_bytes(header[2:4],'little')
    assert magic==(43 if case['bigTiff'] else 42), (path,magic)
    image=Image.open(path)
    assert image.size==(case['width'],case['height']) and image.mode=='RGBA'
    assert image.n_frames==1
    tags={int(k):v for k,v in image.tag_v2.items()}
    for tag,expected in [(258,(8,8,8,8)),(259,8),(262,2),(274,1),(277,4),(284,1),(296,2),(338,(2,))]:
        assert tags[tag]==expected,(path,tag,tags.get(tag))
    assert float(tags[282])==float(tags[283])==72
    assert tags[305]=='Canoli Studio'
    assert not any(tag in tags for tag in [269,270,315,33723,34377,34665,34853,37724])
    profile=bytes(tags[34675]);name=ImageCms.getProfileName(ImageCms.ImageCmsProfile(io.BytesIO(profile))).strip()
    assert 'sRGB' in name
    image.load()
    reference=Image.open(case['referencePng']).convert('RGBA') if case.get('referencePng') else Image.frombytes('RGBA',image.size,open(case['rawRgba'],'rb').read())
    assert reference.size==image.size
    maximum=0;alpha_max=0;changed=0
    # Decoder images are resident; comparison temporaries stay in bounded bands.
    for y in range(0,image.height,128):
        box=(0,y,image.width,min(image.height,y+128))
        actual=np.asarray(image.crop(box)).astype(np.int16);expected=np.asarray(reference.crop(box)).astype(np.int16)
        diff=np.abs(actual-expected);maximum=max(maximum,int(diff.max(initial=0)));alpha_max=max(alpha_max,int(diff[:,:,3].max(initial=0)));changed+=int(np.count_nonzero(diff))
    assert maximum==0,(path,'RGBA mismatch',maximum,alpha_max,changed)
    with open(path,'rb')as f:digest=hashlib.file_digest(f,'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(f.read()).hexdigest()
    results.append({'path':path,'sha256':digest,'size':image.size,'magic':magic,'tileWidth':tags[322],'tileHeight':tags[323],'tiles':len(tags[324]),'compression':tags[259],'extraSamples':tags[338],'profileName':name,'profileSha256':hashlib.sha256(profile).hexdigest(),'maxRgbaError':maximum,'maxAlphaError':alpha_max,'changedChannels':changed})
print(json.dumps({'reader':'Pillow/libtiff','pillow':__version__,'libtiff':features.version_codec('libtiff'),'cases':results,'limits':'Exact encoded-sRGB RGBA8 comparisons. Does not verify Photoshop, every TIFF reader, higher precision, CMYK/HDR, TIFF input or real multi-GiB output.'},indent=2))
