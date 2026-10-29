"""Independent complete-window oracle for the retained-original shadow profile.

The registered 50 MP fixture is opaque (also checked by the complete PNG oracle).
At zero Fill only its masked intrinsic alpha contributes. No application or
browser output supplies expected float samples.
"""
from pathlib import Path
import hashlib,json,sys
import numpy as np
from float_shadow_reference import shadow
report=json.loads(Path(sys.argv[1]).read_text())
assert report['dimensions']==[10000,5000]and report['sourceHash']=='51db60ac1377c69a75fc49328cbcca09a62e663dd277e08c967f85a3c792ac1c'
settings=dict(enabled=True,color='#ad3f79',opacity=.625,x=200.25,y=100.75,blur=1.25)
def shape(area):
    x,y,w,h=area
    return np.broadcast_to((np.arange(w)[None,:]+x>=3500)&(np.arange(w)[None,:]+x<4500)&(np.arange(h)[:,None]+y>=2000)&(np.arange(h)[:,None]+y<2700),(h,w)).astype(np.float32)
channels=0;visible=0;empty=0
for row in report['rounds'][0]['windows']:
    assert (row['width'],row['height'])==(128,64)
    expected=shadow(shape,settings,(row['x'],row['y'],row['width'],row['height']))
    assert hashlib.sha256(np.ascontiguousarray(expected,dtype='<f4').tobytes()).hexdigest()==row['sha256'],row
    count=int(np.count_nonzero(expected[...,3]));assert count==row['visible']
    channels+=expected.size;visible+=count;empty+=int(count==0)
assert channels==8388608 and visible>0 and empty>0
assert report['rounds'][0]['windows']==report['rounds'][1]['windows']
print(json.dumps(dict(channelsPerRound=channels,rounds=2,visiblePixels=visible,emptyWindows=empty,independentWordsExact=True)))
