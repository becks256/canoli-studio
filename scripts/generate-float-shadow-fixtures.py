"""Reproducible independent alpha convolution and complete shadow scenes."""
from pathlib import Path
import copy,gzip,hashlib,json
import numpy as np
from float_shadow_reference import convolve,render
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-shadow';out.mkdir(exist_ok=True)
sha=lambda v:hashlib.sha256(v).hexdigest();files={}
def write(name,array):
    raw=np.ascontiguousarray(array,dtype='<f4').tobytes();packed=gzip.compress(raw,mtime=0);(out/name).write_bytes(packed)
    files[name]=dict(bytes=len(packed),sha256=sha(packed),rawSha256=sha(raw))
rng=np.random.default_rng(2026102901);cases=[]
for index,(sigma,axis)in enumerate([(0,0),(.125,1),(1.25,0),(3.5,1),(12,0),(128,1),(128,0)]):
    radius=int(np.ceil(3*sigma));width,height=(19,17+radius*2)if axis==0 else(19+radius*2,17)
    source=rng.random((height,width),dtype=np.float32)
    source[0,:]=.375;source[-1,:]=0;source[:,0]=1;source[:,-1]=np.nextafter(np.float32(0),np.float32(1))
    write(f'alpha-{index}.gz',source);write(f'filtered-{index}.gz',convolve(source,sigma,axis))
    cases.append(dict(width=width,height=height,sigma=sigma,axis='vertical'if axis==0 else'horizontal',source=f'alpha-{index}.gz',reference=f'filtered-{index}.gz'))
base=json.loads((root/'tests/fixtures/float-style/manifest.json').read_text())['cases'][0]['style']
def style(**kw):
    value=copy.deepcopy(base);value['dropShadow'].update(enabled=True,color='#ad3f79',opacity=.625,x=9.25,y=-4.75,blur=2.5);value['dropShadow'].update(**kw);return value
def raster(**kw):return dict(kind='raster',**kw)
scenes=[dict(name='fractional',layers=[raster(styles=style())]),
 dict(name='fill-zero-masked',layers=[raster(fillOpacity=0,mask=dict(rect=[18,13,67,37]),styles=style())]),
 dict(name='density-inverted',layers=[raster(fillOpacity=.375,opacity=.625,mask=dict(rect=[24,19,43,29],density=.625,inverted=True),styles=style(blur=0,x=-7.5,y=12.25))]),
 dict(name='max-halo',layers=[raster(fillOpacity=0,styles=style(blur=128,x=-256,y=256))]),
 dict(name='affine-quarter-turn',layers=[raster(x=90,y=3,transform=dict(a=0,b=1,c=-1,d=0,e=0,f=0),styles=style(x=7,y=3,blur=1.25))]),
 dict(name='clipping-base-shape',layers=[raster(fillOpacity=0,mask=dict(rect=[12,9,89,51]),styles=style()),raster(clipped=True,x=19,y=9,opacity=.625)]),
 dict(name='isolated-group',layers=[dict(kind='group',fillOpacity=0,styles=style(),mask=dict(rect=[5,7,103,61]),children=[raster(x=9,y=3,opacity=.5)])]),
 dict(name='nested',layers=[dict(kind='group',styles=style(blur=1.25),children=[raster(x=5,y=4,fillOpacity=.25,styles=style(blur=0,x=-3.25,y=7.5)),dict(kind='adjustment',tone=dict(exposure=-1))])]),
 dict(name='disabled-exact',layers=[raster(styles=style(enabled=False))]),
 dict(name='zero-exact',layers=[raster(styles=style(opacity=0))])]
mixed=style();mixed['colorOverlay'].update(enabled=True,color='#e35f27',opacity=.375);mixed['blendIf'].update(enabled=True,channel='red',source=[12.25,67.5,193.75,246.5])
scenes.append(dict(name='completed-appearance-gate',layers=[raster(opacity=.375),raster(fillOpacity=.625,styles=mixed)]))
source=np.frombuffer(gzip.decompress((root/'tests/fixtures/uint16-float/u16-raw-linear.f32le.gz').read_bytes()),dtype='<f4').reshape(79,131,4)
for row in scenes:
    row['reference']=row['name']+'.gz';write(row['reference'],render(source,row['layers']))
inputs={name:sha((root/name).read_bytes())for name in ['scripts/generate-float-shadow-fixtures.py','scripts/float_shadow_reference.py','scripts/float_style_reference.py','scripts/float_clipping_reference.py','scripts/float_blend_reference.py','tests/fixtures/uint16-float/u16-raw.tif','tests/fixtures/uint16-float/u16-raw-linear.f32le.gz']}
(out/'manifest.json').write_text(json.dumps(dict(version=1,numpy=np.__version__,inputs=inputs,files=files,cases=cases,scenes=scenes,colorTolerance=2**-22,alphaTolerance=0),indent=2)+'\n')
print(json.dumps(dict(cases=len(cases),scenes=len(scenes),bytes=sum(v['bytes']for v in files.values()))))
