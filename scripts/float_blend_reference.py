"""Independent NumPy scene-linear blending and adjustment-alpha reference.
W3C Compositing Level 1 plus the editor's bounded Linear Light/Burn definitions.
No application imports, canvas pixels, worker or WASM supplies expected values.
"""
import numpy as np
from float_clipping_reference import tone
MODES=['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion','hue','saturation','color','luminosity','linear-light','linear-burn']
def lum(c):return c[...,0]*.3+c[...,1]*.59+c[...,2]*.11
def extrema(c):return np.minimum(np.minimum(c[...,0],c[...,1]),c[...,2]),np.maximum(np.maximum(c[...,0],c[...,1]),c[...,2])
def sat(c):
 lo,hi=extrema(c);return hi-lo
def set_sat(c,s):
 lo,hi=extrema(c);return np.divide(c-lo[...,None],(hi-lo)[...,None],out=np.zeros_like(c),where=(hi>lo)[...,None])*s[...,None]
def set_lum(c,l):
 v=c+(l-lum(c))[...,None];lo,hi=extrema(v);idx=lo<0
 if np.any(idx):v[idx]=l[idx,None]+(v[idx]-l[idx,None])*(l[idx]/(l[idx]-lo[idx]))[:,None]
 idx=hi>1
 if np.any(idx):v[idx]=l[idx,None]+(v[idx]-l[idx,None])*((1-l[idx])/(hi[idx]-l[idx]))[:,None]
 return v
def color(back,source,mode):
 b=back.astype(np.float64,copy=False);s=source.astype(np.float64,copy=False)
 if mode=='normal':return s
 assert np.all((b>=0)&(b<=1))and np.all((s>=0)&(s<=1)),'Artistic blend inputs must be normalized'
 with np.errstate(divide='ignore',invalid='ignore'):
  if mode=='multiply':v=b*s
  elif mode=='screen':v=1-(1-b)*(1-s)
  elif mode=='overlay':v=np.where(b<=.5,2*b*s,1-2*(1-b)*(1-s))
  elif mode=='darken':v=np.minimum(b,s)
  elif mode=='lighten':v=np.maximum(b,s)
  elif mode=='color-dodge':v=np.where(b==0,0,np.where(s==1,1,np.minimum(1,b/(1-s))))
  elif mode=='color-burn':v=np.where(b==1,1,np.where(s==0,0,1-np.minimum(1,(1-b)/s)))
  elif mode=='hard-light':v=np.where(s<=.5,2*b*s,1-2*(1-b)*(1-s))
  elif mode=='soft-light':v=np.where(s<=.5,b-(1-2*s)*b*(1-b),b+(2*s-1)*(np.where(b<=.25,((16*b-12)*b+4)*b,np.sqrt(b))-b))
  elif mode=='difference':v=np.abs(b-s)
  elif mode=='exclusion':v=b+s-2*b*s
  elif mode=='hue':v=set_lum(set_sat(s,sat(b)),lum(b))
  elif mode=='saturation':v=set_lum(set_sat(b,sat(s)),lum(b))
  elif mode=='color':v=set_lum(s,lum(b))
  elif mode=='luminosity':v=set_lum(b,lum(s))
  elif mode=='linear-light':v=np.clip(b+2*s-1,0,1)
  elif mode=='linear-burn':v=np.maximum(0,b+s-1)
  else:raise ValueError(mode)
 return np.clip(v,0,1)
def over(source,backdrop,mode='normal',opacity=1.,mask=None):
 s=source.astype(np.float64);b=backdrop.astype(np.float64);sa=s[...,3]*opacity*(1. if mask is None else mask.astype(np.float64));ba=b[...,3];alpha=sa+ba*(1-sa);mixed=color(b[...,:3],s[...,:3],mode)
 numerator=(sa*(1-ba))[...,None]*s[...,:3]+(sa*ba)[...,None]*mixed+((1-sa)*ba)[...,None]*b[...,:3]
 rgb=np.divide(numerator,alpha[...,None],out=np.zeros_like(numerator),where=alpha[...,None]>0);out=np.empty_like(source,dtype=np.float32);out[...,:3]=rgb;out[...,3]=alpha;out[sa==0]=backdrop[sa==0];return out

