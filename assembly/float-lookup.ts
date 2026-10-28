import{encodeExtended,decodeExtended}from'./float-gradient';
function sample(table:usize,index:i32):f64{return <f64>load<f32>(table+<usize>index*4);}
function position(value:f64,min:f64,max:f64,size:i32):f64{return value<=min?0.0:value>=max?<f64>(size-1):(value-min)/(max-min)*<f64>(size-1);}
/** The owner validates and privately installs the complete finite table once.
 * Header: min RGB, max RGB, amount (f64). No byte/gamut intermediate.
 * Status 1 invalid source/header, 3 nonfinite float32 output. */
export function lookupFloat(source:usize,output:usize,table:usize,params:usize,pixels:i32,size:i32,dimension:i32,tetrahedral:bool,identity:bool):i32{
 if(pixels<0||size<2||dimension!=1&&dimension!=3||size>(dimension==1?65536:256))return 1;
 for(let c:usize=0;c<3;c++){const min=load<f64>(params+c*8),max=load<f64>(params+24+c*8);if(!isFinite(min)||!isFinite(max)||max<=min||!isFinite(max-min))return 1;}
 const amount=load<f64>(params+48)/100;if(!isFinite(amount)||amount<0||amount>1)return 1;
 for(let k=0;k<pixels;k++)for(let c:usize=0;c<4;c++){const v=load<f32>(source+<usize>k*16+c*4);if(!isFinite(v)||c==3&&(v<0||v>1))return 1;}
 if(amount==0){memory.copy(output,source,<usize>pixels*16);return 0;}
 const sr=3,sg=size*3,sb=size*size*3;
 for(let k=0;k<pixels;k++){
  const p=source+<usize>k*16,q=output+<usize>k*16,r=encodeExtended(load<f32>(p)),g=encodeExtended(load<f32>(p+4)),b=encodeExtended(load<f32>(p+8));
  if(identity&&r>=load<f64>(params)&&r<=load<f64>(params+24)&&g>=load<f64>(params+8)&&g<=load<f64>(params+32)&&b>=load<f64>(params+16)&&b<=load<f64>(params+40)){memory.copy(q,p,16);continue;}
  const pr=position(r,load<f64>(params),load<f64>(params+24),size),pg=position(g,load<f64>(params+8),load<f64>(params+32),size),pb=position(b,load<f64>(params+16),load<f64>(params+40),size);
  const lr=<i32>Math.min(size-2,Math.floor(pr)),lg=<i32>Math.min(size-2,Math.floor(pg)),lb=<i32>Math.min(size-2,Math.floor(pb)),fr=pr-lr,fg=pg-lg,fb=pb-lb,base=lr*sr+lg*sg+lb*sb;
  let sa=sr,sd=sg,fa=fr,fd=fg,fe=fb;
  if(fr>=fg){if(fg>=fb){}else if(fr>=fb){sd=sb;fd=fb;fe=fg;}else{sa=sb;sd=sr;fa=fb;fd=fr;fe=fg;}}
  else{if(fb>=fg){sa=sb;sd=sg;fa=fb;fd=fg;fe=fr;}else if(fb>=fr){sa=sg;sd=sb;fa=fg;fd=fb;fe=fr;}else{sa=sg;sd=sr;fa=fg;fd=fr;fe=fb;}}
  for(let c=0;c<3;c++){
   const original=c==0?r:c==1?g:b;
   if(identity&&original>=load<f64>(params+<usize>c*8)&&original<=load<f64>(params+24+<usize>c*8)){store<f32>(q+<usize>c*4,load<f32>(p+<usize>c*4));continue;}
   let value:f64=0;
   if(dimension==1){const low=(c==0?lr:c==1?lg:lb)*3+c,f=c==0?fr:c==1?fg:fb;value=(1-f)*sample(table,low)+f*sample(table,low+3);}
   else if(tetrahedral){const a=sample(table,base+c),d=sample(table,base+c+sa),e=sample(table,base+c+sa+sd),z=sample(table,base+c+sr+sg+sb);value=(1-fa)*a+(fa-fd)*d+(fd-fe)*e+fe*z;}
   else for(let bz=0;bz<2;bz++)for(let gy=0;gy<2;gy++)for(let rx=0;rx<2;rx++)value+=sample(table,base+c+rx*sr+gy*sg+bz*sb)*(rx==1?fr:1-fr)*(gy==1?fg:1-fg)*(bz==1?fb:1-fb);
   const v=<f32>decodeExtended((1-amount)*original+amount*value);if(!isFinite(v))return 3;store<f32>(q+<usize>c*4,v);
  }
  store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}
