/** Continuous working-RGB transfer. Four fixed 100-double channel records:
 * identity, Hermite knots, or active Levels. Master precedes per-channel math. */
function sample(table:usize,x:f64):f64{
 const kind=load<f64>(table);if(kind==0)return x;
 if(kind==2){const t=Math.max(0,Math.min(1,(x-load<f64>(table+16))/load<f64>(table+24)));return load<f64>(table+40)+Math.pow(t,load<f64>(table+32))*load<f64>(table+48);}
 const n=<i32>load<f64>(table+8),first=table+16,last=first+<usize>(n-1)*24;
 if(x<=load<f64>(first))return load<f64>(first+8)+(x-load<f64>(first))*load<f64>(first+16);
 if(x>=load<f64>(last))return load<f64>(last+8)+(x-load<f64>(last))*load<f64>(last+16);
 let i=0;while(i<n-2&&load<f64>(first+<usize>(i+1)*24)<x)i++;
 const p=first+<usize>i*24,h=load<f64>(p+24)-load<f64>(p),t=(x-load<f64>(p))/h,t2=t*t,t3=t2*t;
 return(2*t3-3*t2+1)*load<f64>(p+8)+(t3-2*t2+t)*h*load<f64>(p+16)+(-2*t3+3*t2)*load<f64>(p+32)+(t3-t2)*h*load<f64>(p+40);
}
export function transferFloat(source:usize,output:usize,tables:usize,pixels:i32):i32{
 if(pixels<0)return 1;
 for(let i:usize=0;i<400;i++)if(!isFinite(load<f64>(tables+i*8)))return 1;
 for(let c:usize=0;c<4;c++){
  const p=tables+c*800,kind=load<f64>(p);if(kind==0)continue;
  if(kind==2){if(load<f64>(p+24)<=0||load<f64>(p+32)<=0)return 1;continue;}
  if(kind!=1)return 1;const count=load<f64>(p+8);if(count<2||count>32||Math.floor(count)!=count)return 1;const n=<i32>count;
  for(let i=1;i<n;i++)if(load<f64>(p+16+<usize>i*24)<=load<f64>(p+16+<usize>(i-1)*24))return 1;
 }
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<4;c++){const value=load<f32>(source+<usize>i*16+c*4);if(!isFinite(value)||c==3&&(value<0||value>1))return 1;}
 for(let i=0;i<pixels;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16;
  for(let c:usize=0;c<3;c++){const value=<f32>sample(tables+(c+1)*800,sample(tables,load<f32>(p+c*4)));if(!isFinite(value))return 3;store<f32>(q+c*4,value);}
  store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}