def interpolate(before,after,opacity,mask):
 amount=opacity*(1. if mask is None else mask.astype(np.float64));amount=np.broadcast_to(amount,before.shape[:2]);ba=before[...,3].astype(np.float64)*(1-amount);aa=after[...,3].astype(np.float64)*amount;alpha=ba+aa
 numerator=before[...,:3].astype(np.float64)*ba[...,None]+after[...,:3].astype(np.float64)*aa[...,None];rgb=np.divide(numerator,alpha[...,None],out=np.zeros_like(numerator),where=alpha[...,None]>0)
 out=np.empty_like(before,dtype=np.float32);out[...,:3]=rgb;out[...,3]=alpha;out[amount==0]=before[amount==0];out[amount==1]=after[amount==1];return out

def render(source,layers,origin=(0,0)):
 height,width=source.shape[:2];empty=lambda:np.zeros_like(source);gx=np.arange(width)[None,:]+origin[0];gy=np.arange(height)[:,None]+origin[1]
 def mask(layer):
  spec=layer.get('mask')
  if spec is None:return None
  x,y,w,h=spec['rect'];raw=np.broadcast_to((gx>=x)&(gx<x+w)&(gy>=y)&(gy<y+h),(height,width)).astype(np.float64)
  if spec.get('inverted',False):raw=1-raw
  density=spec.get('density',1);return(np.floor(((1-density)+density*raw)*255+.5)/255).astype(np.float32)
 def raster(layer):
  assert layer.get('x',0)==layer.get('y',0)==0
  values=source
  for effect in layer.get('tones',[]):
   if effect.get('enabled',True):values=tone(values,effect)
  if values is source:values=source.copy()
  values[values[...,3]==0,:3]=0;return values
 def stacks(nodes,flat):
  if flat:return[(n,[])for n in nodes]
  rows=[]
  for node in nodes:
   if not node.get('clipped',False):rows.append((node,[]))
   elif rows and rows[-1][0]['kind']!='adjustment':rows[-1][1].append(node)
  return rows
 def paint(nodes,initial,flat=False):
  backdrop=initial
  for layer,members in stacks(nodes,flat):
   if not layer.get('visible',True)or layer.get('opacity',1)==0:continue
   visible=[m for m in members if m.get('visible',True)and m.get('opacity',1)>0];coverage=mask(layer);opacity=layer.get('opacity',1);fill=layer.get('fillOpacity',1);mode=layer.get('blendMode','normal');kind=layer['kind']
   if visible:
    intrinsic=raster(layer)if kind=='raster'else paint(layer['children'],empty());shape=intrinsic[...,3].copy();plane=intrinsic.copy();plane[...,3]=np.where(shape>0,fill,0).astype(np.float32);plane[shape==0,:3]=0
    plane=paint(visible,plane,True);plane[...,3]=(plane[...,3].astype(np.float64)*shape.astype(np.float64)).astype(np.float32);plane[plane[...,3]==0,:3]=0;backdrop=over(plane,backdrop,'normal'if mode=='pass-through'else mode,opacity,coverage)
   elif kind=='raster':backdrop=over(raster(layer),backdrop,mode,opacity*fill,coverage)
   elif kind=='group':
    if mode=='pass-through':backdrop=interpolate(backdrop,paint(layer['children'],backdrop.copy()),opacity,coverage)
    else:backdrop=over(paint(layer['children'],empty()),backdrop,mode,opacity*fill,coverage)
   else:
    adjusted=tone(backdrop,layer.get('tone',{}))
    if mode!='normal':adjusted[...,:3]=color(backdrop[...,:3],adjusted[...,:3],mode).astype(np.float32)
    backdrop=interpolate(backdrop,adjusted,opacity*fill,coverage)
  return backdrop
 return paint(layers,empty())
