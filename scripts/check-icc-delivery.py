"""Independent Pillow/Little CMS and MuPDF checks of converted RGB8 delivery.

Usage: python check-icc-delivery.py source.png target.icc output.png output.tif output.pdf
No editor encoder/decoder is used here. Input samples are raw sRGB8.
"""
import hashlib, io, json, re, sys
from PIL import Image, ImageCms, features
import numpy as np
import pymupdf
Image.MAX_IMAGE_PIXELS=None
source_path,profile_path,png_path,tiff_path,pdf_path=sys.argv[1:]
profile=open(profile_path,'rb').read()
source=Image.open(source_path).convert('RGBA')
target=ImageCms.ImageCmsProfile(io.BytesIO(profile))
transform=ImageCms.buildTransform(ImageCms.createProfile('sRGB'),target,'RGB','RGB',renderingIntent=1)
expected=ImageCms.applyTransform(source.convert('RGB'),transform)
expected.putalpha(source.getchannel('A'))
reference=np.asarray(expected)
results=[]
for path in [png_path,tiff_path]:
 image=Image.open(path)
 assert image.size==source.size and image.info.get('icc_profile')==profile,(path,'geometry/profile')
 for page in range(getattr(image,'n_frames',1)):
  image.seek(page)
  assert image.info.get('icc_profile')==profile
  actual=np.asarray(image.convert('RGBA'))
  error=int(np.abs(actual.astype(np.int16)-reference.astype(np.int16)).max())
  assert error==0,(path,page,'stored RGBA',error)
  results.append(dict(format=image.format,page=page,width=image.width,height=image.height,maximumRgbaError=error))
with pymupdf.open(pdf_path)as document:
 assert not document.is_repaired and len(document)==1
 image=document[0].get_images(full=True)[0]
 xref,mask,width,height=image[:4]
 assert (width,height)==source.size
 declaration=document.xref_object(xref)
 profile_xref=int(re.search(r'/ICCBased\s+(\d+)\s+0\s+R',declaration).group(1))
 assert document.xref_stream(profile_xref)==profile
 actual=np.empty((height,width,4),dtype=np.uint8)
 actual[:,:,:3]=np.frombuffer(document.xref_stream(xref),dtype=np.uint8).reshape(height,width,3)
 actual[:,:,3]=np.frombuffer(document.xref_stream(mask),dtype=np.uint8).reshape(height,width)if mask else 255
 error=int(np.abs(actual.astype(np.int16)-reference.astype(np.int16)).max())
 assert error==0,('PDF stored RGBA',error)
 results.append(dict(format='PDF',width=width,height=height,maximumRgbaError=error,repaired=document.is_repaired))
print(json.dumps(dict(readers=dict(pillow=Image.__version__,lcms=features.version('littlecms2'),mupdf=pymupdf.__version__),profileSha256=hashlib.sha256(profile).hexdigest(),sourceRgbaSha256=hashlib.sha256(source.tobytes()).hexdigest(),cases=results),indent=2))
