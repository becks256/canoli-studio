"""Independent original-precision palette/lookup fixtures; no application pixels."""
from pathlib import Path
import base64, gzip, hashlib, itertools, json
import colour
import numpy as np
from float_palette_reference import adjust, render
root = Path(__file__).resolve().parents[1]
out = root / 'tests/fixtures/float-palette'
out.mkdir(exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
files = {}
def write(name, values):
    raw = np.ascontiguousarray(values, dtype='<f4').tobytes()
    packed = gzip.compress(raw, mtime=0)
    (out/name).write_bytes(packed)
    files[name] = dict(bytes=len(packed), sha256=sha(packed), rawSha256=sha(raw))
rng = np.random.default_rng(20261029)
source = rng.uniform(-.5, 3, (4099, 4)).astype(np.float32)
source[:, 3] = rng.random(len(source), dtype=np.float32)
source[::17, 3] = 0
source[::19, 3] = 1
coords = [-1., -2**-149, -0., 2**-149, .0031308, .21404114, 1., 2.]
source = np.concatenate([source, np.array([[*rgb, [0., .375, 1.][i%3]] for i, rgb in enumerate(itertools.product(coords, repeat=3))], dtype=np.float32), np.array([[-0., 3e38, -(2**-149), -0.], [-3e38, 3e38, 1e-40, .375]], dtype=np.float32)])
write('source.f32le.gz', source)
settings = []
palettes = [
    [dict(position=0,color='#000000'),dict(position=1,color='#ffffff')],
    [dict(position=0,color='#171b46'),dict(position=.45,color='#b65a74'),dict(position=1,color='#ffe4a0')],
    [dict(position=.2,color='#0000ff'),dict(position=.8,color='#ff8800')],
    [dict(position=i/31,color='#'+''.join(f'{(i*factor)%256:02x}' for factor in [17,31,47])) for i in range(32)],
    [dict(position=0,color='#172849'),dict(position=.5,color='#8899aa'),dict(position=.500000001,color='#ffe4a0'),dict(position=1,color='#ffffff')],
]
for stops in palettes:
    for reverse in [False,True]:settings.append(dict(kind='gradient-map',stops=stops,reverse=reverse))
paths = []
def packed(lut):
    samples = lut.table.astype('<f4')
    values = samples if samples.ndim == 2 else samples.transpose(2,1,0,3)
    return dict(title=lut.name,dimension=1 if samples.ndim==2 else 3,size=samples.shape[0],domainMin=lut.domain[0].tolist(),domainMax=lut.domain[1].tolist(),data=base64.b64encode(np.ascontiguousarray(values).tobytes()).decode())
luts = []
for name in ['independent-1d','independent-3d']:
    path=root/'tests/fixtures/lut'/(name+'.cube');paths.append(path);luts.append((name,packed(colour.io.read_LUT_IridasCube(path))))
for name,lut in [
    ('identity-1d',colour.LUT3x1D.linear_table(size=2)),
    ('identity-domain-3d',colour.LUT3D.linear_table(size=3)),
    ('hdr-3d',colour.LUT3D.linear_table(size=3)),
]:
    domain=np.array([[-1,-.5,0],[2,1.5,3]],dtype=np.float64) if name!='identity-1d'else np.array([[0,0,0],[1,1,1]],dtype=np.float64)
    if name=='identity-domain-3d':lut=lut*(domain[1]-domain[0])+domain[0]
    if name=='hdr-3d':
        r,g,b=np.moveaxis(lut,-1,0);lut=np.stack([-.5+1.4*r*g+.15*b,.8*g-.25*b,b*r+.2],axis=-1)
    obj=colour.LUT3x1D(lut,name=name,domain=domain)if lut.ndim==2 else colour.LUT3D(lut,name=name,domain=domain)
    path=out/(name+'.cube');colour.io.write_LUT_IridasCube(obj,path,decimals=12);paths.append(path);luts.append((name,packed(colour.io.read_LUT_IridasCube(path))))
for name,lut in luts:
    for interpolation in ['tetrahedral','trilinear']:
        for amount in [0,37.25,100]:settings.append(dict(kind='lut',lut=lut,amount=amount,interpolation=interpolation))
cases=[]
for i,row in enumerate(settings):
    file=f'palette-{i}.f32le.gz';write(file,adjust(source,row));cases.append(dict(adjustment=row,reference=file,rawSha256=files[file]['rawSha256']))
manifest=dict(version=1,pixels=len(source),colorTolerance=2**-22,alphaTolerance=0,integerColorTolerance=1,toleranceScale='max(1, abs(reference RGB)) per pixel',cases=cases,files=files,reference='Independent Colour Science 0.4.6 Cube reader and 1D/3D tetrahedral/trilinear interpolators; NumPy reflected extended sRGB transfer and gradient interpolation. One f32 output store; alpha/neutral exact.',sourceUrls=['https://www.w3.org/TR/2026/CRD-css-color-4-20261027/#color-conversion-code','https://github.com/colour-science/colour/blob/v0.4.6/colour/algebra/interpolation.py'],sources=[],scenes=[],width=131,height=79)
inputs=[Path(__file__),root/'scripts/float_palette_reference.py',*paths]
normalize=dict(kind='adjustment',adjustment=dict(kind='levels',rgb=dict(inputBlack=1,inputWhite=254,gamma=1,outputBlack=0,outputWhite=255)))
representatives=[settings[2],settings[12],settings[18],settings[21]]
for folder_name,filename in [('float-source','rgba-raw-le.tif'),('float-document','hdr-high.tif'),('uint16-float','u16-all-levels.tif')]:
    folder=root/'tests/fixtures'/folder_name;original=root/'tests/fixtures'/('uint16-float'if folder_name=='uint16-float'else'tiff-float')/filename;source_manifest=folder/'manifest.json';table=json.loads(source_manifest.read_text());row=next(r for r in table['cases']if r['file']==filename);reference=folder/row['reference'];assert sha(reference.read_bytes())==table['files'][reference.name]['sha256'];pixels=np.frombuffer(gzip.decompress(reference.read_bytes()),dtype='<f4').reshape(row['height'],row['width'],4)[:79,:131].copy();inputs += [source_manifest,original,reference];manifest['sources'].append(dict(name=filename,original=str(original.relative_to(root)),reference=str(reference.relative_to(root)),width=row['width'],height=row['height']))
    scenes={f'palette-{i}':[dict(kind='raster'),dict(kind='adjustment',adjustment=setting)]for i,setting in enumerate(settings)}
    for index,setting in enumerate(representatives):
        label=['gradient','lookup-1d','lookup-tetrahedral','lookup-trilinear'][index];layer=dict(kind='adjustment',adjustment=setting,opacity=.75,fillOpacity=.625,mask=dict(rect=[15,10,90,55],density=.5))
        artistic_setting=setting
        if setting['kind']=='lut':
            bounded=dict(setting['lut']);bounded['title']='Bounded '+bounded['title'];values=np.frombuffer(base64.b64decode(bounded['data']),dtype='<f4');bounded['data']=base64.b64encode(np.clip(values,0,1).astype('<f4').tobytes()).decode();artistic_setting=dict(setting,lut=bounded)
        scenes.update({
            label+'-isolated':[dict(kind='group',opacity=.75,fillOpacity=.625,mask=dict(rect=[5,10,110,55],density=.5),children=[dict(kind='raster'),layer])],
            label+'-pass-through':[dict(kind='raster'),dict(kind='group',blendMode='pass-through',opacity=.625,mask=dict(rect=[5,5,115,65],density=.5),children=[layer])],
            label+'-clipping':[dict(kind='raster',opacity=.375),dict(kind='raster',opacity=.75,fillOpacity=.625,mask=dict(rect=[5,5,115,65],density=.5)),dict(layer,clipped=True)],
            label+'-group-base':[dict(kind='group',opacity=.75,fillOpacity=.625,mask=dict(rect=[5,5,115,65],density=.5),children=[dict(kind='raster'),layer]),dict(layer,clipped=True)],
            label+'-ordered':[dict(kind='raster'),dict(kind='adjustment',adjustment=dict(kind='curves',rgb=[dict(x=0,y=0),dict(x=128,y=152),dict(x=255,y=255)])),*[dict(kind='adjustment',adjustment=representatives[(index+offset)%4])for offset in range(4)]],
            label+'-artistic':[dict(kind='raster'),normalize,dict(layer,adjustment=artistic_setting,blendMode=['screen','color','luminosity','multiply'][index])],
        })
    for name,layers in scenes.items():
        file=filename+'-'+name+'.f32le.gz';write(file,render(pixels,layers));manifest['scenes'].append(dict(source=filename,name=name,layers=layers,reference=file,rawSha256=files[file]['rawSha256']))
manifest['largeLayers']=[dict(kind='raster'),dict(kind='adjustment',adjustment=representatives[1]),dict(kind='adjustment',adjustment=representatives[2]),dict(kind='adjustment',adjustment=representatives[0],opacity=.625,mask=dict(rect=[2000,0,7000,5000],density=.5))]
inputs += [root/'scripts'/name for name in ['float_clipping_reference.py','float_transfer_reference.py','float_white_balance_reference.py','float_color_reference.py','float_blend_reference.py']]
inputs += [root/'tests/fixtures/white-balance-reference.json']
manifest['inputs']={str(p.relative_to(root)):sha(p.read_bytes())for p in inputs}
manifest['independentEnvironment']=dict(colour=colour.__version__,numpy=np.__version__,files={name:sha((Path(colour.__file__).parent/name).read_bytes())for name in ['algebra/interpolation.py','io/luts/lut.py','io/luts/iridas_cube.py']})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(dict(pixels=len(source),cases=len(cases),scenes=len(manifest['scenes']))))
