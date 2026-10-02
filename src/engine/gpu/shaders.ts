// All working textures contain premultiplied, encoded-sRGB RGBA8 pixels.
// Document coordinates are rebased to the current region in JS double precision.
export const fullscreen = /* wgsl */ `
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(p[index], 0, 1);
}
`;

export const processing =
  fullscreen +
  /* wgsl */ `
struct Params { a: vec4f, b: vec4f, c: vec4f, d: vec4f, e: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var<uniform> p: Params;
fn straight(c: vec4f) -> vec3f { return c.rgb / max(c.a, 0.000001); }
fn byte(v: vec3f) -> vec3f { return floor(clamp(v, vec3f(0), vec3f(1)) * 255 + 0.5) / 255; }
fn lum(c: vec3f) -> f32 { return dot(c, vec3f(0.3, 0.59, 0.11)); }
fn sat(c: vec3f) -> f32 { return max(max(c.r,c.g),c.b)-min(min(c.r,c.g),c.b); }
fn clipColor(c: vec3f) -> vec3f {
  let l=lum(c); let n=min(min(c.r,c.g),c.b); let x=max(max(c.r,c.g),c.b);
  var v=c;
  if(n<0) { v=vec3f(l)+(v-vec3f(l))*l/max(l-n,0.000001); }
  if(x>1) { v=vec3f(l)+(v-vec3f(l))*(1-l)/max(x-l,0.000001); }
  return v;
}
fn setLum(c: vec3f,l:f32)->vec3f { return clipColor(c+vec3f(l-lum(c))); }
fn setSat(c:vec3f,s:f32)->vec3f {
  let lo=min(min(c.r,c.g),c.b); let hi=max(max(c.r,c.g),c.b);
  return (c-vec3f(lo))*s/max(hi-lo,0.000001);
}
fn component(b:f32,s:f32,m:u32)->f32 {
  switch m {
    case 1u: { return b*s; }
    case 2u: { return b+s-b*s; }
    case 3u: { return select(2*b*s,1-2*(1-b)*(1-s),b>0.5); }
    case 4u: { return min(b,s); }
    case 5u: { return max(b,s); }
    case 6u: { if(b==0) {return 0;} if(s>=1) {return 1;} return min(1,b/(1-s)); }
    case 7u: { if(b>=1) {return 1;} if(s==0) {return 0;} return 1-min(1,(1-b)/s); }
    case 8u: { return select(2*b*s,1-2*(1-b)*(1-s),s>0.5); }
    case 9u: {
      if(s<=0.5) {return b-(1-2*s)*b*(1-b);}
      let d=select(((16*b-12)*b+4)*b,sqrt(b),b>0.25);
      return b+(2*s-1)*(d-b);
    }
    case 10u: { return abs(b-s); }
    case 11u: { return b+s-2*b*s; }
    default: { return s; }
  }
}
fn blend(b:vec3f,s:vec3f,m:u32)->vec3f {
  switch m {
    case 12u: { return setLum(setSat(s,sat(b)),lum(b)); }
    case 13u: { return setLum(setSat(b,sat(s)),lum(b)); }
    case 14u: { return setLum(s,lum(b)); }
    case 15u: { return setLum(b,lum(s)); }
    default: { return vec3f(component(b.r,s.r,m),component(b.g,s.g,m),component(b.b,s.b,m)); }
  }
}
fn weight(v:f32,r:vec4f)->f32 {
  if(v<r.x || v>r.w) {return 0;}
  var lo=1.0; var hi=1.0;
  if(r.y>r.x) {lo=clamp((v-r.x)/(r.y-r.x),0,1);}
  if(r.w>r.z) {hi=clamp((r.w-v)/(r.w-r.z),0,1);}
  return min(lo,hi);
}
fn channel(c:vec3f)->f32 {
  if(p.b.z<0) {return dot(c,vec3f(0.2126,0.7152,0.0722))*255;}
  return c[u32(p.b.z)]*255;
}
@fragment fn fragment(@builtin(position) position:vec4f)->@location(0) vec4f {
  let xy=vec2i(position.xy);
  var s=textureLoad(source,xy,0); let b=textureLoad(backdrop,xy,0);
  switch u32(p.a.x) {
    case 1u: { // tone, round after each effect just like the WASM ABI
      let rgb=(byte(straight(s))*255*p.a.y-127.5)*p.a.z+127.5;
      let l=dot(rgb,vec3f(0.2126,0.7152,0.0722));
      return vec4f(byte((vec3f(l)+(rgb-vec3f(l))*p.a.w)/255)*s.a,s.a);
    }
    case 2u: { // color overlay then fill opacity
      return vec4f(mix(s.rgb,p.b.rgb*s.a,p.a.z),s.a)*p.a.y;
    }
    case 3u: { return s*b.a; } // captured selection mask
    case 4u: { return s; } // direct presentation
    case 5u: { // layer mask; density zero reveals the full source
      let coverage=select(b.a,1-b.a,p.a.z>0);
      // Match the reference mask surface's byte-alpha quantization before
      // applying coverage to premultiplied content and composing groups.
      let weight=floor((1-p.a.y+p.a.y*coverage)*255+0.5)/255;
      return s*weight;
    }
    case 6u: { // master levels
      let inR = max(0.0001, (p.a.z - p.a.y));
      let outR = p.b.y - p.b.x;
      let invG = 1.0 / max(0.01, p.a.w);
      let str = byte(straight(s));
      let norm = clamp((str * 255.0 - p.a.y) / inR, vec3f(0.0), vec3f(1.0));
      let corrected = pow(norm, vec3f(invG));
      let out = clamp((p.b.x + corrected * outR) / 255.0, vec3f(0.0), vec3f(1.0));
      return vec4f(byte(out) * s.a, s.a);
    }
    case 8u: { // encoded-sRGB HSL; preserve backdrop alpha
      let rgb=byte(straight(s));
      let maximum=max(rgb.r,max(rgb.g,rgb.b)); let minimum=min(rgb.r,min(rgb.g,rgb.b));
      let delta=maximum-minimum; var l=(maximum+minimum)*0.5;
      var hue=0.0; var sat=0.0;
      if(delta>0.0) {
        sat=delta/(1.0-abs(2.0*l-1.0));
        if(maximum==rgb.r) {hue=(rgb.g-rgb.b)/delta;}
        else if(maximum==rgb.g) {hue=(rgb.b-rgb.r)/delta+2.0;}
        else {hue=(rgb.r-rgb.g)/delta+4.0;}
        hue=fract(hue/6.0+p.a.y/360.0);
        let amount=p.a.z/100.0;
        sat=select(sat*(1.0+amount),sat+(1.0-sat)*amount,amount>=0.0);
      }
      let amount=p.a.w/100.0;
      l=select(l*(1.0+amount),l+(1.0-l)*amount,amount>=0.0);
      let c=(1.0-abs(2.0*l-1.0))*sat;
      let h=hue*6.0; let x=c*(1.0-abs((h-2.0*floor(h/2.0))-1.0));
      var out=vec3f(c,x,0.0);
      if(h>=5.0) {out=vec3f(c,0.0,x);}
      else if(h>=4.0) {out=vec3f(x,0.0,c);}
      else if(h>=3.0) {out=vec3f(0.0,x,c);}
      else if(h>=2.0) {out=vec3f(0.0,c,x);}
      else if(h>=1.0) {out=vec3f(x,c,0.0);}
      return vec4f(byte(out+vec3f(l-c*0.5))*s.a,s.a);
    }
    case 7u: { // blend adjustment layer preserving backdrop alpha
      if (b.a == 0.0) { return vec4f(0.0); }
      var w = select(clamp((s.a / b.a) * p.a.y, 0.0, 1.0), 0.0, s.a <= 0.0);
      if(p.b.y>0) { w*=weight(channel(byte(straight(s))),p.c)*(1-b.a+b.a*weight(channel(byte(straight(b))),p.d)); }
      var mixed = select(s.rgb / max(0.00001, s.a), vec3f(0.0), s.a <= 0.0);
      if (u32(p.a.z) != 0u) {
        mixed = blend(straight(b), mixed, u32(p.a.z));
      }
      let finalStraight = mix(straight(b), mixed, w);
      return vec4f(byte(finalStraight) * b.a, b.a);
    }
    default: { // blend and optional Blend If, then layer/stroke opacity
      if(p.b.y>0) {
        let w=weight(channel(byte(straight(s))),p.c)*(1-b.a+b.a*weight(channel(byte(straight(b))),p.d));
        let a=floor(s.a*w*255+0.5)/255;
        s=vec4f(straight(s)*a,a);
      }
      s*=p.a.y;
      if(u32(p.a.z)==16u) {return b*(1-s.a);} // paint clear
      let mixed=blend(straight(b),straight(s),u32(p.a.z));
      return vec4f((1-s.a)*b.rgb+(1-b.a)*s.rgb+s.a*b.a*mixed,s.a+b.a*(1-s.a));
    }
  }
}
`;

