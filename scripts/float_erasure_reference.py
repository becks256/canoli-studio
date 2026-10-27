"""Independent native-placement erasure oracle. Byte coverage is an authored
selection's complement; every operation multiplies original float alpha once.
No application rasterizer, scene implementation or WASM supplies expected data.
"""
import numpy as np

def erase(source,operations,origin=(0,0)):
 result=source.copy();h,w=source.shape[:2];x=np.arange(w)[None,:]+origin[0];y=np.arange(h)[:,None]+origin[1]
 for operation in operations:
  assert set(operation)<=set(['rect','value']);left,top,width,height=operation['rect'];value=operation.get('value',255);assert isinstance(value,int)and 0<=value<=255
  inside=np.broadcast_to((x>=left)&(x<left+width)&(y>=top)&(y<top+height),(h,w));coverage=np.where(inside,(255-value)/255,1).astype(np.float32)
  result[:,:,3]=(result[:,:,3].astype(np.float64)*coverage.astype(np.float64)).astype(np.float32)
 result[result[:,:,3]==0,:3]=0
 return result
