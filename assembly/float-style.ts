function encode(value:f64):f64{
 if(value<=0)return 0;if(value>=1)return 255;
 return (value<=.0031308?12.92*value:1.055*Math.pow(value,1.0/2.4)-.055)*255;
}
function selector(p:usize,channel:i32):f64{
 if(channel>0)return encode(<f64>load<f32>(p+<usize>(channel-1)*4));
 return Math.max(0,Math.min(255,.2126*encode(<f64>load<f32>(p))+.7152*encode(<f64>load<f32>(p+4))+.0722*encode(<f64>load<f32>(p+8))));
}
function weight(v:f64,range:usize):f64{
 const a=load<f64>(range),b=load<f64>(range+8),c=load<f64>(range+16),d=load<f64>(range+24);
 if(v<a||v>d)return 0;
 return Math.min(b>a?Math.min(1,Math.max(0,(v-a)/(b-a))):1,d>c?Math.min(1,Math.max(0,(d-v)/(d-c))):1);
}
/** Native pointwise appearance. Color output preserves alpha; a separate
 * coverage plane lets adjustments retain backdrop alpha and blend only once. */
export function styleFloat(source:usize,backdrop:usize,output:usize,coverage:usize,values:usize,pixels:i32,channel:i32):i32{
 if(pixels<0||channel<0||channel>3)return 1;
 const opacity=load<f64>(values),enabled=load<f64>(values+32);
 if(!isFinite(opacity)||opacity<0||opacity>1||(enabled!=0&&enabled!=1))return 1;
 for(let j:usize=1;j<=3;j++){const v=load<f64>(values+j*8);if(!isFinite(v)||v<0||v>1)return 1;}
 for(let start:usize=5;start<=9;start+=4){let previous:f64=0;for(let j:usize=0;j<4;j++){const v=load<f64>(values+(start+j)*8);if(!isFinite(v)||v<previous||v>255)return 1;previous=v;}}
 for(let i=0;i<pixels;i++)for(let c:usize=0;c<4;c++){
  const s=load<f32>(source+<usize>i*16+c*4),b=load<f32>(backdrop+<usize>i*16+c*4);
  if(!isFinite(s)||!isFinite(b)||c==3&&(s<0||s>1||b<0||b>1))return 1;
 }
 for(let i=0;i<pixels;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16;
  if(opacity==0)memory.copy(q,p,16);
  else{
   for(let c:usize=0;c<3;c++){
    const v=<f32>((1-opacity)*<f64>load<f32>(p+c*4)+opacity*load<f64>(values+(c+1)*8));
    if(!isFinite(v))return 3;store<f32>(q+c*4,v);
   }
   store<f32>(q+12,load<f32>(p+12));
  }
  const amount=enabled==0?1:weight(selector(q,channel),values+40)*weight(selector(backdrop+<usize>i*16,channel),values+72);
  store<f32>(coverage+<usize>i*4,<f32>amount);
 }
 return 0;
}
