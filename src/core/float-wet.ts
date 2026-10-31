import {z} from 'zod';
import {wetPaintMixSchema} from './wet-paint';

const color=z.number().finite().refine(value=>Number.isFinite(Math.fround(value)),'Float load color must round to finite float32.');
export const floatWetLoadSchema=z.object({color:z.tuple([color,color,color,z.number().finite().min(0).max(1)]).default([0,0,0,1]),load:z.number().finite().min(0).max(1).default(0)}).strict();
export type FloatWetLoadOptions=z.input<typeof floatWetLoadSchema>;
export type FloatWetLoadSettings=z.output<typeof floatWetLoadSchema>;
export const floatWetMixSchema=wetPaintMixSchema;
export const floatWetOpacitySchema=z.number().finite().min(0).max(1);
export interface FloatWetResult {pixels:Float32Array;carried:Float32Array}

/** Signed/HDR premultiplied RGB has no normalized gamut bound. Zero alpha
 * carries no pigment; nonzero alpha may retain any finite signed channel. */
export function validateFloatWetCarried(value:unknown,length:number):asserts value is Float32Array{
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||value.length!==length||length%4||length>262144*4)throw new Error('Float wet reservoir requires a matching fixed owned working window.');
 for(let i=0;i<length;i+=4){const alpha=value[i+3];if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('Float wet reservoir alpha is invalid.');for(let c=0;c<3;c++)if(!Number.isFinite(value[i+c])||alpha===0&&value[i+c]!==0)throw new Error('Float wet reservoir pigment is invalid.');}
}
export function validateFloatWetResult(value:unknown,length:number):asserts value is FloatWetResult{
 if(!value||typeof value!=='object'||Object.keys(value).length!==2||!('pixels'in value)||!('carried'in value))throw new Error('Invalid float wet worker result.');
 const {pixels,carried}=value as FloatWetResult;
 // Straight samples permit hidden RGB. Reservoir samples do not.
 if(!(pixels instanceof Float32Array)||!(pixels.buffer instanceof ArrayBuffer)||('resizable'in pixels.buffer&&pixels.buffer.resizable)||('detached'in pixels.buffer&&pixels.buffer.detached)||pixels.length!==length||length%4||length>262144*4)throw new Error('Float wet output geometry is invalid.');
 for(let i=0;i<length;i++)if(!Number.isFinite(pixels[i])||i%4===3&&(pixels[i]<0||pixels[i]>1))throw new Error('Float wet output samples are invalid.');
 validateFloatWetCarried(carried,length);
 if(pixels.byteOffset!==0||pixels.byteLength!==pixels.buffer.byteLength||carried.byteOffset!==0||carried.byteLength!==carried.buffer.byteLength||pixels.buffer===carried.buffer)throw new Error('Float wet outputs require independent complete owned buffers.');
}
