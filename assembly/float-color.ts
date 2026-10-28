function encode(v:f64):f64{return v<=.0031308?12.92*v:1.055*Math.pow(v,1.0/2.4)-.055;}
function decode(v:f64):f64{return v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4);}
function shift(v:f64,amount:f64):f64{return amount<0?v*(1+amount):v+(1-v)*amount;}
function clamp(v:f64):f64{return Math.max(0.0,Math.min(1.0,v));}

/** Continuous existing HSL/balance/vibrance controls. Straight linear RGBA32,
 * f64 encoded-sRGB arithmetic, one f32 output store and unchanged alpha.
 * Status 1 invalid inputs, 2 non-neutral RGB outside [0,1], 3 output overflow. */
export function colorFloat(source:usize,output:usize,values:usize,pixels:i32,kind:i32):i32{
 if(pixels<0||kind<0||kind>2)return 1;
 const count=kind==0?3:kind==1?9:2;let neutral=true;
 for(let j=0;j<count;j++){const value=load<f64>(values+<usize>j*8),limit=kind==0&&j==0?180.0:100.0;if(!isFinite(value)||value< -limit||value>limit)return 1;if(value!=0)neutral=false;}
 if(kind==1){const preserve=load<f64>(values+72);if(preserve!=0&&preserve!=1)return 1;}
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<4;c++){const v=load<f32>(source+<usize>i*16+c*4);if(!isFinite(v)||c==3&&(v<0||v>1))return 1;}
 if(neutral){memory.copy(output,source,<usize>pixels*16);return 0;}
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<3;c++){const v=load<f32>(source+<usize>i*16+c*4);if(v<0||v>1)return 2;}
 for(let i=0;i<pixels;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16;
  const r=encode(<f64>load<f32>(p)),g=encode(<f64>load<f32>(p+4)),b=encode(<f64>load<f32>(p+8));
  let red:f64=0,green:f64=0,blue:f64=0;
  if(kind==0){
   const hue=load<f64>(values)/360,saturation=load<f64>(values+8)/100,lightness=load<f64>(values+16)/100;
   const maximum=Math.max(r,Math.max(g,b)),minimum=Math.min(r,Math.min(g,b)),delta=maximum-minimum;
   if(delta==0&&lightness==0){memory.copy(q,p,16);continue;}
   let l=(maximum+minimum)/2,h:f64=0,s:f64=0;
   if(delta!=0){
    // The equivalent sum form remains defined for subnormal dark samples;
    // 1-abs(2*l-1) would round to zero long before l itself underflows.
    s=delta/(l<=.5?maximum+minimum:2-maximum-minimum);
    h=maximum==r?((g-b)/delta)%6:maximum==g?(b-r)/delta+2:(r-g)/delta+4;
    h=(((h/6+hue)%1)+1)%1;s=shift(s,saturation);
   }
   l=shift(l,lightness);const c=2*Math.min(l,1-l)*s,x=c*(1-Math.abs(((h*6)%2)-1)),m=l-c/2,sector=<i32>Math.floor(h*6);
   if(sector==0){red=c;green=x;}else if(sector==1){red=x;green=c;}else if(sector==2){green=c;blue=x;}else if(sector==3){green=x;blue=c;}else if(sector==4){red=x;blue=c;}else{red=c;blue=x;}
   red+=m;green+=m;blue+=m;
  }else{
   const l=.3*r+.59*g+.11*b;let preserve=true;
   if(kind==1){
    const shadows=Math.max(0.0,1-2*l),highlights=Math.max(0.0,2*l-1),midtones=1-shadows-highlights;
    red=r+(load<f64>(values)*shadows+load<f64>(values+24)*midtones+load<f64>(values+48)*highlights)/100;
    green=g+(load<f64>(values+8)*shadows+load<f64>(values+32)*midtones+load<f64>(values+56)*highlights)/100;
    blue=b+(load<f64>(values+16)*shadows+load<f64>(values+40)*midtones+load<f64>(values+64)*highlights)/100;
    preserve=load<f64>(values+72)!=0;
   }else{
    const chroma=Math.max(r,Math.max(g,b))-Math.min(r,Math.min(g,b)),scale=Math.max(0.0,1+(load<f64>(values+8)+load<f64>(values)*(1-chroma))/100);
    red=l+(r-l)*scale;green=l+(g-l)*scale;blue=l+(b-l)*scale;
   }
   if(preserve){
    const delta=l-(.3*red+.59*green+.11*blue);red+=delta;green+=delta;blue+=delta;
    const low=Math.min(red,Math.min(green,blue)),high=Math.max(red,Math.max(green,blue));
    if(low<0){red=l+(red-l)*l/(l-low);green=l+(green-l)*l/(l-low);blue=l+(blue-l)*l/(l-low);}
    if(high>1){red=l+(red-l)*(1-l)/(high-l);green=l+(green-l)*(1-l)/(high-l);blue=l+(blue-l)*(1-l)/(high-l);}
   }
  }
  const rr=<f32>decode(clamp(red)),gg=<f32>decode(clamp(green)),bb=<f32>decode(clamp(blue));
  if(!isFinite(rr)||!isFinite(gg)||!isFinite(bb))return 3;
  store<f32>(q,rr);store<f32>(q+4,gg);store<f32>(q+8,bb);store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}
