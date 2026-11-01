import {z} from 'zod';
import type {PoissonBlendOptions} from './types';

export interface FloatPoissonBlendResult {
 pixels:Float32Array;
 converged:boolean;
 iterations:number;
 residual:number;
}
/** Absolute linear-light equation residual, not an encoded-byte tolerance. */
export const floatPoissonOptionsSchema=z.object({
 mode:z.enum(['source','mixed']).default('source'),
 tolerance:z.number().finite().positive().default(1e-7),
 maxIterations:z.number().int().positive().max(0x7fffffff).default(500),
}).strict();
export function captureFloatPoissonOptions(options:PoissonBlendOptions){return floatPoissonOptionsSchema.parse(options);}

/** Solver/search domains may span several render tiles. This validates actual
 * owned samples without turning the renderer's tile budget into an image cap. */
export function validateFloatRetouchPixels(pixels:Float32Array,width:number,height:number):void {
 if(![width,height,width*height*4].every(Number.isSafeInteger)||width<1||height<1||!(pixels instanceof Float32Array)||!(pixels.buffer instanceof ArrayBuffer)||('resizable' in pixels.buffer&&pixels.buffer.resizable)||('detached' in pixels.buffer&&pixels.buffer.detached)||pixels.length!==width*height*4)throw new Error('Float retouch requires fixed native RGBA windows with matching safe geometry.');
 for(let i=0;i<pixels.length;i++)if(!Number.isFinite(pixels[i])||i%4===3&&(pixels[i]<0||pixels[i]>1))throw new Error('Float retouch samples require finite linear RGB and alpha in [0,1].');
}
export function validateFloatRetouchCoverage(coverage:Uint8Array|Uint8ClampedArray,width:number,height:number):void {
 if(!(coverage instanceof Uint8Array||coverage instanceof Uint8ClampedArray)||!(coverage.buffer instanceof ArrayBuffer)||('resizable' in coverage.buffer&&coverage.buffer.resizable)||('detached' in coverage.buffer&&coverage.buffer.detached)||coverage.length!==width*height)throw new Error('Float retouch requires a fixed byte scalar coverage window matching native geometry.');
}
export function validateFloatRetouchMask(mask:Float32Array,width:number,height:number):void {
 if(!(mask instanceof Float32Array)||!(mask.buffer instanceof ArrayBuffer)||('resizable' in mask.buffer&&mask.buffer.resizable)||('detached' in mask.buffer&&mask.buffer.detached)||mask.length!==width*height)throw new Error('Native patch coverage requires fixed Float32 scalar geometry.');
 for(const value of mask)if(!Number.isFinite(value)||value<0||value>1)throw new Error('Native patch coverage must be finite and in [0,1].');
}
export function validateFloatPoissonResult(result:FloatPoissonBlendResult,width:number,height:number,options:ReturnType<typeof captureFloatPoissonOptions>,alpha:Uint32Array):void {
 if(!result||Object.keys(result).some(key=>!['pixels','converged','iterations','residual'].includes(key))||typeof result.converged!=='boolean'||!Number.isSafeInteger(result.iterations)||result.iterations<0||result.iterations>options.maxIterations||!Number.isFinite(result.residual)||result.residual<0||result.converged!==(result.residual<=options.tolerance))throw new Error('Invalid native float Poisson result or convergence report.');
 validateFloatRetouchPixels(result.pixels,width,height);
 if(result.pixels.byteOffset!==0||result.pixels.byteLength!==result.pixels.buffer.byteLength||alpha.length!==width*height)throw new Error('Float Poisson output must own its complete geometry.');
 const words=new Uint32Array(result.pixels.buffer);for(let p=0;p<alpha.length;p++)if(words[p*4+3]!==alpha[p])throw new Error('Float Poisson output changed target alpha.');
}
