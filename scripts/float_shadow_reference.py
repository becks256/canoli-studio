"""Independent NumPy finite-Gaussian shadow/scene oracle, in native coordinates.

No editor, WASM or canvas pixels provide expected output. f64 ordered sums and
f32 storage per axis; root-plane fractional offset follows the convolution.
"""
import copy, math
import numpy as np
from float_style_reference import over, appearance
from float_clipping_reference import tone, interpolate

def convolve(alpha, sigma, axis):
    radius = math.ceil(3*sigma)
    if not radius:
        return alpha.copy()
    weights = [math.exp(-.5*(k/sigma)**2) for k in range(-radius, radius+1)]
    total = sum(weights)
    weights = [v/total for v in weights]
    shape = list(alpha.shape);shape[axis] -= 2*radius
    result = np.zeros(shape, dtype=np.float64)
    for k, weight in enumerate(weights):
        part = [slice(None)]*2;part[axis] = slice(k, k+shape[axis])
        result += alpha[tuple(part)].astype(np.float64)*weight
    return np.clip(result, 0, 1).astype(np.float32)

def shadow(shape, settings, region):
    x, y, width, height = region
    empty = np.zeros((height, width, 4), dtype=np.float32)
    if not settings['enabled'] or not settings['opacity']:
        return empty
    left, top = math.floor(x-settings['x']), math.floor(y-settings['y'])
    fx, fy = x-settings['x']-left, y-settings['y']-top
    w, h = width+int(fx != 0), height+int(fy != 0)
    radius = math.ceil(3*settings['blur'])
    alpha = shape((left-radius, top-radius, w+2*radius, h+2*radius))
    blurred = convolve(convolve(alpha, settings['blur'], 1), settings['blur'], 0)
    sampled = np.zeros((height, width), dtype=np.float64)
    for dy in range(2 if fy else 1):
        for dx in range(2 if fx else 1):
            sampled += blurred[dy:dy+height, dx:dx+width].astype(np.float64)*(fx if dx else 1-fx)*(fy if dy else 1-fy)
    empty[..., 3] = (sampled*settings['opacity']).astype(np.float32)
    rgb = np.array([int(settings['color'][at:at+2], 16)/255 for at in [1,3,5]])
    rgb = np.where(rgb <= .04045, rgb/12.92, ((rgb+.055)/1.055)**2.4).astype(np.float32)
    empty[..., :3] = np.where((empty[..., 3]>0)[..., None], rgb, 0)
    return empty