export const stamps = /* wgsl */ `
struct Params { size:vec2f, hardness:f32, pencil:f32, color:vec4f, linear:vec4f, inverse:vec4f }
struct Vertex {
  @builtin(position) position:vec4f,
  @location(0) @interpolate(flat) rect:vec4f,
  @location(1) @interpolate(flat) opacity:f32
}
@group(0) @binding(0) var<uniform> p:Params;
fn extent(radius:vec2f)->vec2f {
  return abs(p.linear.xy)*radius.x+abs(p.linear.zw)*radius.y;
}
@vertex fn vertex(@builtin(vertex_index) index:u32,@location(0) rect:vec4f,@location(1) opacity:f32)->Vertex {
  let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  let pixel=rect.xy+corners[index]*(extent(rect.zw)+vec2f(1));
  var out:Vertex;
  out.position=vec4f(pixel.x/p.size.x*2-1,1-pixel.y/p.size.y*2,0,1);
  out.rect=rect; out.opacity=opacity; return out;
}
@fragment fn fragment(v:Vertex)->@location(0) vec4f {
  // Fully covered hard interiors need no multisampling; reserve it for edges.
  let delta=v.position.xy-v.rect.xy;
  let center=(p.inverse.xy*delta.x+p.inverse.zw*delta.y)/v.rect.zw;
  let halfPixel=(abs(p.inverse.xy)+abs(p.inverse.zw))*0.5/v.rect.zw;
  let farthest=abs(center)+halfPixel;
  if((p.pencil>0 && all(farthest<=vec2f(1))) ||
     (p.pencil==0 && p.hardness>=0.999 && length(farthest)<=1)) {
    return vec4f(p.color.rgb*v.opacity,v.opacity);
  }
  var alpha=0.0;
  if(p.pencil>0 && p.linear.y==0 && p.linear.z==0) {
    let radius=extent(v.rect.zw);
    let lo=max(v.position.xy-vec2f(0.5),v.rect.xy-radius);
    let hi=min(v.position.xy+vec2f(0.5),v.rect.xy+radius);
    let coverage=max(hi-lo,vec2f(0)); alpha=coverage.x*coverage.y;
  } else {
    let grid=select(4u,8u,p.hardness>=0.999 || p.pencil>0);
    for(var y=0u;y<grid;y++) { for(var x=0u;x<grid;x++) {
      let pos=v.position.xy-vec2f(0.5)+(vec2f(f32(x),f32(y))+vec2f(0.5))/f32(grid);
      let delta=pos-v.rect.xy;
      let local=(p.inverse.xy*delta.x+p.inverse.zw*delta.y)/v.rect.zw;
      let r=length(local);
      if(p.pencil>0) { alpha+=select(0.0,1.0,all(abs(local)<=vec2f(1))); }
      else if(p.hardness>=0.999) { alpha+=select(0.0,1.0,r<=1); }
      else { alpha+=clamp((1-r)/max(1-p.hardness,0.000001),0,1); }
    }}
    alpha/=f32(grid*grid);
  }
  alpha*=v.opacity;
  return vec4f(p.color.rgb*alpha,alpha);
}
`;

