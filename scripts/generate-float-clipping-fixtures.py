"""Original native-CMM source + independent NumPy clipping/group fixtures."""
from pathlib import Path
import sys
sys.dont_write_bytecode=True
import gzip,hashlib,json
import numpy as np
from float_clipping_reference import render
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-clipping';out.mkdir(exist_ok=True)
source_path=root/'tests/fixtures/float-source/rgba-raw-le-linear.f32le.gz';source=np.frombuffer(gzip.decompress(source_path.read_bytes()),dtype='<f4').reshape(79,131,4)
def raster(**kw):return dict(kind='raster',**kw)
def group(children,**kw):return dict(kind='group',children=children,**kw)
def adjustment(**kw):return dict(kind='adjustment',tone=dict(exposure=-1,contrast=-20,saturation=35),**kw)
scenes=[
 ('soft-boundary', [raster(opacity=.75,mask=dict(rect=[10,5,100,60],density=.5)),raster(clipped=True,x=3,y=2,opacity=.5,tones=[dict(exposure=1)]),raster(clipped=True,x=-4,y=-3,opacity=.625,tones=[dict(exposure=-1)],mask=dict(rect=[20,10,70,50]))]),
 ('fill-and-adjustments',[raster(fillOpacity=.375,opacity=.75),adjustment(clipped=True,opacity=.5,mask=dict(rect=[12,7,93,55])),group([raster(x=6,y=3,tones=[dict(saturation=-100)]),raster(clipped=True,x=-3,y=-2,opacity=.5)],clipped=True,opacity=.5,fillOpacity=.5,mask=dict(rect=[17,9,95,60]))]),
 ('pass-through-coverage',[raster(tones=[dict(exposure=-1)]),group([raster(x=2,y=1,opacity=.5),raster(x=-3,y=-1,opacity=.25)],blendMode='pass-through',opacity=.625,mask=dict(rect=[10,10,95,55])),raster(clipped=True,visible=False),group([adjustment(opacity=.5),raster(x=4,y=3,opacity=.25)],blendMode='pass-through',clipped=True,opacity=.5,mask=dict(rect=[25,5,90,60]))]),
 ('scope-and-orphans',[raster(clipped=True,tones=[dict(exposure=2)]),raster(opacity=.5),group([raster(clipped=True),raster(x=5,y=4,opacity=.5),raster(clipped=True,x=-4,y=-1,tones=[dict(exposure=1)])],x=3,y=2,opacity=.75),adjustment(opacity=.25),raster(clipped=True,tones=[dict(exposure=3)])]),
 ('hidden-base',[raster(opacity=.5),raster(visible=False),raster(clipped=True,tones=[dict(exposure=3)]),group([raster()],opacity=0),raster(clipped=True),raster(opacity=.25),raster(clipped=True,visible=False)]),
 ('zero-fill',[raster(fillOpacity=0,opacity=.75,mask=dict(rect=[5,3,110,69])),raster(clipped=True,x=7,y=4,opacity=.5,tones=[dict(exposure=1)]),adjustment(clipped=True,opacity=.5)]),
]
rows=[];files={}
for name,layers in scenes:
 result=render(source,layers);data=np.ascontiguousarray(result,dtype='<f4').tobytes();packed=gzip.compress(data,mtime=0);file=name+'.f32le.gz';(out/file).write_bytes(packed);files[file]=dict(bytes=len(packed),sha256=hashlib.sha256(packed).hexdigest(),rawSha256=hashlib.sha256(data).hexdigest());rows.append(dict(name=name,width=131,height=79,layers=layers,reference=file,rawSha256=hashlib.sha256(data).hexdigest()))
# Native placement permits a streamed every-sample 50 MP oracle with no full
# decoded image allocation or arbitrary input-resolution limit.
large=[raster(fillOpacity=.375,opacity=.75,mask=dict(rect=[1000,500,8000,4000])),raster(clipped=True,opacity=.5,tones=[dict(exposure=1)],mask=dict(rect=[0,0,6500,5000])),raster(clipped=True,opacity=.625,tones=[dict(exposure=-1,contrast=25,saturation=-40)],mask=dict(rect=[3500,0,6500,5000]))]
manifest=dict(version=1,source='rgba-raw-le.tif',sourceReference='tests/fixtures/float-source/rgba-raw-le-linear.f32le.gz',sourceReferenceSha256=hashlib.sha256(source_path.read_bytes()).hexdigest(),generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),oracleSha256=hashlib.sha256((root/'scripts/float_clipping_reference.py').read_bytes()).hexdigest(),scenes=rows,large=dict(width=10000,height=5000,layers=large),files=files,reference='Independent NumPy float64 native source-over, once-only float32 clipping shape, scoped groups and premultiplied adjustment interpolation over separately generated native CMM original references.')
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(dict(scenes=len(rows),samples=sum(r['width']*r['height']*4 for r in rows))))
