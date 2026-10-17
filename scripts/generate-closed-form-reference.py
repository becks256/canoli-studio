"""Independent NumPy/SciPy implementation of Levin et al. CVPR06 Eq.12/13.

No application code is imported. Windows are clipped at image edges and omit
zero-alpha RGB, matching the editor's explicit transparent-source contract.
Reference matrices use COO assembly and SciPy's direct sparse solver, rather
than the production chunked stencil and preconditioned conjugate gradients.
"""
from pathlib import Path
import hashlib, json, struct, zlib
import numpy as np
import scipy
from scipy.sparse import coo_matrix
from scipy.sparse.linalg import spsolve

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'tests/fixtures/matting'

def solve(rgba, labels):
    h,w=labels.shape; rows=[]; cols=[]; data=[]
    colors=rgba[:,:,:3].astype(np.float64)/255
    for y in range(h):
        for x in range(w):
            positions=[(yy,xx) for yy in range(max(0,y-1),min(h,y+2)) for xx in range(max(0,x-1),min(w,x+2)) if rgba[yy,xx,3]]
            if not positions: continue
            ids=np.array([yy*w+xx for yy,xx in positions]); count=len(ids)
            rgb=np.array([colors[yy,xx] for yy,xx in positions]); centered=rgb-rgb.mean(axis=0)
            covariance=centered.T@centered/count
            local=np.eye(count)-(np.ones((count,count))+centered@np.linalg.solve(covariance+np.eye(3)*1e-7/count,centered.T))/count
            rows.extend(np.repeat(ids,count)); cols.extend(np.tile(ids,count)); data.extend(local.ravel())
    laplacian=coo_matrix((data,(rows,cols)),shape=(h*w,h*w)).tocsr()
    unknown=np.flatnonzero((labels.ravel()==128)&(rgba[:,:,3].ravel()>0))
    known=np.flatnonzero(labels.ravel()!=128)
    alpha=labels.ravel().astype(float)/255;alpha[unknown]=0
    system=laplacian[unknown,:][:,unknown];rhs=-laplacian[unknown,:][:,known]@alpha[known]
    alpha[unknown]=spsolve(system,rhs)
    residual=np.linalg.norm(system@alpha[unknown]-rhs)/max(1,np.linalg.norm(rhs))
    assert residual<1e-10
    return np.clip(np.floor(alpha.reshape(h,w)*255+.5),0,255).astype(np.uint8),float(residual)

def case(name,rgba,labels,truth=None):
    alpha,residual=solve(rgba,labels)
    result={'name':name,'width':rgba.shape[1],'height':rgba.shape[0],'rgba':rgba.ravel().tolist(),'labels':labels.ravel().tolist(),'alpha':alpha.ravel().tolist(),'directRelativeResidual':residual}
    if truth is not None:
        unknown=labels==128;err=(alpha.astype(float)/255-truth)[unknown]
        result['syntheticQuality']={'unknownPixels':int(unknown.sum()),'meanAbsoluteError':float(np.abs(err).mean()),'meanSquaredError':float((err**2).mean()),'maximumAbsoluteError':float(np.abs(err).max())}
    return result

def mixtures(alpha,foreground=(200,20,10),background=(10,30,200)):
    fg=np.array(foreground);bg=np.array(background)
    rgb=np.floor(alpha[:,:,None]*fg+(1-alpha[:,:,None])*bg+.5).astype(np.uint8)
    return np.concatenate((rgb,np.full((*alpha.shape,1),255,dtype=np.uint8)),axis=2)

cases=[]
a=np.tile(np.array([1,1,.8,.65,.5,.35,.2,0,0]),(5,1));labels=np.full(a.shape,128,dtype=np.uint8);labels[:,:2]=255;labels[:,-2:]=0
cases.append(case('color-line',mixtures(a),labels,a))
h,w=9,65;alpha=np.tile(np.linspace(1,0,w),(h,1));labels=np.full((h,w),128,dtype=np.uint8);labels[:,:2]=255;labels[:,-2:]=0
cases.append(case('wide-unknown',mixtures(alpha),labels,alpha))
alpha=np.linspace(1,0,9).reshape(9,1);labels=np.full(alpha.shape,128,dtype=np.uint8);labels[0]=255;labels[-1]=0
cases.append(case('single-column',mixtures(alpha),labels,alpha))
rng=np.random.default_rng(1917);rgba=rng.integers(0,256,(11,13,4),dtype=np.uint8);rgba[:,:,3]=255;labels=np.full((11,13),128,dtype=np.uint8);labels[:,:2]=255;labels[:,-2:]=0
cases.append(case('full-rank-rgb',rgba,labels))
y,x=np.mgrid[:33,:49];alpha=np.zeros((33,49))
for offset,spread in [(4,.5),(10,.8),(17,1.1),(23,.6),(29,.9)]:
    curve=offset+2.2*np.sin(x/8+offset)
    alpha=np.maximum(alpha,.92*np.exp(-((y-curve)/spread)**2))
