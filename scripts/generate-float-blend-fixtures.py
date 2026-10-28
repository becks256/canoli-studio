"""Independent completed native float scene references for all blend placements."""
from pathlib import Path
import gzip,hashlib,json
import numpy as np
from float_blend_reference import MODES,render
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-blend';out.mkdir(exist_ok=True);sha=lambda b:hashlib.sha256(b).hexdigest()
original=root/'tests/fixtures/uint16-float/u16-all-levels.tif';reference=root/'tests/fixtures/uint16-float/u16-all-levels-linear.f32le.gz';manifest=json.loads((reference.parent/'manifest.json').read_text());packed=reference.read_bytes();assert sha(packed)==manifest['files'][reference.name]['sha256'];native=gzip.decompress(packed);source=np.frombuffer(native,dtype='<f4').reshape(256,256,4)[:79,:131].copy()
assert source[...,:3].min()>=0 and source[...,:3].max()<=1
base=dict(kind='raster',opacity=.625,mask=dict(rect=[15,10,90,55],density=.5));top=dict(kind='raster',opacity=.75,fillOpacity=.625,tones=[dict(contrast=-40,saturation=-25)],mask=dict(rect=[30,5,80,60],density=.625));adj=dict(kind='adjustment',tone=dict(exposure=-.5,contrast=-20,saturation=-25),opacity=.75,fillOpacity=.625,mask=dict(rect=[5,15,100,50],density=.5))
files={};cases=[]
for mode in MODES:
 scenes={
  'raster':[base,dict(top,blendMode=mode)],
  'adjustment':[base,dict(adj,blendMode=mode)],
  'isolated':[base,dict(kind='group',blendMode=mode,opacity=.75,fillOpacity=.625,mask=dict(rect=[15,5,105,65],density=.5),children=[top,dict(adj,blendMode='screen')])],
  'pass-through':[base,dict(kind='group',blendMode='pass-through',opacity=.625,mask=dict(rect=[15,5,105,65],density=.5),children=[dict(top,blendMode=mode),adj])],
  'clipping':[dict(kind='raster',opacity=.375),dict(base,blendMode=mode,fillOpacity=.625),dict(top,clipped=True,blendMode='multiply'),dict(adj,clipped=True,blendMode=mode)],
  'group-base':[dict(kind='raster',opacity=.375),dict(kind='group',blendMode=mode,opacity=.75,fillOpacity=.625,mask=dict(rect=[15,5,105,65],density=.5),children=[base,adj]),dict(top,clipped=True,blendMode=mode)],
 }
 for name,layers in scenes.items():
  raw=render(source,layers).astype('<f4').tobytes();data=gzip.compress(raw,mtime=0);file=name+'-'+mode+'.f32le.gz';(out/file).write_bytes(data);files[file]=dict(bytes=len(data),sha256=sha(data),rawSha256=sha(raw));cases.append(dict(context=name,mode=mode,layers=layers,reference=file,rawSha256=sha(raw)))
inputs=[original,reference,reference.parent/'manifest.json',root/'scripts/float_clipping_reference.py',root/'scripts/float_blend_reference.py',Path(__file__)]
large_layers=[
 dict(kind='raster',opacity=.625,mask=dict(rect=[2000,0,7000,5000],density=.5)),
 dict(kind='group',blendMode='screen',opacity=.75,fillOpacity=.625,mask=dict(rect=[1500,0,8000,5000],density=.5),children=[dict(kind='raster',blendMode='multiply',opacity=.75,fillOpacity=.625,tones=[dict(contrast=-40,saturation=-25)],mask=dict(rect=[3500,0,6500,5000],density=.625)),dict(kind='adjustment',blendMode='hue',opacity=.5,tone=dict(exposure=-.5,contrast=-20,saturation=-25))]),
 dict(kind='adjustment',blendMode='luminosity',clipped=True,opacity=.375,fillOpacity=.625,mask=dict(rect=[1000,0,8000,5000],density=.5),tone=dict(contrast=-30,saturation=-25)),
]
(out/'manifest.json').write_text(json.dumps(dict(version=1,width=131,height=79,originalWidth=256,originalHeight=256,crop=dict(x=0,y=0,width=131,height=79),original=str(original.relative_to(root)),largeLayers=large_layers,largeColorTolerance={'float32':2**-20,'uint16':1},largeAlphaTolerance=0,inputs={str(p.relative_to(root)):sha(p.read_bytes())for p in inputs},modes=MODES,cases=cases,files=files,colorTolerance=2**-20,alphaTolerance=0,reference='Independent NumPy float64 W3C blending and source-over; alpha-preserving adjustment interpolation. No editor/canvas/WASM expected samples.',referenceUrl='https://www.w3.org/TR/2024/CRD-compositing-1-20240321/'),indent=2)+'\n');print(len(cases),'independent complete scene references')