def render(source, layers, region=None, source_geometry=None):
    """source can be native RGBA or a window reader with explicit geometry.
    Registered affine cases use exact integer right-angle transforms.
    """
    if callable(source):
        read = source;sw, sh = source_geometry
    else:
        sh, sw = source.shape[:2]
        def read(area):
            x,y,w,h=area;out=np.zeros((h,w,4),np.float32)
            l,r,t,b=max(0,x),min(sw,x+w),max(0,y),min(sh,y+h)
            if r>l and b>t:out[t-y:b-y,l-x:r-x]=source[t:b,l:r]
            return out
    region = region or (0,0,sw,sh)
    def empty(area):return np.zeros((area[3],area[2],4),np.float32)
    def world(node, parent):
        a=node.get('transform',dict(a=1,b=0,c=0,d=1,e=0,f=0))
        local=np.array([[a['a'],a['c'],a['e']+node.get('x',0)],[a['b'],a['d'],a['f']+node.get('y',0)],[0,0,1]],dtype=np.float64)
        return parent@local
    def mask(node, area):
        spec=node.get('mask')
        if spec is None:return None
        x,y,w,h=area;mx,my,mw,mh=spec['rect']
        raw=np.broadcast_to((np.arange(w)[None,:]+x>=mx)&(np.arange(w)[None,:]+x<mx+mw)&(np.arange(h)[:,None]+y>=my)&(np.arange(h)[:,None]+y<my+mh),(h,w))
        if spec.get('inverted',False):raw=~raw
        density=spec.get('density',1.)
        return (np.floor(((1-density)+density*raw)*255+.5)/255).astype(np.float32)
    def raster(node, matrix, area):
        # The fixture deliberately restricts to exact native lattice transforms.
        inverse=np.linalg.inv(matrix);x,y,w,h=area
        xx,yy=np.meshgrid(np.arange(w)+x+.5,np.arange(h)+y+.5)
        u=inverse[0,0]*xx+inverse[0,1]*yy+inverse[0,2]-.5
        v=inverse[1,0]*xx+inverse[1,1]*yy+inverse[1,2]-.5
        assert np.max(np.abs(u-np.rint(u)))<1e-10 and np.max(np.abs(v-np.rint(v)))<1e-10
        u,v=np.rint(u).astype(int),np.rint(v).astype(int)
        l,r,t,b=int(u.min()),int(u.max())+1,int(v.min()),int(v.max())+1
        native=read((l,t,r-l,b-t));result=native[v-t,u-l].copy()
        for effect in node.get('tones',[]):result=tone(result,effect)
        result[result[...,3]==0,:3]=0
        return result
    def stacks(nodes, flat):
        rows=[]
        for node in nodes:
            if flat or not node.get('clipped',False):rows.append((node,[]))
            elif rows and rows[-1][0]['kind']!='adjustment':rows[-1][1].append(node)
        return rows
    def paint(nodes, backdrop, parent, area, flat=False):
        for node,members in stacks(nodes,flat):
            if not node.get('visible',True) or node.get('opacity',1)==0:continue
            matrix=world(node,parent);coverage=mask(node,area);fill=node.get('fillOpacity',1);opacity=node.get('opacity',1);mode=node.get('blendMode','normal')
            def intrinsic(at):return raster(node,matrix,at) if node['kind']=='raster' else paint(node['children'],empty(at),matrix,at)
            if node['kind']=='group' and mode=='pass-through' and not members:
                backdrop=interpolate(backdrop,paint(node['children'],backdrop.copy(),matrix,area),opacity,coverage);continue
            if node['kind']=='adjustment':
                pixels=tone(backdrop,node.get('tone',{}));gate=None
                if 'styles'in node:pixels,gate=appearance(pixels,backdrop,node['styles'])
                if coverage is not None:gate=coverage if gate is None else (gate.astype(np.float64)*coverage).astype(np.float32)
                backdrop=interpolate(backdrop,pixels,opacity*fill,gate);continue
            raw=intrinsic(area);pixels=raw.copy()
            members=[m for m in members if m.get('visible',True) and m.get('opacity',1)>0]
            if members:
                shape=raw[...,3].copy();pixels[...,3]=np.where(shape>0,fill,0);pixels[shape==0,:3]=0
                pixels=paint(members,pixels,parent,area,True);pixels[...,3]=(pixels[...,3].astype(np.float64)*shape).astype(np.float32);pixels[pixels[...,3]==0,:3]=0;fill=1
            style=node.get('styles');settings=style.get('dropShadow') if style else None
            if settings and settings['enabled'] and settings['opacity']:
                def silhouette(at):
                    alpha=intrinsic(at)[...,3];m=mask(node,at)
                    return alpha if m is None else (alpha.astype(np.float64)*m).astype(np.float32)
                field=shadow(silhouette,settings,area)
                pixels[...,3]=(pixels[...,3].astype(np.float64)*(1 if coverage is None else coverage)*fill).astype(np.float32)
                overlay=copy.deepcopy(style);overlay['blendIf']['enabled']=False
                pixels,_=appearance(pixels,backdrop,overlay);pixels=over(pixels,field)
                gate=copy.deepcopy(style);gate['colorOverlay']['enabled']=False
                pixels,coverage=appearance(pixels,backdrop,gate)
                backdrop=over(pixels,backdrop,opacity,coverage,mode)
            else:
                if style:
                    pixels,gate=appearance(pixels,backdrop,style)
                    if style['blendIf']['enabled']:coverage=gate if coverage is None else (gate.astype(np.float64)*coverage).astype(np.float32)
                backdrop=over(pixels,backdrop,opacity*fill,coverage,mode)
        return backdrop
    return paint(layers,empty(region),np.eye(3),region)
