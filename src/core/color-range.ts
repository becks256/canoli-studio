import { z } from 'zod';
import { srgbToLinear, linearRgbToXyzD65, xyzD65ToD50, xyzD50ToLab } from './color/spaces';
import type { Vector3 } from './color/types';
import type { SelectionModificationControl } from './selection-modification';

const identifier = z.string().min(1).max(240);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit RGB hex color.');
const coordinate = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const colorRangeSourceSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('merged')}).strict(),
  z.object({kind:z.literal('layer'),layerId:identifier}).strict(),
  z.object({kind:z.literal('asset'),assetId:identifier,x:coordinate.default(0),y:coordinate.default(0)}).strict(),
]);
export const colorRangeOptionsSchema = z.object({
  colors:z.array(color).min(1).max(32),
  exclude:z.array(color).max(32).default([]),
  fuzziness:z.number().finite().min(0).max(200).default(40),
  invert:z.boolean().default(false),
  operation:z.enum(['replace','add','subtract','intersect']).default('replace'),
  source:colorRangeSourceSchema.default({kind:'merged'}),
}).strict();
export type ColorRangeOptions = z.input<typeof colorRangeOptionsSchema>;
export type ColorRangeSettings = z.output<typeof colorRangeOptionsSchema>;
export type ColorRangeControl = SelectionModificationControl;
export function colorRangeLab(rgb: readonly number[]): Vector3 {
  return xyzD50ToLab(xyzD65ToD50(linearRgbToXyzD65(rgb.map(value=>srgbToLinear(value/255)) as Vector3,'srgb')));
}
export function colorRangeSamples(colors: string[]): number[][] {
  return colors.map(color=>{const rgb=[1,3,5].map(offset=>parseInt(color.slice(offset,offset+2),16));return [rgb[0]*65536+rgb[1]*256+rgb[2],...colorRangeLab(rgb)];});
}

/** Pixel oracle only. Native preparation uses WASM in a dedicated image worker. */
export function colorRangeCoverage(pixels: Uint8ClampedArray, options: ColorRangeOptions): Uint8Array {
  const settings=colorRangeOptionsSchema.parse(options);
  if(pixels.length%4)throw new Error('Color Range requires complete RGBA pixels.');
  const includes=colorRangeSamples(settings.colors),excludes=colorRangeSamples(settings.exclude),result=new Uint8Array(pixels.length/4);
  for(let i=0;i<pixels.length;i+=4){
    const alpha=pixels[i+3];if(!alpha)continue;
    const rgb=[pixels[i],pixels[i+1],pixels[i+2]],packed=rgb[0]*65536+rgb[1]*256+rgb[2];
    const lab=settings.fuzziness?colorRangeLab(rgb):[0,0,0];
    const match=(samples:number[][])=>{
      if(!samples.length)return 0;
      if(!settings.fuzziness)return Number(samples.some(sample=>sample[0]===packed));
      let distance=Infinity;for(const sample of samples)distance=Math.min(distance,(lab[0]-sample[1])**2+(lab[1]-sample[2])**2+(lab[2]-sample[3])**2);
      return Math.max(0,1-Math.sqrt(distance)/settings.fuzziness);
    };
    const coverage=match(includes)*(1-match(excludes));result[i/4]=Math.round(alpha*(settings.invert?1-coverage:coverage));
  }
  return result;
}
