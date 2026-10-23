#!/usr/bin/env python3
"""Independent NumPy equations over upstream dcraw_emu RGB16 reference planes.
No application TS, renderer, decoder or sampler is imported.
"""
from pathlib import Path
import json,gzip,hashlib
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/raw-lens';out.mkdir(exist_ok=True)
cases=[('barrel',{'distortion':{'k1':-.08,'k2':.01},'scale':1.05}),('pincushion',{'distortion':{'k1':.04}}),('chromatic',{'chromatic':{'red':.995,'blue':1.005},'scale':1.02}),('vignette',{'vignette':{'k1':-.2,'k2':.02}}),('combined',{'center':{'x':.48,'y':.52},'scale':1.1,'distortion':{'k1':-.06,'k2':.008,'k3':.001},'chromatic':{'red':.998,'blue':1.002},'vignette':{'k1':-.15,'k2':.03}})]
def corrected(source,settings):
 h,w,_=source.shape;cx=w*settings.get('center',{}).get('x',.5)-.5;cy=h*settings.get('center',{}).get('y',.5)-.5;norm=min(w,h)*.5;diagonal2=(w*w+h*h)*.25
 scale=settings.get('scale',1);d=settings.get('distortion',{});vg=settings.get('vignette',{});rgbscale=[settings.get('chromatic',{}).get('red',1),1,settings.get('chromatic',{}).get('blue',1)]
 table=np.arange(65536,dtype=np.float64)/65535;table=np.floor(np.clip(np.where(table<=.0031308,12.92*table,1.055*table**(1/2.4)-.055),0,1)*255+.5).astype(np.uint8)
 result=np.empty((h,w,4),dtype=np.uint8)
 for top in range(0,h,16):
  rows=min(16,h-top);x,y=np.meshgrid(np.arange(w,dtype=np.float64),np.arange(top,top+rows,dtype=np.float64));u=(x-cx)/(norm*scale);v=(y-cy)/(norm*scale);r2=u*u+v*v;f=1+r2*(d.get('k1',0)+r2*(d.get('k2',0)+r2*d.get('k3',0)));dx=u*f*norm;dy=v*f*norm;coverage=np.ones((rows,w))
  for c in range(3):
   xx=cx+dx*rgbscale[c];yy=cy+dy*rgbscale[c];left=np.floor(xx).astype(np.int64);low=np.floor(yy).astype(np.int64);fx=xx-left;fy=yy-low;total=np.zeros((rows,w));valid_weight=np.zeros((rows,w))
   for j in range(2):
    for i in range(2):
     sx=left+i;sy=low+j;weight=(fx if i else 1-fx)*(fy if j else 1-fy);valid=(sx>=0)&(sx<w)&(sy>=0)&(sy<h)&(weight!=0);sx=np.clip(sx,0,w-1);sy=np.clip(sy,0,h-1);radius2=((sx-cx)**2+(sy-cy)**2)/diagonal2;attenuation=1+radius2*(vg.get('k1',0)+radius2*(vg.get('k2',0)+radius2*vg.get('k3',0)))
     total+=np.where(valid,weight*(source[sy,sx,c]*(1/attenuation)),0);valid_weight+=np.where(valid,weight,0)
   values=np.divide(total,valid_weight,out=np.zeros_like(total),where=valid_weight!=0);values=np.floor(np.clip(values,0,65535)+.5).astype(np.uint16);result[top:top+rows,:,c]=table[values];coverage=np.minimum(coverage,valid_weight)
  alpha=np.floor(np.clip(coverage,0,1)*255+.5).astype(np.uint8);result[top:top+rows,:,3]=alpha;result[top:top+rows,:,:3][alpha==0]=0
 return result
records=[]
source=np.frombuffer((root/'tests/fixtures/raw/bayer-rggb.rgb16le').read_bytes(),dtype='<u2').reshape(48,64,3)
for name,options in cases:
 pixels=corrected(source,options);Image.fromarray(pixels,'RGBA').save(out/(name+'.png'));records.append({'name':name,'options':options,'width':64,'height':48,'rgbaSha256':hashlib.sha256(pixels.tobytes()).hexdigest()})
if '--large' in __import__('sys').argv:
 source=np.frombuffer(gzip.decompress((root/'tests/fixtures/raw/native-50mp.rgb16le.gz').read_bytes()),dtype='<u2').reshape(5000,10000,3)
 name='native-50mp';options=cases[-1][1];pixels=corrected(source,options);Image.fromarray(pixels,'RGBA').save(out/(name+'.png'));records.append({'name':name,'options':options,'width':10000,'height':5000,'rgbaSha256':hashlib.sha256(pixels.tobytes()).hexdigest()})
# Independent inverse radial mapping of ideal vertical lines: a geometric quality oracle.
y,x=np.mgrid[0:48,0:64].astype(np.float64);cx=31.5;cy=23.5;norm=24;dx=(x-cx)/norm;dy=(y-cy)/norm;rd=np.hypot(dx,dy);ru=rd.copy();k=-.07
for _ in range(25):
 ru-=np.divide(ru*(1+k*ru*ru)-rd,1+3*k*ru*ru,out=np.zeros_like(ru),where=np.abs(1+3*k*ru*ru)>1e-8)
ratio=np.divide(ru,rd,out=np.ones_like(rd),where=rd!=0);ux=cx+dx*ratio*norm
field=np.clip(sum(np.exp(-((ux-line)/.65)**2/2)for line in [16,48]),0,1)
plane=np.repeat(np.floor(field[:,:,None]*65535+.5).astype('<u2'),3,axis=2)
(out/'distorted-grid.rgb16le').write_bytes(plane.tobytes())
(out/'manifest.json').write_text(json.dumps({'generator':'Independent NumPy equations over native dcraw_emu reference planes','numpy':np.__version__,'cases':records},indent=2)+'\n')
print(json.dumps({'fixtures':len(records),'directory':str(out)}))
