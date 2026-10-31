import {srgbToLinear} from '../core/color/spaces';
import {floatWetLoadSchema,validateFloatWetCarried,validateFloatWetResult} from '../core/float-wet';
import type {BrushStrokeData,Rect} from '../core/drawing';
import {wetPaintLoadSchema,type WetPaintMixSettings} from '../core/wet-paint';
import {validateFloatAlpha} from '../core/float-shadow';
import {validateFloatWorkerWindow} from './float-pixels';
import {validateWetPixels,validateWetCarried,validateWetCoverage} from './wet-paint';
import {sampleWetField,sampleFloatWetField} from './wet-spatial';
import type {WetTile} from './wet-store';
import type {WetProcessor,FloatWetProcessor,WetStrokeOptions,FloatWetStrokeOptions} from './wet-state';

/** Private format policy; the retained lifecycle and native storage are shared. */
export interface WetPixelFormat<P extends WetTile> {
  readonly precision:'byte'|'float32';
  create(length:number):P;
  validate(value:unknown,length:number):P;
  equal(a:number,b:number):boolean;
}
export const byteWetPixels:WetPixelFormat<Uint8ClampedArray>={
  precision:'byte',create:length=>new Uint8ClampedArray(length),equal:(a,b)=>a===b,
  validate(value,length){validateWetPixels(value as Uint8ClampedArray);if((value as Uint8ClampedArray).length!==length)throw new Error('Wet-paint tile storage is incomplete.');return value as Uint8ClampedArray;},
};
export const floatWetPixels:WetPixelFormat<Float32Array>={
  precision:'float32',create:length=>new Float32Array(length),equal:Object.is,
  validate(value,length){validateFloatWorkerWindow(value as Float32Array);if((value as Float32Array).length!==length)throw new Error('Float wet-paint tile storage is incomplete.');return value as Float32Array;},
};
export interface WetSessionFormat<P extends WetTile> {
  readonly pixels:WetPixelFormat<P>;
  load(pixels:P):Promise<Float32Array>;
  mix(pixels:P,carried:Float32Array,coverage:Uint8Array|Float32Array,flow:number):Promise<{pixels:P;carried:Float32Array}>;
  envelope(before:P,after:P,selection:Uint8ClampedArray|undefined,opacity:number):Promise<P>;
  validateCarried(value:Float32Array,length:number):void;
  sample:typeof sampleWetField;
}
function unchanged<P extends WetTile>(before:P,after:P,at:number,format:WetPixelFormat<P>){
  for(let c=0;c<4;c++)if(!format.equal(before[at+c],after[at+c]))return false;
  return true;
}
export function byteWetFormat(stroke:BrushStrokeData,processor:WetProcessor,options:WetStrokeOptions,mix:WetPaintMixSettings):WetSessionFormat<Uint8ClampedArray>{
  const load=wetPaintLoadSchema.parse(options.load===undefined?{color:[1,3,5].map(at=>parseInt(stroke.color.slice(at,at+2),16)).concat(255)}:options.load);
  return {pixels:byteWetPixels,validateCarried:validateWetCarried,sample:sampleWetField,
    load:pixels=>processor.loadWetPaint(pixels,load),
    async mix(pixels,carried,coverage,flow){validateWetCoverage(coverage as Uint8Array,pixels.length);return processor.mixWetPaint(pixels,carried,coverage as Uint8Array,{...mix,flow});},
    async envelope(before,after,selection,opacity){
      const mask=selection??new Uint8ClampedArray(after.length);
      for(let p=3;p<mask.length;p+=4)mask[p]=Math.round((selection?mask[p]:255)*opacity);
      for(let p=0;p<after.length;p+=4)if(unchanged(before,after,p,byteWetPixels))mask[p+3]=0;
      return processor.mixFiltered(before,after,mask);
    },
  };
}
export function floatWetFormat(stroke:BrushStrokeData,processor:FloatWetProcessor,options:FloatWetStrokeOptions,mix:WetPaintMixSettings):WetSessionFormat<Float32Array>{
  const load=floatWetLoadSchema.parse(options.load===undefined?{color:[1,3,5].map(at=>srgbToLinear(parseInt(stroke.color.slice(at,at+2),16)/255)).concat(1)}:options.load);
  const customCoverage=options.coverage!==undefined;
  return {pixels:floatWetPixels,validateCarried:validateFloatWetCarried,sample:sampleFloatWetField,
    load:pixels=>processor.floatWetLoad(pixels,load),
    async mix(pixels,carried,mask,flow){
      let coverage:Float32Array;
      if(mask instanceof Uint8Array&&!customCoverage){validateWetCoverage(mask,pixels.length);coverage=Float32Array.from(mask,value=>value/255);}
      else {validateFloatAlpha(mask,pixels.length/4);coverage=mask;}
      const output=await processor.floatWetMix(pixels,carried,coverage,{...mix,flow});validateFloatWetResult(output,pixels.length);return output;
    },
    async envelope(before,after,selection,opacity){
      const coverage=new Float32Array(after.length/4);
      for(let p=0;p<after.length;p+=4)if(!unchanged(before,after,p,floatWetPixels))coverage[p/4]=selection?selection[p+3]/255:1;
      const result=await processor.floatWetEnvelope(before,after,coverage,opacity);floatWetPixels.validate(result,after.length);
      if(result.byteOffset||result.byteLength!==result.buffer.byteLength)throw new Error('Float wet-paint envelope requires a complete owned output.');
      return result;
    },
  };
}

export type WetSource<P extends WetTile>=(region:Rect)=>Promise<P>;
