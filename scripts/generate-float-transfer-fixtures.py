"""Generate independent full-precision transfer fixtures; never imports app code."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
import numpy as np
import gzip,json,hashlib
from float_transfer_reference import adjust
from float_clipping_reference import render
root=Path(__file__).resolve().parents[1];folder=root/'tests/fixtures/float-transfer';folder.mkdir(exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
points=lambda rows:[dict(x=x,y=y)for x,y in rows]
identity=dict(inputBlack=0,inputWhite=255,gamma=1,outputBlack=0,outputWhite=255)
cases=[
 ('identity-curves',dict(kind='curves',rgb=points([(0,0),(255,255)]))),
 ('curves-rgb',dict(kind='curves',rgb=points([(0,0),(64,48),(128,168),(255,255)]),red=points([(0,0),(120,160),(255,255)]))),
 ('curves-turns',dict(kind='curves',rgb=points([(0,16),(40,210),(90,30),(130,200),(180,200),(255,224)]),blue=points([(10,30),(240,215)]))),
 ('curves-short',dict(kind='curves',rgb=points([(16,40),(240,220)]),green=points([(0,255),(255,0)]))),
 ('identity-levels',dict(kind='levels',rgb=identity)),
 ('levels-rgb',dict(kind='levels',rgb=dict(inputBlack=12,inputWhite=244,gamma=.85,outputBlack=4,outputWhite=251),red=dict(inputBlack=5,inputWhite=250,gamma=1.75,outputBlack=240,outputWhite=8))),
 ('levels-channel',dict(kind='levels',rgb=identity,blue=dict(inputBlack=0,inputWhite=255,gamma=2.2,outputBlack=0,outputWhite=255))),
]
n=70001;i=np.arange(n,dtype=np.float64);pixels=np.empty((n,4),dtype=np.float32);pixels[:,0]=(i%65536)/65535;pixels[:,1]=((i*37)%65536)/65535;pixels[:,2]=np.sin(i*.013)*.5+.5;pixels[:,3]=np.array([0,.125,.501,.999,1],dtype=np.float32)[np.arange(n)%5]
pixels[-2048:,:3]=np.linspace(-3.125,16.75,2048*3).reshape(2048,3).astype(np.float32);pixels[1,:3]=[1e-35,-1e-35,1e-40]
files={}
def save(name,values):
 raw=values.astype('<f4').tobytes();data=gzip.compress(raw,mtime=0);(folder/name).write_bytes(data);files[name]=dict(bytes=len(data),sha256=sha(data),rawSha256=sha(raw));return sha(raw)
save('source.f32le.gz',pixels)
rows=[]
for name,settings in cases:rows.append(dict(name=name,adjustment=settings,reference=name+'.f32le.gz',rawSha256=save(name+'.f32le.gz',adjust(pixels,settings))))
scene_path=root/'tests/fixtures/float-source/rgba-raw-le-linear.f32le.gz';native=np.frombuffer(gzip.decompress(scene_path.read_bytes()),dtype='<f4').copy().reshape(79,131,4)
curve_settings=cases[1][1];level_settings=cases[5][1]
scenes=[
 ('ordinary',[dict(kind='raster'),dict(kind='adjustment',adjustment=curve_settings),dict(kind='adjustment',opacity=.625,mask=dict(rect=[15,10,90,55]),adjustment=level_settings)]),
 ('clipped',[dict(kind='raster',fillOpacity=.375,opacity=.75,mask=dict(rect=[5,3,115,65])),dict(kind='adjustment',clipped=True,fillOpacity=.7,opacity=.625,adjustment=cases[2][1]),dict(kind='raster',clipped=True,opacity=.5,tones=[dict(exposure=-1)]),dict(kind='adjustment',opacity=.4,adjustment=cases[6][1])]),
 ('groups',[dict(kind='raster'),dict(kind='group',opacity=.75,mask=dict(rect=[8,5,110,65],density=.7),children=[dict(kind='raster',opacity=.625),dict(kind='adjustment',adjustment=cases[3][1]),dict(kind='group',blendMode='pass-through',opacity=.5,children=[dict(kind='adjustment',opacity=.75,adjustment=level_settings)])])]),
]
scene_rows=[]
for name,layers in scenes:scene_rows.append(dict(name=name,layers=layers,reference='scene-'+name+'.f32le.gz',rawSha256=save('scene-'+name+'.f32le.gz',render(native,layers,transfer=adjust))))
visible=native[native[:,:,3]>0,:3].astype(np.float64);bins=lambda a:np.floor(np.clip(a,0,1)*255+.5).astype(int)
histogram=dict(encoding='linear-srgb',belowRange=int(np.sum(visible<0)),aboveRange=int(np.sum(visible>1)),totalPixels=int(visible.shape[0]),red=np.bincount(bins(visible[:,0]),minlength=256).tolist(),green=np.bincount(bins(visible[:,1]),minlength=256).tolist(),blue=np.bincount(bins(visible[:,2]),minlength=256).tolist(),luminance=np.bincount(bins(visible[:,0]*.2126+visible[:,1]*.7152+visible[:,2]*.0722),minlength=256).tolist())
(folder/'histogram.json').write_text(json.dumps(histogram,indent=2)+'\n')
manifest=dict(samples=int(pixels.size),generatorSha256=sha(Path(__file__).read_bytes()),oracleSha256=sha((root/'scripts/float_transfer_reference.py').read_bytes()),files=files,cases=rows,scenes=scene_rows,sceneSource=dict(path=str(scene_path.relative_to(root)),sha256=sha(scene_path.read_bytes())),sceneOracleSha256=sha((root/'scripts/float_clipping_reference.py').read_bytes()),histogramSha256=sha((folder/'histogram.json').read_bytes()))
(folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(len(rows),'independent transfer cases;',pixels.size,'channels per case')
