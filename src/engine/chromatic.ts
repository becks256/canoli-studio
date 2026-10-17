import { chromaticAdjustmentSchema, type ChromaticAdjustmentData } from '../core/adjustments';

/** Reference implementation for conformance tests; production pixel loops run in WASM workers/WGSL. */
export function adjustChromatic(input: Uint8ClampedArray, options: ChromaticAdjustmentData): Uint8ClampedArray {
  if (input.length%4) throw new Error('Chromatic adjustments require complete RGBA pixels.');
  const settings=chromaticAdjustmentSchema.parse(options),output=input.slice();
  const lum=(c:number[])=>0.3*c[0]+0.59*c[1]+0.11*c[2];
  const setLum=(c:number[],l:number)=>{
    const delta=l-lum(c);let v=c.map(x=>x+delta);
    const n=Math.min(...v),x=Math.max(...v);
    if(n<0)v=v.map(value=>l+(value-l)*l/(l-n));
    if(x>1)v=v.map(value=>l+(value-l)*(1-l)/(x-l));
    return v;
  };
  for(let i=0;i<input.length;i+=4){
    const rgb=[input[i]/255,input[i+1]/255,input[i+2]/255],l=lum(rgb);
    let result:number[];
    if(settings.kind==='color-balance'){
      const shadows=Math.max(0,1-2*l),highlights=Math.max(0,2*l-1),midtones=1-shadows-highlights;
      result=(['red','green','blue'] as const).map((channel,c)=>rgb[c]+(settings.shadows[channel]*shadows+settings.midtones[channel]*midtones+settings.highlights[channel]*highlights)/100);
      if(settings.preserveLuminosity)result=setLum(result,l);
    }else{
      const chroma=Math.max(...rgb)-Math.min(...rgb);
      const scale=Math.max(0,1+(settings.saturation+settings.vibrance*(1-chroma))/100);
      result=setLum(rgb.map(c=>l+(c-l)*scale),l);
    }
    for(let c=0;c<3;c++)output[i+c]=Math.round(Math.max(0,Math.min(1,result[c]))*255);
  }
  return output;
}
