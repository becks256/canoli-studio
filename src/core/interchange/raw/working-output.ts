import {hasLensCorrection,type LensCorrectionData} from './lens';
import {rawLensSampler} from './lens-sampler';
import type {OwnedRawImage} from './codec';
import type {OwnedLensCorrection} from '../lens/codec';
import {PngRowEncoder} from '../../png-stream';

// Apply the standard sRGB transfer once, after native linear RGB16 development.
// This bounded table is independent of source geometry and remains private.
const encoded=Uint8Array.from({length:65536},(_,value)=>{
  const linear=value/65535,sample=linear<=0.0031308?12.92*linear:1.055*Math.pow(linear,1/2.4)-0.055;
  return Math.floor(Math.max(0,Math.min(1,sample))*255+0.5);
});
export function rawLinearRowsToRgba8(samples:Uint16Array,channels:1|3):Uint8Array{
  if(!(samples instanceof Uint16Array)||![1,3].includes(channels)||samples.length%channels)throw new Error('Invalid RAW linear row samples.');
  const result=new Uint8Array(samples.length/channels*4);
  for(let from=0,to=0;from<samples.length;from+=channels,to+=4){
    result[to]=encoded[samples[from]];result[to+1]=encoded[samples[from+(channels===1?0:1)]];result[to+2]=encoded[samples[from+(channels===1?0:2)]];result[to+3]=255;
  }
  return result;
}

/** Convert bounded row copies; the native RGB16 plane stays owned until finally. */
export async function encodeRawWorkingImage(image:OwnedRawImage,progress?:(fraction:number)=>void,lens?:LensCorrectionData,profile?:OwnedLensCorrection){
  let encoder:PngRowEncoder|undefined,sampler:ReturnType<typeof rawLensSampler>|undefined;
  try{
    if(hasLensCorrection(lens))sampler=rawLensSampler(image,lens!,profile);
    else if(profile)throw new Error('Inactive lens settings cannot consume a native profile lease.');
    encoder=new PngRowEncoder(image.width,image.height);
    const rows=Math.max(1,Math.min(64,Math.floor(4_000_000/(image.width*(image.channels*2+8)+1))));
    progress?.(0);
    for(let top=0;top<image.height;top+=rows){
      const count=Math.min(rows,image.height-top);
      let rgba:Uint8Array;
      if(sampler){const corrected=sampler.rows(top,count);rgba=rawLinearRowsToRgba8(corrected.pixels,3);for(let i=0;i<corrected.alpha.length;i++)rgba[i*4+3]=corrected.alpha[i];}
      else rgba=rawLinearRowsToRgba8(image.readRows(top,count),image.channels);
      await encoder.append(rgba,count);progress?.((top+count)/image.height);
    }
    return await encoder.finish();
  }catch(error){await encoder?.abort(error);throw error;}
  finally{sampler?.dispose();try{image.dispose();}finally{profile?.dispose();}}
}
