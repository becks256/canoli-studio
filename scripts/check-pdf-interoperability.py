"""Independent MuPDF parsing/rendering plus Pillow/NumPy native-pixel checks.

Test-only: install PyMuPDF, Pillow and NumPy in CANOLI_PDF_PYTHON's environment.
Never import the editor's PDF encoder/decoder here.
"""
import argparse, json, math
import pymupdf
import numpy as np
from PIL import Image

parser=argparse.ArgumentParser()
parser.add_argument('pdf');parser.add_argument('reference')
parser.add_argument('--dpi',type=float,default=72)
args=parser.parse_args()
reference=np.asarray(Image.open(args.reference).convert('RGBA'))
height,width=reference.shape[:2]
with pymupdf.open(args.pdf) as document:
 assert not document.is_repaired, 'Reader repaired malformed PDF'
 assert document.page_count==1 and not document.is_encrypted
 page=document[0]
 assert abs(page.rect.width-width*72/args.dpi)<max(.001,width*72/args.dpi*1e-6)
 assert abs(page.rect.height-height*72/args.dpi)<max(.001,height*72/args.dpi*1e-6)
 assert document.metadata['producer']=='Canoli Studio'
 assert document.embfile_count()==0 and not page.get_links() and not list(page.annots() or [])
 assert not page.get_text().strip(), 'Raster output must not claim searchable text'
 catalog=document.xref_object(document.pdf_catalog())
 assert '/OpenAction' not in catalog and '/JavaScript' not in catalog
 # Reconstruct image samples/soft masks independently, before reader color conversion.
 content=page.read_contents().decode('ascii')
 import re
 placements=re.findall(r'q\s+(\d+) 0 0 (\d+) (\d+) (\d+) cm\s+/(I\d+) Do\s+Q',content)
 images={item[7]:item for item in page.get_images(full=True)}
 coverage=np.zeros((height,width),dtype=np.uint8)
 for sw,sh,sx,sy,name in placements:
  w,h,x,bottom=map(int,[sw,sh,sx,sy]);y=height-bottom-h
  assert 0<=x<x+w<=width and 0<=y<y+h<=height
  item=images[name];xref,mask=item[:2]
  assert item[2:4]==(w,h) and item[4]==8,(item,w,h)
  assert '/ICCBased' in document.xref_object(xref)
  rgb=np.frombuffer(document.xref_stream(xref),dtype=np.uint8).reshape(h,w,3)
  alpha=np.frombuffer(document.xref_stream(mask),dtype=np.uint8).reshape(h,w) if mask else np.full((h,w),255,dtype=np.uint8)
  assert np.array_equal(rgb,reference[y:y+h,x:x+w,:3]), 'Stored native RGB samples differ'
  assert np.array_equal(alpha,reference[y:y+h,x:x+w,3]), 'Stored native alpha samples differ'
  coverage[y:y+h,x:x+w]+=1
 assert np.all(coverage==1), 'Tiles must cover each native pixel exactly once'
 # The second check executes the independent PDF compositor at native sampling.
 alpha_error=0;rgb_error=0
 for top in range(0,height,64):
  bottom=min(height,top+64)
  pixmap=page.get_pixmap(matrix=pymupdf.Matrix(args.dpi/72,args.dpi/72),clip=pymupdf.Rect(0,top*72/args.dpi,page.rect.width,bottom*72/args.dpi),colorspace=pymupdf.csRGB,alpha=True)
  assert pixmap.n==4 and pixmap.x<=0 and pixmap.y<=top and pixmap.x+pixmap.width>=width and pixmap.y+pixmap.height>=bottom,(pixmap.x,pixmap.y,pixmap.width,pixmap.height,top,bottom)
  pixels=np.frombuffer(pixmap.samples,dtype=np.uint8).reshape(pixmap.height,pixmap.width,4)
  rendered=pixels[top-pixmap.y:bottom-pixmap.y,-pixmap.x:width-pixmap.x].astype(np.int32)
  expected=reference[top:bottom].astype(np.int32)
  alpha_error=max(alpha_error,int(np.abs(rendered[:,:,3]-expected[:,:,3]).max()))
  expected_rgb=expected[:,:,:3]*expected[:,:,3:4]/255
  rgb_error=max(rgb_error,float(np.abs(rendered[:,:,:3]-expected_rgb).max()))
 # Pixel quantization is measured separately from exact stored samples.
 assert alpha_error<=1,alpha_error
 assert rgb_error<=2,rgb_error
 print(json.dumps({'reader':'MuPDF','version':pymupdf.__version__,'width':width,'height':height,'dpi':args.dpi,'pagePoints':[page.rect.width,page.rect.height],'tiles':len(placements),'storedRgbaExact':True,'renderAlphaError':alpha_error,'renderPremultipliedRgbError':rgb_error,'repaired':document.is_repaired,'producer':document.metadata['producer']}))
