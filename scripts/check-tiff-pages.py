"""Independent main-IFD/Pillow-libTIFF multipage output check; no editor imports.
Usage: python3 scripts/check-tiff-pages.py cases.json
Each case has path, bigTiff, and ordered pages [{referencePng}].
"""
import hashlib, io, json, struct, sys
import numpy as np
from PIL import Image, ImageCms, __version__, features
Image.MAX_IMAGE_PIXELS = None
results=[]
for case in json.load(open(sys.argv[1],encoding='utf8')):
    with open(case['path'],'rb') as f:
        header=f.read(16)
    assert header[:2]==b'II'
    big=struct.unpack('<H',header[2:4])[0]==43
    assert big==case['bigTiff']
    if big:assert header[4:8]==b'\x08\0\0\0'
    pages=[]
    with Image.open(case['path']) as image:
        assert image.n_frames==len(case['pages'])
        for index,source in enumerate(case['pages']):
            image.seek(index);tags=dict(image.tag_v2.items());reference=Image.open(source['referencePng']).convert('RGBA')
            assert image.size==reference.size and image.mode=='RGBA'
            assert tags[258]==(8,8,8,8)and tags[259]==8 and tags[262]==2 and tags[338]==(2,)
            assert tags[274]==1 and tags[277]==4 and tags[284]==1
            assert float(tags[282])==float(tags[283])==72 and tags[296]==2
            if image.n_frames>1:assert tags[254]==2 and tags[297]==(index,image.n_frames)
            profile=bytes(tags[34675]);name=ImageCms.getProfileName(ImageCms.ImageCmsProfile(io.BytesIO(profile))).strip();assert 'sRGB'in name
            assert not any(tag in tags for tag in [269,270,285,315,33723,34377,34665,34853,37724])
            image.load();maximum=0;samples=0;digest=hashlib.sha256()
            for y in range(0,image.height,64):
                box=(0,y,image.width,min(image.height,y+64));actual=np.asarray(image.crop(box).convert('RGBA'));expected=np.asarray(reference.crop(box))
                maximum=max(maximum,int(np.abs(actual.astype(np.int16)-expected.astype(np.int16)).max(initial=0)));samples+=actual.size;digest.update(actual.tobytes())
            assert maximum==0,(case['path'],index,maximum)
            pages.append({'page':index,'size':image.size,'rgbaSamples':samples,'rgbaSha256':digest.hexdigest(),'maximumChannelError':maximum,'profileSha256':hashlib.sha256(profile).hexdigest(),'tiles':len(tags[324])})
    with open(case['path'],'rb')as f:
        digest=hashlib.sha256()
        for block in iter(lambda:f.read(1024*1024),b''):digest.update(block)
    results.append({'path':case['path'],'bigTiff':big,'sha256':digest.hexdigest(),'pages':pages})
print(json.dumps({'reader':'Pillow/libtiff','pillow':__version__,'libtiff':features.version_codec('libtiff'),'cases':results,'passed':True},indent=2))
