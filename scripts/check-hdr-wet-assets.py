"""Independently decode prepared TIFFs with native libtiff and replay in NumPy.
No Canoli decoder, WASM, canvas, display bytes or editor math participates.
"""
from pathlib import Path
import ctypes as C,ctypes.util,gzip,hashlib,json,sys
import numpy as np
root=Path(__file__).resolve().parents[1];directory=Path(sys.argv[1]);record=json.loads((directory/'hdr-assets-replay.json').read_text())
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32

def fn(name,args,result):
    f=getattr(lib,name);f.argtypes=args;f.restype=result;return f
op=fn('TIFFOpen',[C.c_char_p,C.c_char_p],P);close=fn('TIFFClose',[P],None);get=fn('TIFFGetField',[P,U],C.c_int);read=fn('TIFFReadEncodedTile',[P,U,P,C.c_ssize_t],C.c_ssize_t)
profile=(root/'tests/fixtures/icc-native/linear-srgb.icc').read_bytes();asset_words=0

def image(name,region):
    global asset_words
    path=directory/name;handle=op(str(path.resolve()).encode(),b'r');assert handle,path
    try:
        def scalar(tag,kind=U):
            value=kind();assert get(handle,tag,C.byref(value)),tag;return value.value
        width=scalar(256);height=scalar(257);assert (width,height)==(region['width'],region['height'])
        assert scalar(258,C.c_uint16)==32 and scalar(339,C.c_uint16)==3 and scalar(277,C.c_uint16)==4 and scalar(284,C.c_uint16)==1 and scalar(262,C.c_uint16)==2
        count=C.c_uint16();pointer=P();assert get(handle,338,C.byref(count),C.byref(pointer)) and count.value==1 and C.cast(pointer,C.POINTER(C.c_uint16))[0]==2
        length=U();assert get(handle,34675,C.byref(length),C.byref(pointer));assert C.string_at(pointer,length.value)==profile
        tw=scalar(322);th=scalar(323);out=np.empty((height,width,4),dtype='<f4')
        for y in range(0,height,th):
            for x in range(0,width,tw):
                tile=np.empty((th,tw,4),dtype='<f4');assert read(handle,(y//th)*((width+tw-1)//tw)+x//tw,tile.ctypes.data,-1)==tile.nbytes
                h=min(th,height-y);w=min(tw,width-x);out[y:y+h,x:x+w]=tile[:h,:w]
        assert np.isfinite(out).all() and ((out[:,:,3]>=0)&(out[:,:,3]<=1)).all();asset_words+=out.size;return out
    finally:close(handle)

scope=record['scope'];width=scope['width'];height=scope['height'];before=np.frombuffer((directory/'before.f32le').read_bytes(),dtype='<f4').reshape(height,width,4)
source_manifest=json.loads((root/'tests/fixtures/float-source/manifest.json').read_text());case=next(row for row in source_manifest['cases'] if row['file']==record['file']);reference_path=root/'tests/fixtures/float-source'/case['reference'];assert hashlib.sha256(reference_path.read_bytes()).hexdigest()==source_manifest['files'][case['reference']]['sha256']
assert hashlib.sha256((root/'tests/fixtures/tiff-float'/case['file']).read_bytes()).hexdigest()==case['sourceSha256']
rows=[]
with gzip.open(reference_path,'rb') as stream:
    for y in range(height):stream.seek(((scope['y']+y)*case['width']+scope['x'])*16);rows.append(stream.read(width*16))
source=np.frombuffer(b''.join(rows),dtype='<f4').copy().reshape(height,width,4);source[source[:,:,3]==0,:3]=0
assert np.array_equal(before.view(np.uint32),source.view(np.uint32)),'Original window differs from independent native CMM samples'
field=np.zeros((height,width,5),dtype=np.float64)
for asset in record['assets']:
    region=asset['region'];pixels=image(asset['pixels'],region).astype(np.float64);coverage=image(asset['coverage'],region)[:,:,3].astype(np.float64);assert (pixels[:,:,3]<=coverage).all()
    for row in range(region['height']):
        for col in range(region['width']):
            x=region['x']+col-scope['x'];y=region['y']+row-scope['y']
            if not (0<=x<width and 0<=y<height):continue
            c=coverage[row,col];a=pixels[row,col,3]
            if c==0:continue
            p=field[y,x];rgb=pixels[row,col,:3]*a if a!=0 else np.zeros(3);prior=p[4]
            p[:3]=rgb if prior==0 or c==1 else p[:3]*(1-c)+rgb;p[3]=a if prior==0 or c==1 else p[3]*(1-c)+a;p[4]=c if prior==0 or c==1 else prior*(1-c)+c
expected=before.copy()
for y in range(height):
    for x in range(width):
        p=field[y,x];c=p[4]
        if c==0:continue
        left=1-c;alpha=p[3] if left==0 else float(before[y,x,3])*left+p[3];expected[y,x,3]=alpha
        n=p[:3] if left==0 else before[y,x,:3].astype(np.float64)*float(before[y,x,3])*left+p[:3]
        expected[y,x,:3]=0 if expected[y,x,3]==0 else n/alpha
comparisons=[]
for name in ['expected','actual','reopened']:
    raw=(directory/(name+'.f32le')).read_bytes();actual=np.frombuffer(raw,dtype='<f4').reshape(height,width,4);different=int(np.count_nonzero(actual.view(np.uint32)!=expected.view(np.uint32)));assert different==0,(name,different)
    comparisons.append({'name':name,'words':actual.size,'nonidenticalFloatWords':different,'sha256':hashlib.sha256(raw).hexdigest()})
extended=int(np.count_nonzero((expected[:,:,:3]<0)|(expected[:,:,:3]>1)));assert extended>0
print(json.dumps({'source':record['file'],'sourceDimensions':[case['width'],case['height']],'scope':scope,'sourceWindowWords':before.size,'sourceWindowExact':True,'assetCount':len(record['assets'])*2,'assetWordsRead':int(asset_words),'completeLinearProfileExact':True,'extendedSamples':extended,'comparisons':comparisons,'reference':'Independent native libtiff and NumPy Float64 ordered replacement, final Float32.'}))
