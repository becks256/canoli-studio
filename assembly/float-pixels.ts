/** Private straight RGBA float32 operations. Components share one blending
 * encoding; color conversion happens outside this kernel. No 8-bit staging. */
function luminosity(r:f64,g:f64,b:f64):f64{return .3*r+.59*g+.11*b;}
function setSaturation(p:usize,s:f64):void{
 const r=load<f64>(p),g=load<f64>(p+8),b=load<f64>(p+16),lo=Math.min(r,Math.min(g,b)),hi=Math.max(r,Math.max(g,b)),scale=hi>lo?s/(hi-lo):0;
 store<f64>(p,(r-lo)*scale);store<f64>(p+8,(g-lo)*scale);store<f64>(p+16,(b-lo)*scale);
}
function setLuminosity(p:usize,l:f64):void{
 const d=l-luminosity(load<f64>(p),load<f64>(p+8),load<f64>(p+16));let r=load<f64>(p)+d,g=load<f64>(p+8)+d,b=load<f64>(p+16)+d;
 const lo=Math.min(r,Math.min(g,b)),hi=Math.max(r,Math.max(g,b));
 if(lo<0){const k=l/(l-lo);r=l+(r-l)*k;g=l+(g-l)*k;b=l+(b-l)*k;}
 if(hi>1){const k=(1-l)/(hi-l);r=l+(r-l)*k;g=l+(g-l)*k;b=l+(b-l)*k;}
 store<f64>(p,r);store<f64>(p+8,g);store<f64>(p+16,b);
}
function blend(b:f64,s:f64,mode:i32):f64{
 if(mode==1)return b*s;
 if(mode==2)return b+s-b*s;
 if(mode==3)return b<=.5?2*b*s:1-2*(1-b)*(1-s);
 if(mode==4)return Math.min(b,s);
 if(mode==5)return Math.max(b,s);
 if(mode==6)return b==0?0:s==1?1:Math.min(1,b/(1-s));
 if(mode==7)return b==1?1:s==0?0:1-Math.min(1,(1-b)/s);
 if(mode==8)return s<=.5?2*b*s:1-2*(1-b)*(1-s);
 if(mode==9){if(s<=.5)return b-(1-2*s)*b*(1-b);const d=b<=.25?((16*b-12)*b+4)*b:Math.sqrt(b);return b+(2*s-1)*(d-b);}
 if(mode==10)return Math.abs(b-s);
 if(mode==11)return b+s-2*b*s;
 if(mode==16)return Math.max(0,Math.min(1,b+2*s-1));
 if(mode==17)return Math.max(0,b+s-1);
 return s;
}
/** 0 success, 1 invalid input/layout, 2 SDR artistic blend domain,
 * 3 nonrepresentable output. All buffers belong to the private host owner. */