alpha[:,:3]=1;alpha[:,-3:]=0
labels=np.full(alpha.shape,128,dtype=np.uint8);labels[alpha<.01]=0;labels[:,:3]=255
cases.append(case('synthetic-fine-strands',mixtures(alpha),labels,alpha))
y,x=np.mgrid[:27,:39];alpha=np.zeros((27,39));inside=(x>=5)&(x<34)&(y>=4)&(y<23);alpha[inside]=(.4+.18*np.sin(x/8)+.1*np.cos(y/5))[inside];alpha[4:7,5:9]=1
labels=np.full(alpha.shape,128,dtype=np.uint8);labels[~inside]=0;labels[4:7,5:9]=255
cases.append(case('synthetic-translucent-sheet',mixtures(alpha),labels,alpha))
# Padded visible region reproduces native windows around the distant 50 MP patch.
h,w=11,603;alpha=np.zeros((h,w));alpha[1:-1,1:-1]=np.tile(np.linspace(1,0,w-2),(h-2,1));rgba=mixtures(alpha);rgba[0,:,3]=rgba[-1,:,3]=rgba[:,0,3]=rgba[:,-1,3]=0
labels=np.zeros((h,w),dtype=np.uint8);labels[1:-1,1:-1]=128;labels[1:-1,1:4]=255;labels[1:-1,-4:-1]=0
cases.append(case('distant-native-patch',rgba,labels,alpha))
record={'paper':'https://www.cs.jhu.edu/~misha/ReadingSeminar/Papers/Levin06.pdf','numpy':np.__version__,'scipy':scipy.__version__,'epsilon':1e-7,'cases':cases}
(OUT/'closed-form-reference.json').write_text(json.dumps(record,separators=(',',':'))+'\n')

def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
def png_rows(path,w,h,rows):
    compressor=zlib.compressobj(9);parts=[]
    for row in rows:
        part=compressor.compress(b'\0'+bytes(row))
        if part: parts.append(part)
    parts.append(compressor.flush())
    image=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'sRGB',b'\0')
    for part in parts:
        if part: image+=chunk(b'IDAT',part)
    path.write_bytes(image+chunk(b'IEND',b''))
for item in cases:
    if item['name']=='distant-native-patch':continue
    name='closed-form-'+item['name'];pixels=np.array(item['rgba'],dtype=np.uint8).reshape(item['height'],item['width'],4);matte=np.array(item['labels'],dtype=np.uint8).reshape(item['height'],item['width'])
    png_rows(OUT/(name+'.png'),item['width'],item['height'],pixels.reshape(item['height'],-1))
    trimap=np.full_like(pixels,255);trimap[:,:,3]=matte;png_rows(OUT/(name+'-trimap.png'),item['width'],item['height'],trimap.reshape(item['height'],-1))
# Stream a true 10000 x 5000 source and explicit trimap, without a generator-sized RGBA plane.
x0,y0=480,4604
patch=cases[-1];pixels=np.array(patch['rgba'],dtype=np.uint8).reshape(11,603,4)[1:-1,1:-1];labels=np.array(patch['labels'],dtype=np.uint8).reshape(11,603)[1:-1,1:-1]
def native_rows(trimap=False):
    for y in range(5000):
        row=np.zeros((10000,4),dtype=np.uint8)
        if trimap:row[:,:3]=255
        if y0<=y<y0+9:
            if trimap:row[x0:x0+601,3]=labels[y-y0]
            else:row[x0:x0+601]=pixels[y-y0]
        yield row.ravel()
for trimap in [False,True]:png_rows(OUT/('closed-form-native-50mp'+('-trimap' if trimap else '')+'.png'),10000,5000,native_rows(trimap))
print(json.dumps({'references':len(cases),'sha256':hashlib.sha256((OUT/'closed-form-reference.json').read_bytes()).hexdigest(),'syntheticQuality':{item['name']:item.get('syntheticQuality') for item in cases}},indent=2))
