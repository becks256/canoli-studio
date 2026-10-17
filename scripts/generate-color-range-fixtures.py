"""Independent CIELAB/coverage and PNG fixtures. Requires Colour 0.4.6, NumPy, Pillow.

MPLCONFIGDIR=/tmp/canoli-colour-mpl PYTHONPATH=/path/to/colour python3 scripts/generate-color-range-fixtures.py
PNG files use Python zlib/CRC and all five filters; Pillow independently checks them.
"""
from pathlib import Path
import json, struct, zlib, binascii
import numpy as np
import colour
from PIL import Image, ImageCms

directory=Path(__file__).resolve().parents[1]/'tests/fixtures/color-range'
directory.mkdir(parents=True,exist_ok=True)
rgb_to_xyz=np.array([[.4124564,.3575761,.1804375],[.2126729,.7151522,.072175],[.0193339,.119192,.9503041]])
adapt=np.array([[1.0478112,.0228866,-.050127],[.0295424,.9904844,-.0170491],[-.0092345,.0150436,.7521316]])
white=colour.XYZ_to_xy([.96422,1,.82521])
def lab(rgb):
    linear=colour.cctf_decoding(np.asarray(rgb)/255,function='sRGB')
    return colour.XYZ_to_Lab(linear@rgb_to_xyz.T@adapt.T,illuminant=white)
def color(value): return [int(value[i:i+2],16) for i in [1,3,5]]
rng=np.random.default_rng(9511)
rgb=np.vstack([[255,0,0],[0,0,255],[128,128,128],[0,0,0],[255,255,255],rng.integers(0,256,(100,3))])
alpha=np.array([0,1,64,128,255]*21)
pixels=np.column_stack([rgb,alpha]);cases=[]
for fuzziness in [0,.5,40,200]:
    for invert in [False,True]:
        options={'colors':['#ffffff','#ca2050','#32a018'],'exclude':['#808080','#2030dc'],'fuzziness':fuzziness,'invert':invert}
        def match(colors):
            if fuzziness==0: return np.max([np.all(rgb==color(value),axis=1) for value in colors],axis=0).astype(float)
            distances=np.min([colour.difference.delta_E_CIE1976(lab(rgb),lab(color(value))) for value in colors],axis=0)
            return np.maximum(0,1-distances/fuzziness)
        coverage=match(options['colors'])*(1-match(options['exclude']))
        if invert: coverage=1-coverage
        cases.append({'options':options,'expected':np.floor(alpha*coverage+.5).astype(int).tolist()})
(directory/'reference.json').write_text(json.dumps({'generator':'Colour Science','version':colour.__version__,'pixels':pixels.flatten().tolist(),'cases':cases,'notes':'Independent sRGB decode, Lab and CIE1976 distance; editor published D50 matrices and visible-alpha falloff convention.'},indent=2)+'\n')

def chunk(name,data): return struct.pack('>I',len(data))+name+data+struct.pack('>I',binascii.crc32(name+data)&0xffffffff)
def paeth(a,b,c):
    p=a+b-c;dist=[abs(p-a),abs(p-b),abs(p-c)]
    return [a,b,c][dist.index(min(dist))]
def png(name,width,height,channels,color_type,rows,palette=None,transparency=None):
    compressor=zlib.compressobj();parts=[];previous=bytes(width*channels)
    for y,row in enumerate(rows):
        mode=y%5;filtered=bytearray(len(row))
        for i,value in enumerate(row):
            a=row[i-channels] if i>=channels else 0;b=previous[i];c=previous[i-channels] if i>=channels else 0
            predictor=[0,a,b,(a+b)//2,paeth(a,b,c)][mode]
            filtered[i]=(value-predictor)&255
        parts.append(compressor.compress(bytes([mode])+filtered));previous=row
    parts.append(compressor.flush())
    data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,color_type,0,0,0))+chunk(b'sRGB',b'\0')
    if palette is not None:data+=chunk(b'PLTE',palette)
    if transparency is not None:data+=chunk(b'tRNS',transparency)
    data+=chunk(b'IDAT',b''.join(parts))+chunk(b'IEND',b'')
    path=directory/name;path.write_bytes(data)
    image=Image.open(path).convert('RGBA');assert image.size==(width,height)
    return list(image.tobytes())

png_cases=[];width=7;height=5
for color_type,channels in [(0,1),(2,3),(3,1),(4,2),(6,4)]:
    rows=[]
    for y in range(height):
        row=[]
        for x in range(width):
            values=[(x*37+y*13)%256,(x*17+y*31)%256,(x*53+y*11)%256,[0,1,64,128,255][(x+y)%5]]
            row.extend([((x+y)%4) if color_type==3 else values[0]] if channels==1 else [values[0],values[3]] if channels==2 else values[:channels])
        rows.append(bytes(row))
    palette=bytes([255,0,0,0,255,0,0,0,255,128,128,128]) if color_type==3 else None
    transparency=bytes([0,1,128,255]) if color_type==3 else b'\0\0' if color_type==0 else bytes(6) if color_type==2 else None
    name=f'filters-type-{color_type}.png'
    rgba=png(name,width,height,channels,color_type,rows,palette,transparency)
    png_cases.append({'file':name,'width':width,'height':height,'expected':rgba})
(directory/'png-reference.json').write_text(json.dumps(png_cases,indent=2)+'\n')

# Large source is encoded scanline by scanline, without a full 50 MP RGBA array.
width=10000;height=5000
compressor=zlib.compressobj();compressed=[]
for y in range(height):
    row=bytes([255,0,0,255])*5000+bytes([0,0,255,255])*5000
    if y>=2500:row=row[20000:]+row[:20000]
    compressed.append(compressor.compress(b'\0'+row))
compressed.append(compressor.flush())
data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'sRGB',b'\0')+chunk(b'IDAT',b''.join(compressed))+chunk(b'IEND',b'')
(directory/'native-50mp.png').write_bytes(data)
image=Image.open(directory/'native-50mp.png');assert image.getpixel((0,0))==(255,0,0,255) and image.getpixel((9999,4999))==(255,0,0,255)
Image.fromarray(np.array([[0,65535]],dtype=np.uint16)).save(directory/'unsupported-16bit.png')
profile=bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes())
profile[24:36]=struct.pack('>6H',2026,10,15,0,0,0)
Image.new('RGBA',(2,1),(255,0,0,255)).save(directory/'unsupported-profile.png',icc_profile=bytes(profile))
