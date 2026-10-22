"""Independent synthetic DNG sensor files and native LibRaw reference samples.

No application encoder/decoder is used. Requires NumPy and the pinned upstream
dcraw_emu native executable. --large emits the genuine 50 MP source compressed
with gzip for repository storage; tests import its complete uncompressed bytes.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import struct
import subprocess
import tempfile
import zlib
import numpy as np

parser=argparse.ArgumentParser()
parser.add_argument('--reference',type=Path,required=True)
parser.add_argument('--large',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/raw';out.mkdir(parents=True,exist_ok=True)
matrix=[3.2404542,-1.5371385,-0.4985314,-0.9692660,1.8760108,0.0415560,0.0556434,-0.2040259,1.0572252]

def dng(width=64,height=48,orientation=1,pattern=(0,1,1,2),wb=True,calibration=True,linear=False,active=False,mono=False,alpha=False):
    x=np.arange(width,dtype=np.uint32)[None,:];y=np.arange(height,dtype=np.uint32)[:,None]
    if width*height>1_000_000:x=(x//1000)*300;y=(y//1000)*200
    rgb=np.empty((height,width,3),dtype=np.uint16)
    rgb[:,:,0]=64+(x*29+y*7)%3600;rgb[:,:,1]=64+(x*11+y*31)%3600;rgb[:,:,2]=64+(x*23+y*17)%3600
    if alpha:
        coverage=np.broadcast_to(((x+y)*1499)%65536,(height,width)).astype(np.uint16)
        pixels=np.concatenate([rgb,coverage[:,:,None]],axis=2)
    elif mono:pixels=rgb[:,:,0]
    elif linear: pixels=rgb
    else:
        cfa=np.array(pattern,dtype=np.uint8).reshape(2,2)
        channels=cfa[np.arange(height)[:,None]%2,np.arange(width)[None,:]%2]
        pixels=np.take_along_axis(rgb,channels[:,:,None],axis=2)[:,:,0]
    payload=pixels.astype('<u2').tobytes()
    tags=[]
    def tag(code,kind,values):
        if kind in (1,2,7): data=values if isinstance(values,bytes) else bytes(values);count=len(data)
        elif kind==3: count=len(values);data=struct.pack('<'+'H'*count,*values)
        elif kind==4: count=len(values);data=struct.pack('<'+'I'*count,*values)
        elif kind in (5,10):
            count=len(values);data=b''.join(struct.pack('<ii'if kind==10 else '<II',int(round(value*10000000)),10000000)for value in values)
        else: raise ValueError(kind)
        tags.append((code,kind,count,data))
    channels=4 if alpha else 3 if linear and not mono else 1
    for code,kind,values in [(254,4,[0]),(256,4,[width]),(257,4,[height]),(258,3,[16]*channels),(259,3,[1]),(262,3,[34892 if linear or mono or alpha else 32803]),
        (271,2,b'Canoli synthetic\0'),(272,2,b'Independent DNG fixture\0'),(273,4,[0]),(274,3,[orientation]),(277,3,[channels]),(278,4,[height]),(279,4,[len(payload)]),(284,3,[1]),
        (50706,1,[1,4,0,0]),(50707,1,[1,4,0,0]if alpha else[1,1,0,0]),(50708,2,b'Canoli synthetic independent sensor\0'),(50710,1,[0,1,2]),(50711,3,[1]),(50713,3,[1,1]),(50714,5,[64]),(50717,4,[4095]),
        (50718,5,[1,1]),(50719,4,[0,0]),(50720,4,[width-8 if active else width,height-4 if active else height]),(50727,5,[1]if mono else[1,1,1]),(50730,10,[0]),(50778,3,[21]),
        (50829,4,[2,4,height-2,width-4]if active else[0,0,height,width])]:tag(code,kind,values)
    if not linear and not mono and not alpha:tag(33421,3,[2,2]);tag(33422,1,pattern)
    if alpha:tag(338,3,[2])
    if wb:tag(50728,5,[1]if mono else[0.5,1,2/3])
    if calibration and not mono:tag(50721,10,matrix)
    tags.sort();extra=bytearray();entries=[];base=8+2+len(tags)*12+4
    for code,kind,count,data in tags:
        if len(data)<=4:value=data.ljust(4,b'\0')
        else:
            if len(extra)%2:extra.append(0)
            value=struct.pack('<I',base+len(extra));extra.extend(data)
        entries.append(bytearray(struct.pack('<HHI',code,kind,count)+value))
    if len(extra)%2:extra.append(0)
    offset=base+len(extra)
    for entry in entries:
        if struct.unpack_from('<H',entry)[0]==273:struct.pack_into('<I',entry,8,offset)
    return b'II*\0'+struct.pack('<I',8)+struct.pack('<H',len(tags))+b''.join(entries)+struct.pack('<I',0)+extra+payload

def ppm(path):
    # Native dcraw_emu emits a plain P6 header followed by big-endian RGB16.
    data=path.read_bytes();position=0;tokens=[]
    while len(tokens)<4:
        while data[position]in b' \t\r\n':position+=1
        if data[position]==35:
            position=data.index(b'\n',position)+1;continue
        end=position
        while data[end]not in b' \t\r\n':end+=1
        tokens.append(data[position:end]);position=end
    assert tokens[0]in [b'P6',b'P5']and tokens[3]==b'65535',tokens
    channels=3 if tokens[0]==b'P6'else 1
    position+=1;width,height=map(int,tokens[1:3]);samples=np.frombuffer(data[position:],dtype='>u2').astype('<u2')
    assert samples.size==width*height*channels,(samples.size,width,height)
    return width,height,samples.reshape(height,width,channels)

def png(path,rgb):
    values=np.arange(65536,dtype=np.float64)/65535
    encoded=np.where(values<=0.0031308,12.92*values,1.055*np.power(values,1/2.4)-0.055)
    lut=np.floor(np.clip(encoded,0,1)*255+0.5).astype(np.uint8)
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body)&0xffffffff)
    height,width=rgb.shape[:2];compress=zlib.compressobj();parts=[]
    for row in rgb:
        rgba=np.empty((width,4),dtype=np.uint8);rgba[:,:3]=lut[row];rgba[:,3]=255
        parts.append(compress.compress(b'\0'+rgba.tobytes()))
    parts.append(compress.flush())
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,6,0,0,0))+chunk(b'IDAT',b''.join(parts))+chunk(b'IEND',b''))

cases=[]
def record(name,development=None,**settings):
    options={'whiteBalance':'camera'if settings.get('wb',True)else'auto',**(development or{})}
    source=dng(**settings);path=out/(name+'.dng');large=len(source)>10_000_000
    if large:(out/(path.name+'.gz')).write_bytes(gzip.compress(source,mtime=0))
    else:path.write_bytes(source)
    with tempfile.TemporaryDirectory(prefix='canoli-raw-reference-')as directory:
        temporary=Path(directory);input_path=temporary/path.name;input_path.write_bytes(source);reference=temporary/'native.ppm'
        quality={'linear':0,'vng':1,'ppg':2,'ahd':3,'dcb':4,'dht':11,'aahd':12}[options.get('demosaic','ahd')]
        command=[str(args.reference.resolve()),'-4','-W','-c','0','-o','1','-q',str(quality),'-H',str(options.get('highlights',0)),'-Z',str(reference)]
        mode=options['whiteBalance']
        if mode=='camera':command+=['-w']
        elif mode=='auto':command+=['-a']
        elif mode=='custom':
            gains=options['multipliers'];command+=['-r',str(gains['red']),str(gains['green']),str(gains['blue']),str(gains['green'])]
        if options.get('exposure',0):command+=['-aexpo',str(2**options['exposure']),str(options.get('highlightPreservation',0))]
        command.append(str(input_path))
        run=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        if run.returncode or not reference.exists():raise RuntimeError((command,run.returncode,run.stdout,run.stderr))
        width,height,samples=ppm(reference);raw=samples.tobytes();reference_name=name+'.rgb16le'+('.gz'if large else'')
        (out/reference_name).write_bytes(gzip.compress(raw,mtime=0)if large else raw)
        png(out/(name+'.png'),samples)
    cases.append({'file':path.name+('.gz'if large else''),'reference':reference_name,'png':name+'.png','sha256':hashlib.sha256(source).hexdigest(),'rgb16Sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(source),'width':width,'height':height,'channels':samples.shape[2],'rawWidth':settings.get('width',64),'rawHeight':settings.get('height',48),'options':options,'synthetic':True})

for name,pattern in [('rggb',(0,1,1,2)),('grbg',(1,0,2,1)),('gbrg',(1,2,0,1)),('bggr',(2,1,1,0))]:record('bayer-'+name,pattern=pattern)
for orientation in range(2,9):record('orientation-'+str(orientation),orientation=orientation)
record('active-area',active=True);record('no-camera-wb',wb=False);record('linear-rgb16',linear=True)
record('monochrome16',mono=True)
for quality in ['linear','vng','ppg','dcb','dht','aahd']:record('quality-'+quality,development={'demosaic':quality})
record('daylight',development={'whiteBalance':'daylight'})
record('auto-white-balance',development={'whiteBalance':'auto'})
record('custom-white-balance',development={'whiteBalance':'custom','multipliers':{'red':2.3,'green':1,'blue':0.8}})
record('exposure-down',development={'exposure':-2})
record('exposure-up',development={'exposure':1.25,'highlightPreservation':0.5})
for highlight in [1,2,3,9]:record('highlights-'+str(highlight),development={'highlights':highlight})
(out/'no-calibration.dng').write_bytes(dng(calibration=False))
(out/'extra-samples.dng').write_bytes(dng(alpha=True))
if args.large:record('native-50mp',width=10000,height=5000)
values=np.arange(65536,dtype=np.float64)/65535
encoded=np.where(values<=0.0031308,12.92*values,1.055*np.power(values,1/2.4)-0.055)
(out/'srgb8-lut.bin').write_bytes(np.floor(np.clip(encoded,0,1)*255+0.5).astype(np.uint8).tobytes())
(out/'manifest.json').write_text(json.dumps({'generator':'Independent TIFF/DNG writer; pinned upstream native dcraw_emu linear RGB16','numpy':np.__version__,'libraw':'0.22.2','cases':cases,'unsupported':['no-calibration.dng','extra-samples.dng']},indent=2)+'\n')
print('Generated',len(cases),'RAW sensor cases and missing-calibration input')
