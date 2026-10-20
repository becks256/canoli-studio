const DITHER=Float64Array.from({length:64},(_,index)=>{
  const x=index%8,y=Math.floor(index/8),base=[[0,3],[2,1]];let value=0;
  for(let bit=0;bit<3;bit++)value=value*4+base[(y>>bit)&1][(x>>bit)&1];
  return(value+.5)/64-.5;
});
/** Ordered gradient noise follows output pixels, rather than the working crop. */
export function gradientDither(x:number,y:number):number{return DITHER[(x&7)|((y&7)<<3)];}
function readPremultiplied(pixels:Uint8ClampedArray,offset:number):number{
  const a=pixels[offset+3];
  return Math.round(pixels[offset]*a/255)|(Math.round(pixels[offset+1]*a/255)<<8)|(Math.round(pixels[offset+2]*a/255)<<16)|(a<<24);
}
function composite(before:number,rgb:readonly number[],coverage:number,flow:number,dither:number):number{
  const alpha=coverage*flow,oldAlpha=before>>>24,after=Math.round(oldAlpha+(255-oldAlpha)*alpha);
  let result=after<<24;
  for(let channel=0;channel<3;channel++){
    const previous=(before>>>(channel*8))&255;
    const source=Math.max(0,Math.min(255*alpha,rgb[channel]*alpha+dither*flow));
    result|=Math.min(after,Math.round(source+previous*(1-alpha)))<<(channel*8);
  }
  return result;
}
function writePremultiplied(pixels:Uint8ClampedArray,offset:number,value:number):void{
  const a=value>>>24;
  for(let channel=0;channel<3;channel++)pixels[offset+channel]=a?Math.round(((value>>>(channel*8))&255)/a*255):0;
  pixels[offset+3]=a;
}
/** Round once at the destination; never stage a dab in an RGBA8 sprite. */
export function blendCoveragePixel(pixels:Uint8ClampedArray,offset:number,rgb:readonly number[],coverage:number,flow:number,dither=0):void{
  if(coverage*flow<=0)return;
  writePremultiplied(pixels,offset,composite(readPremultiplied(pixels,offset),rgb,coverage,flow,dither));
}
/** Accept an interval only when every possible coverage produces the same
 * premultiplied bytes. Check source-clamp breakpoints as well as endpoints. */
export function blendCoverageInterval(pixels:Uint8ClampedArray,offset:number,rgb:readonly number[],low:number,high:number,flow:number,dither=0):boolean{
  const before=readPremultiplied(pixels,offset),encoded=composite(before,rgb,low,flow,dither);
  if(composite(before,rgb,high,flow,dither)!==encoded)return false;
  for(const channel of rgb){
    const critical=dither>0&&channel<255?dither/(255-channel):dither<0&&channel>0?-dither/channel:-1;
    if(critical>low&&critical<high&&composite(before,rgb,critical,flow,dither)!==encoded)return false;
  }
  writePremultiplied(pixels,offset,encoded);return true;
}