export const selection =
  fullscreen +
  /* wgsl */ `
struct Region { rect:vec4f, info:vec4f, inverse:vec4f, offset:vec4f }
struct Params { count:u32, padding:vec3u }
@group(0) @binding(0) var<storage,read> regions:array<Region>;
@group(0) @binding(1) var<uniform> p:Params;
@fragment fn fragment(@builtin(position) position:vec4f)->@location(0) vec4f {
  var covered=0.0;
  for(var y=0u;y<4u;y++) { for(var x=0u;x<4u;x++) {
    let pos=floor(position.xy)+(vec2f(f32(x),f32(y))+vec2f(0.5))/4;
    var inside=false;
    for(var i=0u;i<p.count;i++) {
      let r=regions[i];
      let local=r.inverse.xy*pos.x+r.inverse.zw*pos.y+r.offset.xy;
      var hit=all(local>=vec2f(0)) && all(local<vec2f(1));
      if(hit && r.info.x>0) { let d=(local-vec2f(0.5))*2; hit=dot(d,d)<=1; }
      switch u32(r.info.y) {case 1u: {inside=inside && !hit;} case 2u: {inside=inside && hit;} default: {inside=inside || hit;}}
    }
    covered+=select(0.0,1.0,inside);
  }}
  let a=floor(covered*255/16+0.5)/255;
  return vec4f(a);
}
`;
