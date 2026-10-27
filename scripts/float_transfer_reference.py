"""Independent float64 working-RGB Curves/Levels oracle over original float32.
Control values retain public 0..255 units, independent of any color lookup table.
"""
import math
import numpy as np

def curve(values,points):
 x=np.array([p['x']/255 for p in points],dtype=np.float64);y=np.array([p['y']/255 for p in points],dtype=np.float64)
 if np.array_equal(x,y):return values.copy()
 d=np.diff(y)/np.diff(x);m=np.empty(len(x));m[0]=d[0];m[-1]=d[-1];m[1:-1]=d[:-1]/2+d[1:]/2
 for i,slope in enumerate(d):
  if slope==0:m[i:i+2]=0;continue
  if m[i]/slope<0:m[i]=0
  if m[i+1]/slope<0:m[i+1]=0
  a,b=m[i]/slope,m[i+1]/slope;length=math.hypot(a,b)
  if length>3:scale=3/length;m[i]=scale*a*slope;m[i+1]=scale*b*slope
 out=np.empty_like(values,dtype=np.float64);below=values<=x[0];above=values>=x[-1];out[below]=y[0]+(values[below]-x[0])*m[0];out[above]=y[-1]+(values[above]-x[-1])*m[-1]
 for i in range(len(x)-1):
  selected=(values>x[i])&(values<=x[i+1])&~above;h=x[i+1]-x[i];t=(values[selected]-x[i])/h;t2=t*t;t3=t2*t
  out[selected]=(2*t3-3*t2+1)*y[i]+(t3-2*t2+t)*h*m[i]+(-2*t3+3*t2)*y[i+1]+(t3-t2)*h*m[i+1]
 return out

def levels(values,channel):
 if channel==dict(inputBlack=0,inputWhite=255,gamma=1,outputBlack=0,outputWhite=255):return values.copy()
 black=channel['inputBlack']/255;span=(channel['inputWhite']-channel['inputBlack'])/255;power=1/channel['gamma'];low=channel['outputBlack']/255;extent=(channel['outputWhite']-channel['outputBlack'])/255
 return low+np.power(np.clip((values-black)/span,0,1),power)*extent

def adjust(pixels,adjustment):
 output=pixels.copy();rgb=pixels[...,:3].astype(np.float64);evaluate=curve if adjustment['kind']=='curves'else levels
 rgb=evaluate(rgb,adjustment['rgb'])
 for i,name in enumerate(['red','green','blue']):
  if name in adjustment:rgb[...,i]=evaluate(rgb[...,i],adjustment[name])
 output[...,:3]=rgb.astype(np.float32);return output
