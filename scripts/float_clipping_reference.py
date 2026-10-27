"""Independent NumPy float64 sibling clipping oracle over native source samples.
The only inputs are retained native CMM references and declarative scene data.
No editor decoder, compositor, WASM or canvas supplies expected values.
"""
import numpy as np

def tone(pixels,settings):
 out=pixels.copy();rgb_values=out[:,:,:3].astype(np.float64)*2.**settings.get('exposure',0)
 contrast=settings.get('contrast',0);saturation=settings.get('saturation',0)
 if contrast!=0:rgb_values=(rgb_values-.5)*2.**(contrast/100)+.5
 if saturation!=0:
  lum=rgb_values[:,:,0]*.2126+rgb_values[:,:,1]*.7152+rgb_values[:,:,2]*.0722;rgb_values=lum[:,:,None]+(rgb_values-lum[:,:,None])*(1+saturation/100)
 out[:,:,:3]=rgb_values.astype(np.float32);return out

def over(source,backdrop,opacity=1.,mask=None):
 s=source.astype(np.float64);b=backdrop.astype(np.float64);sa=s[:,:,3]*opacity*(1. if mask is None else mask.astype(np.float64));ba=b[:,:,3];alpha=sa+ba*(1-sa)
 # Separate non-overlap/overlap contributions implement ordinary source-over.
 numerator=(sa*(1-ba))[:,:,None]*s[:,:,:3]+(sa*ba)[:,:,None]*s[:,:,:3]+((1-sa)*ba)[:,:,None]*b[:,:,:3]
 rgb_values=np.divide(numerator,alpha[:,:,None],out=np.zeros_like(numerator),where=alpha[:,:,None]>0)
 out=np.concatenate([rgb_values,alpha[:,:,None]],axis=2).astype(np.float32);out[sa==0]=backdrop[sa==0];return out

def interpolate(before,after,opacity,mask):
 amount=opacity*(1. if mask is None else mask.astype(np.float64));amount=np.broadcast_to(amount,before.shape[:2]);ba=before[:,:,3].astype(np.float64)*(1-amount);aa=after[:,:,3].astype(np.float64)*amount;alpha=ba+aa
 rgb_values=np.divide(before[:,:,:3].astype(np.float64)*ba[:,:,None]+after[:,:,:3].astype(np.float64)*aa[:,:,None],alpha[:,:,None],out=np.zeros_like(before[:,:,:3],dtype=np.float64),where=alpha[:,:,None]>0)
 out=np.concatenate([rgb_values,alpha[:,:,None]],axis=2).astype(np.float32);out[amount==0]=before[amount==0];out[amount==1]=after[amount==1];return out

def render(source,layers,origin=(0,0)):
 height,width=source.shape[:2];empty=lambda:np.zeros_like(source);grid_x=np.arange(width)[None,:]+origin[0];grid_y=np.arange(height)[:,None]+origin[1]
 def mask(layer):
  spec=layer.get('mask')
  if spec is None:return None
  x,y,w,h=spec['rect'];raw=np.broadcast_to((grid_x>=x)&(grid_x<x+w)&(grid_y>=y)&(grid_y<y+h),(height,width)).astype(np.float64)
  if spec.get('inverted',False):raw=1-raw
  density=spec.get('density',1.)
  # Existing mask coverage is byte-valued, then normalized to float32.
  return (np.floor(((1-density)+density*raw)*255+.5)/255).astype(np.float32)
 def raw_raster(layer,parent):
  dx=parent[0]+layer.get('x',0);dy=parent[1]+layer.get('y',0);assert int(dx)==dx and int(dy)==dy
  if origin!=(0,0):assert dx==dy==0,'Streaming large-source fixtures intentionally use native placement.'
  values=source.copy()
  for effect in layer.get('tones',[]):
   if effect.get('enabled',True):values=tone(values,effect)
  values[values[:,:,3]==0,:3]=0;out=empty();left=max(0,dx);right=min(width,width+dx);top=max(0,dy);bottom=min(height,height+dy)
  if right>left and bottom>top:out[top:bottom,left:right]=values[top-dy:bottom-dy,left-dx:right-dx]
  return out
 def stacks(nodes,flat=False):
  if flat:return [(node,[])for node in nodes]
  rows=[]
  for node in nodes:
   if not node.get('clipped',False):rows.append((node,[]))
   elif rows and rows[-1][0]['kind']!='adjustment':rows[-1][1].append(node)
  return rows
 def paint(nodes,initial,parent=(0,0),flat=False):
  backdrop=initial
  for layer,members in stacks(nodes,flat):
   if not layer.get('visible',True)or layer.get('opacity',1)==0:continue
   visible=[m for m in members if m.get('visible',True)and m.get('opacity',1)>0];world=(parent[0]+layer.get('x',0),parent[1]+layer.get('y',0));coverage=mask(layer);opacity=layer.get('opacity',1);fill=layer.get('fillOpacity',1);kind=layer['kind']
   if visible:
    intrinsic=raw_raster(layer,parent)if kind=='raster'else paint(layer['children'],empty(),world)
    shape=intrinsic[:,:,3].copy();plane=intrinsic.copy();plane[:,:,3]=np.where(shape>0,fill,0).astype(np.float32);plane[shape==0,:3]=0
    plane=paint(visible,plane,parent,True);plane[:,:,3]=(plane[:,:,3].astype(np.float64)*shape.astype(np.float64)).astype(np.float32);plane[plane[:,:,3]==0,:3]=0
    backdrop=over(plane,backdrop,opacity,coverage)
   elif kind=='raster':backdrop=over(raw_raster(layer,parent),backdrop,opacity*fill,coverage)
   elif kind=='group':
    if layer.get('blendMode','normal')=='pass-through':backdrop=interpolate(backdrop,paint(layer['children'],backdrop.copy(),world),opacity,coverage)
    else:backdrop=over(paint(layer['children'],empty(),world),backdrop,opacity*fill,coverage)
   else:backdrop=interpolate(backdrop,tone(backdrop,layer.get('tone',{})),opacity*fill,coverage)
  return backdrop
 return paint(layers,empty())
