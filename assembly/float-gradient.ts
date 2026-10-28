/** Reflected extended sRGB transfer, CSS Color 4. */
export function encodeExtended(value:f64):f64{const a=Math.abs(value);if(a==1)return value;return a<=.0031308?value*12.92:(value<0?-1.0:1.0)*(1.055*Math.pow(a,1.0/2.4)-.055);}
export function decodeExtended(value:f64):f64{const a=Math.abs(value);if(a==1)return value;return a<=.04045?value/12.92:(value<0?-1.0:1.0)*Math.pow((a+.055)/1.055,2.4);}
/** Owned straight linear RGBA32; encoded luma/palette interpolation in f64.
 * Status 1 invalid source/controls, 3 nonfinite output. Alpha words unchanged. */
export function gradientFloat(source:usize,output:usize,stops:usize,pixels:i32,count:i32,reverse:bool):i32{
 if(pixels<0||count<2||count>32)return 1;
 let previous:f64=-1;
 for(let k=0;k<count;k++){const p=stops+<usize>k*32,position=load<f64>(p);if(!isFinite(position)||position<0||position>1||position<=previous)return 1;previous=position;for(let c:usize=1;c<4;c++){const v=load<f64>(p+c*8);if(!isFinite(v)||v<0||v>1)return 1;}}
 for(let k=0;k<pixels;k++)for(let c:usize=0;c<4;c++){const v=load<f32>(source+<usize>k*16+c*4);if(!isFinite(v)||c==3&&(v<0||v>1))return 1;}
 for(let k=0;k<pixels;k++){
  const p=source+<usize>k*16,q=output+<usize>k*16;let value=.2126*encodeExtended(load<f32>(p))+.7152*encodeExtended(load<f32>(p+4))+.0722*encodeExtended(load<f32>(p+8));if(reverse)value=1-value;
  let upper=1;while(upper<count-1&&value>load<f64>(stops+<usize>upper*32))upper++;
  const low=stops+<usize>(upper-1)*32,high=low+32,t=Math.max(0.0,Math.min(1.0,(value-load<f64>(low))/(load<f64>(high)-load<f64>(low))));
  for(let c:usize=0;c<3;c++){const a=load<f64>(low+(c+1)*8),b=load<f64>(high+(c+1)*8),v=<f32>decodeExtended(a+(b-a)*t);if(!isFinite(v))return 3;store<f32>(q+c*4,v);}store<f32>(q+12,load<f32>(p+12));
 }
 return 0;
}
