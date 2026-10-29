"""Independent alpha frames for native-grid zero-Fill linked-mask dragging."""
import base64,hashlib,json,ctypes as C
from pathlib import Path
import numpy as np
from float_shadow_reference import shadow
root=Path(__file__).resolve().parents[1]
library=Path('/tmp/canoli-color-lcms2.19.1-native.so')
assert hashlib.sha256(library.read_bytes()).hexdigest()=='dc021a3a70e82f88eadff2deff512d155f846a87935658f5313d7cbb3ef9bcc6'
cms=C.CDLL(str(library));P=C.c_void_p;U=C.c_uint32
cms.cmsOpenProfileFromMem.argtypes=[P,U];cms.cmsOpenProfileFromMem.restype=P
cms.cmsCreateTransform.argtypes=[P,U,P,U,U,U];cms.cmsCreateTransform.restype=P
cms.cmsDoTransform.argtypes=[P,P,P,U];cms.cmsCloseProfile.argtypes=[P];cms.cmsDeleteTransform.argtypes=[P]
profiles=[]
for name in ['linear-srgb','srgb']:
    data=(root/'tests/fixtures/icc-native'/(name+'.icc')).read_bytes();profiles.append(cms.cmsOpenProfileFromMem(C.create_string_buffer(data),len(data)))
assert all(profiles)
base=(4<<16)|(3<<3)|128
transform=cms.cmsCreateTransform(profiles[0],base|4|(1<<22),profiles[1],base|1,1,0x4000000|0x400);assert transform
for p in profiles:cms.cmsCloseProfile(p)
frames=[]
for translation in range(0,25,2):
    def shape(area):
        x,y,w,h=area
        return np.broadcast_to((np.arange(w)[None,:]+x>=64+translation)&(np.arange(w)[None,:]+x<192+translation)&(np.arange(h)[:,None]+y>=64)&(np.arange(h)[:,None]+y<192),(h,w)).astype(np.float32)
    rgba=shadow(shape,dict(enabled=True,color='#ad3f79',opacity=.625,x=9.25,y=-4.75,blur=2.5),(0,0,256,256))
    # Independent pinned native CMM supplies the exact delivery quantization.
    output=np.empty(rgba.shape,np.uint8);cms.cmsDoTransform(transform,rgba.ctypes.data,output.ctypes.data,256*256)
    raw=np.ascontiguousarray(output[...,3]).tobytes()
    frames.append(dict(x=translation,alpha=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest()))
cms.cmsDeleteTransform(transform)
print(json.dumps(frames))
