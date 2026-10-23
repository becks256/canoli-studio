#!/usr/bin/env python3
"""Independent full Lensfun/GLib geometry plus NumPy RGB16 resampling.
No application WASM, parser, sampler or encoder is imported. The sensor planes
were produced independently by full upstream LibRaw's dcraw_emu.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, subprocess, tempfile
import numpy as np
from PIL import Image

parser=argparse.ArgumentParser();parser.add_argument('--oracle',type=Path,required=True);parser.add_argument('--large',action='store_true');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/raw-profile';out.mkdir(exist_ok=True)
core=json.loads((root/'tests/fixtures/lens-core/manifest.json').read_text())
core['profiles']['guide']={'model':'Calibration example 35 mm','calibrations':[{'cropFactor':1.5,'aspectRatio':1.5,'distortion':[{'model':'poly3','focalLength':35,'terms':[-.02]}]}]}
guide_xml=out/'guide.xml'
guide_xml.write_text('<lensdatabase version="2"><lens><model>Calibration example 35 mm</model><mount>Example</mount><cropfactor>1.5</cropfactor><aspect-ratio>1.5</aspect-ratio><calibration cropfactor="1.5" aspect-ratio="1.5"><distortion model="poly3" focal="35" k1="-0.02"/></calibration></lens></lensdatabase>\n')
raw=json.loads((root/'tests/fixtures/raw/manifest.json').read_text())
table=np.arange(65536,dtype=np.float64)/65535
table=np.floor(np.clip(np.where(table<=.0031308,12.92*table,1.055*table**(1/2.4)-.055),0,1)*255+.5).astype(np.uint8)

def reference(source,coordinates,gains):
    height,width,channels=source.shape
    # Match the documented upstream LF_PF_F32 color stage, then use independent
    # float64 bilinear interpolation and a single RGB16 quantization/transfer.
    rows=coordinates.shape[0]
    output=np.empty((rows,width,4),dtype=np.uint8);coverage=np.ones((rows,width))
    for c in range(3):
        xx=coordinates[:,:,c*2].astype(np.float64);yy=coordinates[:,:,c*2+1].astype(np.float64)
        left=np.floor(xx).astype(np.int64);top=np.floor(yy).astype(np.int64);fx=xx-left;fy=yy-top
        total=np.zeros((rows,width));valid_weight=np.zeros_like(total)
        for j in range(2):
            for i in range(2):
                x=left+i;y=top+j;weight=(fx if i else 1-fx)*(fy if j else 1-fy)
                valid=(x>=0)&(x<width)&(y>=0)&(y<height)&(weight!=0)
                sx=np.clip(x,0,width-1);sy=np.clip(y,0,height-1)
                sample=(source[sy,sx,0 if channels==1 else c].astype(np.float32)*gains[sy,sx]).astype(np.float32).astype(np.float64)
                total+=np.where(valid,weight*sample,0);valid_weight+=np.where(valid,weight,0)
        values=np.divide(total,valid_weight,out=np.zeros_like(total),where=valid_weight!=0)
        output[:,:,c]=table[np.floor(np.clip(values,0,65535)+.5).astype(np.uint16)]
        coverage=np.minimum(coverage,valid_weight)
    output[:,:,3]=np.floor(np.clip(coverage,0,1)*255+.5).astype(np.uint8);output[:,:,:3][output[:,:,3]==0]=0
    return output

records=[]
# Native report flips are dcraw bits, not EXIF enumeration values.
flips={2:1,3:3,4:2,5:4,6:6,7:7,8:5}
cases=[(model, 'bayer-rggb',0,True,True,True)for model in core['profiles']if model!='guide']
cases += [('guide','bayer-rggb',0,True,False,False)]
cases += [('poly3',f'orientation-{orientation}',flip,True,True,True)for orientation,flip in flips.items()]
cases += [('ptlens','monochrome16',0,True,False,True),('poly3','bayer-rggb',0,False,True,False),('poly5','bayer-rggb',0,False,False,True)]
with tempfile.TemporaryDirectory()as temp:
    for index,(model,name,flip,dist,tca,vig)in enumerate(cases):
        info=next(item for item in raw['cases']if item['file']==name+'.dng')
        width=info['width'];height=info['height'];channels=info['channels']
        source_path=root/f'tests/fixtures/raw/{name}.rgb16le';source=np.frombuffer(source_path.read_bytes(),dtype='<u2').reshape(height,width,channels)
        mapping=Path(temp)/'mapping.bin';flags=(8 if dist else 0)|(1 if tca else 0)|(2 if vig else 0)
        xml=guide_xml if model=='guide'else root/f'tests/fixtures/lens-core/{model}.xml'
        subprocess.run([str(args.oracle.resolve()),str(xml),str(mapping),str(width),str(height),'43','1.5','5.6','10','1.05',str(flags),str(flip),'0','0',str(width),str(height)],check=True)
        plane=np.frombuffer(mapping.read_bytes(),dtype='<f4');points=plane[:width*height*6].reshape(height,width,6);gains=plane[width*height*6:].reshape(height,width)
        pixels=reference(source,points,gains);file=f'{index:02d}-{model}-{name}.png';Image.fromarray(pixels,'RGBA').save(out/file)
        records.append({'file':file,'source':name+'.dng','width':width,'height':height,'flip':flip,'options':{'scale':1.05,'profile':{'definition':core['profiles'][model],'focalLength':43,'cropFactor':1.5,'aperture':5.6,'focusDistance':10,'distortion':dist,'chromatic':tca,'vignette':vig}},'rgbaSha256':hashlib.sha256(pixels.tobytes()).hexdigest(),'sensorPlaneSha256':hashlib.sha256(source_path.read_bytes()).hexdigest()})
    if args.large:
        width,height=10000,5000
        source_path=Path(temp)/'sensor.rgb16le'
        with gzip.open(root/'tests/fixtures/raw/native-50mp.rgb16le.gz','rb')as source_file,source_path.open('wb')as target:
            while block:=source_file.read(4_000_000):target.write(block)
        source=np.memmap(source_path,dtype='<u2',mode='r',shape=(height,width,3))
        coordinates=np.memmap(Path(temp)/'coordinates.f32le',dtype='<f4',mode='w+',shape=(height,width,6))
        gains=np.memmap(Path(temp)/'gains.f32le',dtype='<f4',mode='w+',shape=(height,width))
        pixels=np.memmap(Path(temp)/'output.rgba8',dtype='u1',mode='w+',shape=(height,width,4))
        mapping=Path(temp)/'mapping.bin'
        for top in range(0,height,8):
            rows=min(8,height-top)
            subprocess.run([str(args.oracle.resolve()),str(root/'tests/fixtures/lens-core/ptlens.xml'),str(mapping),str(width),str(height),'43','1.5','5.6','10','1.15','11','0','0',str(top),str(width),str(rows)],check=True)
            plane=np.frombuffer(mapping.read_bytes(),dtype='<f4');coordinates[top:top+rows]=plane[:width*rows*6].reshape(rows,width,6);gains[top:top+rows]=plane[width*rows*6:].reshape(rows,width)
        for top in range(0,height,8):pixels[top:top+8]=reference(source,coordinates[top:top+8],gains)
        file='native-50mp.png';Image.fromarray(np.asarray(pixels),'RGBA').save(out/file)
        sensor_hash=hashlib.sha256()
        with source_path.open('rb')as input_file:
            while block:=input_file.read(4_000_000):sensor_hash.update(block)
        record={'file':file,'source':'native-50mp.dng.gz','width':width,'height':height,'flip':0,'options':{'scale':1.15,'profile':{'definition':core['profiles']['ptlens'],'focalLength':43,'cropFactor':1.5,'aperture':5.6,'focusDistance':10,'distortion':True,'chromatic':True,'vignette':True}},'rgbaSha256':hashlib.sha256(pixels).hexdigest(),'sensorPlaneSha256':sensor_hash.hexdigest()}
        assert pixels[:,:,3].min()==255, 'Large application export fixture must have full source coverage.'
        records.append(record)
(out/'manifest.json').write_text(json.dumps({'generator':'Complete pinned native Lensfun and real GLib, independent LibRaw RGB16 and NumPy/Pillow resampling','lensfunRevision':'b98997f7f1c020d0fac3136c2abbf06126385971','numpy':np.__version__,'cases':records},indent=2)+'\n')
print(json.dumps({'cases':len(records),'directory':str(out)}))