export function compositeFloat(source:usize,backdrop:usize,output:usize,mask:usize,scratch:usize,pixels:i32,opacity:f64,mode:i32):i32{
 if(pixels<0||!isFinite(opacity)||opacity<0||opacity>1||mode<0||mode>17)return 1;
 for(let i=0;i<pixels;i++){
  const o=<usize>i*16,s=source+o,b=backdrop+o,coverage=mask?load<f32>(mask+<usize>i*4):1;
  if(!isFinite(coverage)||coverage<0||coverage>1)return 1;
  for(let c:usize=0;c<4;c++){const sc=load<f32>(s+c*4),bc=load<f32>(b+c*4);if(!isFinite(sc)||!isFinite(bc)||c==3&&(sc<0||sc>1||bc<0||bc>1))return 1;if(mode!=0&&c<3&&(sc<0||sc>1||bc<0||bc>1))return 2;}
 }
 for(let i=0;i<pixels;i++){
  const o=<usize>i*16,s=source+o,b=backdrop+o,out=output+o,sa=<f64>load<f32>(s+12)*opacity*(mask?<f64>load<f32>(mask+<usize>i*4):1),ba=<f64>load<f32>(b+12),alpha=sa+ba*(1-sa);
  if(sa==0){for(let c:usize=0;c<4;c++)store<f32>(out+c*4,load<f32>(b+c*4));continue;}
  if(mode>=12&&mode<=15){
   const sr=<f64>load<f32>(s),sg=<f64>load<f32>(s+4),sb=<f64>load<f32>(s+8),br=<f64>load<f32>(b),bg=<f64>load<f32>(b+4),bb=<f64>load<f32>(b+8),fromSource=mode==12||mode==14;
   store<f64>(scratch,fromSource?sr:br);store<f64>(scratch+8,fromSource?sg:bg);store<f64>(scratch+16,fromSource?sb:bb);
   if(mode==12)setSaturation(scratch,Math.max(br,Math.max(bg,bb))-Math.min(br,Math.min(bg,bb)));
   if(mode==13)setSaturation(scratch,Math.max(sr,Math.max(sg,sb))-Math.min(sr,Math.min(sg,sb)));
   setLuminosity(scratch,mode==15?luminosity(sr,sg,sb):luminosity(br,bg,bb));
  }
  for(let c:usize=0;c<3;c++){
   const sc=<f64>load<f32>(s+c*4),bc=<f64>load<f32>(b+c*4),raw=mode>=12&&mode<=15?load<f64>(scratch+c*8):blend(bc,sc,mode),mixed=mode==0?raw:Math.max(0,Math.min(1,raw));
   const value=<f32>((sa*(1-ba)*sc+sa*ba*mixed+(1-sa)*ba*bc)/alpha);if(!isFinite(value))return 3;store<f32>(out+c*4,value);
  }
  store<f32>(out+12,<f32>alpha);
 }
 return 0;
}
/** RGB affine adjustment in the caller's explicit common encoding. Alpha is
 * unchanged; finite extended RGB is retained, overflow rejects. Matrix 3x4. */
export function affineFloat(source:usize,output:usize,matrix:usize,pixels:i32):i32{
 if(pixels<0)return 1;
 for(let j:usize=0;j<12;j++)if(!isFinite(load<f64>(matrix+j*8)))return 1;
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<4;c++){const value=load<f32>(source+<usize>i*16+c*4);if(!isFinite(value)||c==3&&(value<0||value>1))return 1;}
 for(let i=0;i<pixels;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16,r=<f64>load<f32>(p),g=<f64>load<f32>(p+4),b=<f64>load<f32>(p+8);
  for(let c:usize=0;c<3;c++){const m=matrix+c*32,value=<f32>(load<f64>(m)*r+load<f64>(m+8)*g+load<f64>(m+16)*b+load<f64>(m+24));if(!isFinite(value))return 3;store<f32>(q+c*4,value);}
  store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}

/** Tone in working RGB: contrast pivots around 0.5; saturation uses Rec.709
 * luminance. Linear document exposure is physical gain. No gamut clipping. */
export function toneFloat(source:usize,output:usize,pixels:i32,exposure:f64,contrast:f64,saturation:f64):i32{
 if(pixels<0||!isFinite(exposure)||exposure< -3||exposure>3||!isFinite(contrast)||contrast< -100||contrast>100||!isFinite(saturation)||saturation< -100||saturation>100)return 1;
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<4;c++){const value=load<f32>(source+<usize>i*16+c*4);if(!isFinite(value)||c==3&&(value<0||value>1))return 1;}
 const gain=Math.pow(2.0,exposure),contrastGain=Math.pow(2.0,contrast/100.0),saturationGain=1.0+saturation/100.0;
 for(let i=0;i<pixels;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16;
  let r=<f64>load<f32>(p)*gain,g=<f64>load<f32>(p+4)*gain,b=<f64>load<f32>(p+8)*gain;
  // Neutral stages skip subtract/add cancellation, preserving low-order HDR
  // and near-zero values exactly instead of perturbing an identity operation.
  if(contrast!=0){r=(r-.5)*contrastGain+.5;g=(g-.5)*contrastGain+.5;b=(b-.5)*contrastGain+.5;}
  if(saturation!=0){const luminance=r*.2126+g*.7152+b*.0722;r=luminance+(r-luminance)*saturationGain;g=luminance+(g-luminance)*saturationGain;b=luminance+(b-luminance)*saturationGain;}
  const red=<f32>r,green=<f32>g,blue=<f32>b;if(!isFinite(red)||!isFinite(green)||!isFinite(blue))return 3;
  store<f32>(q,red);store<f32>(q+4,green);store<f32>(q+8,blue);store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}
