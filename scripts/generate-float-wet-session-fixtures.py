"""Independent scalar float64 retained-stroke and bilinear HDR references."""
from pathlib import Path
import gzip,hashlib,json,math
import numpy as np
root=Path(__file__).resolve().parents[1];out=root/'tests/fixtures/float-wet-session';out.mkdir(exist_ok=True)
files={}
def save(name,value):
    raw=np.asarray(value,dtype='<f4').tobytes();packed=gzip.compress(raw,mtime=0);(out/(name+'.f32le.gz')).write_bytes(packed)
    files[name]={'bytes':len(packed),'sha256':hashlib.sha256(packed).hexdigest(),'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest()}
def sample(x,y):
    a=0 if (x+y)%13==0 else .375+((x*3+y*5)&7)/16
    return np.array([2+x*.25,-3+y*.125,8+((x-y)&7)*.5,a],dtype=np.float32)
region={'x':-8,'y':-4,'width':20,'height':16}
original=np.array([sample(x,y) for y in range(region['y'],region['y']+region['height']) for x in range(region['x'],region['x']+region['width'])],dtype=np.float32)
save('source',original)
points=[[-1.5,2.5],[-.5,2.5],[.5,2.5],[.5,3.5],[1.5,3.5],[2.5,3.5]]
load={'color':[4.5,-2.25,13.125,.375],'load':.37};mix={'flow':.8,'wetness':.2,'pickup':.7};opacity=.625;flow=.625
clip={'x':-3,'y':1,'width':6,'height':4}
canvas={};previous={};previous_center=None
for number,(cx,cy) in enumerate(points,1):
    left=math.floor(cx-3.5);top=math.floor(cy-3.5);right=math.ceil(cx+3.5);bottom=math.ceil(cy+3.5);next={}
    for y in range(top,bottom):
        for x in range(left,right):
            s=canvas.get((x,y),sample(x,y)).astype(np.float64)
            if previous_center is None:
                a=s[3]*(1-load['load'])+load['color'][3]*load['load'];p=np.empty(4,dtype=np.float32);p[3]=a
                p[:3]=s[:3]*s[3]*(1-load['load'])+np.array(load['color'][:3])*load['color'][3]*load['load']
                if p[3]==0:p[:3]=0
            else:
                dx=cx-previous_center[0];dy=cy-previous_center[1];p=previous.get((int(x-dx),int(y-dy)),np.zeros(4,dtype=np.float32)).copy()
                p[:3]=p[:3].astype(np.float64)+0 # fixed four-neighbor sum order
                if p[3]==0:p[:3]=0
            p=p.astype(np.float64)
            mask=[1/4096,.375,1][(x+2*y)%3] if cx-1.5<=x+.5<cx+1.5 and cy-1.5<=y+.5<cy+1.5 else 0
            mask=float(np.float32(mask));strength=(flow*mix['flow'])*mask;d=strength*(1-mix['wetness']);k=strength*mix['pickup']
            result=s.astype(np.float32);carried=p.astype(np.float32)
            if d>0:
                alpha=s[3]*(1-d)+p[3]*d;result[3]=alpha
                result[:3]=0 if result[3]==0 else (s[:3]*s[3]*(1-d)+p[:3]*d)/alpha
            if k>0:
                carried[3]=p[3]*(1-k)+s[3]*k
                carried[:3]=0 if carried[3]==0 else p[:3]*(1-k)+s[:3]*s[3]*k
            canvas[x,y]=result;next[x,y]=carried
    previous=next;previous_center=(cx,cy)
    if number in [2,3,6]:
        output=original.copy()
        for row,y in enumerate(range(region['y'],region['y']+region['height'])):
            for col,x in enumerate(range(region['x'],region['x']+region['width'])):
                index=row*region['width']+col;s=original[index].astype(np.float64);r=canvas.get((x,y),original[index]).astype(np.float64)
                if not clip['x']<=x<clip['x']+clip['width'] or not clip['y']<=y<clip['y']+clip['height'] or np.array_equal(s.view(np.uint64),r.view(np.uint64)):continue
                a=s[3]*(1-opacity);b=r[3]*opacity;alpha=a+b;output[index,3]=alpha
                output[index,:3]=0 if output[index,3]==0 else (s[:3]*a+r[:3]*b)/alpha
        save({2:'prefix',3:'middle',6:'final'}[number],output)
# Independent dyadic affine inverse/bilinear fixture. Source premultiplied RGB
# deliberately includes negative and above-alpha channels.
bounds={'x':-16,'y':-16,'width':32,'height':32}
def pigment(x,y):
    if x< -16 or y< -16 or x>=16 or y>=16:return np.zeros(4,dtype=np.float32)
    a=np.float32(((x*17+y*31)&255)/256)
    return np.array([(x/4-2)*a,(y/8+3)*a,(8+(x-y)/16)*a,a],dtype=np.float32)
field=np.array([pigment(x,y) for y in range(-16,16) for x in range(-16,16)]);save('field',field)
frames=[{'previous':[1,-.5,.25,2,1.25,-.75],'current':[2,.5,0,1,-.5,.25]}, {'previous':[-1,.5,0,2,.25,-.5],'current':[0,1,-1,0,0,0]}, {'previous':[1,0,0,1,0,0],'current':[1,0,0,1,8.25,9.5]}]
window={'x':-3,'y':-2,'width':7,'height':6}
for index,row in enumerate(frames):
    a,b,c,d,e,f=row['current'];pa,pb,pc,pd,pe,pf=row['previous'];det=a*d-b*c;values=[]
    for y in range(window['y'],window['y']+window['height']):
        for x in range(window['x'],window['x']+window['width']):
            nx=x+.5-e;ny=y+.5-f;u=(d*nx-c*ny)/det;v=(-b*nx+a*ny)/det;sx=pa*u+pc*v+pe-.5;sy=pb*u+pd*v+pf-.5
            bx=math.floor(sx);by=math.floor(sy);fx=sx-bx;fy=sy-by
            weights=[(1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy];neighbors=[pigment(bx,by),pigment(bx+1,by),pigment(bx,by+1),pigment(bx+1,by+1)]
            rgba=np.array([((float(neighbors[0][c])*weights[0]+float(neighbors[1][c])*weights[1])+(float(neighbors[2][c])*weights[2]+float(neighbors[3][c])*weights[3])) for c in range(4)],dtype=np.float32)
            if rgba[3]==0:rgba[:3]=0
            values.append(rgba)
    save('spatial-'+str(index),values)
manifest={'version':1,'oracle':'Independent NumPy/scalar float64 math with final float32 stores; no editor code or WASM','generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'region':region,'points':points,'load':load,'mix':mix,'opacity':opacity,'flow':flow,'clip':clip,'bounds':bounds,'window':window,'frames':frames,'files':files}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(files),'bytes':sum(v['bytes'] for v in files.values())}))
