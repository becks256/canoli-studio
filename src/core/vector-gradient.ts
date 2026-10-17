import {z} from 'zod';
import {affineSchema} from './transform-schema';

const coordinate=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const point=z.object({x:coordinate,y:coordinate}).strict();
const radius=z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER);
const circle=point.extend({radius});
export const vectorGradientStopSchema=z.object({
 position:z.number().finite().min(0).max(1),
 color:z.string().regex(/^#[0-9a-fA-F]{6}$/),
 opacity:z.number().finite().min(0).max(1).optional(),
}).strict();
const stops=z.array(vectorGradientStopSchema).min(2).max(32).refine(
 values=>values.every((stop,i)=>i===0||stop.position>=values[i-1].position),'Gradient stops must be ordered.');
const common={stops,transform:affineSchema.optional()};
export const vectorGradientSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('linear'),start:point,end:point,...common}).strict().refine(
  value=>value.start.x!==value.end.x||value.start.y!==value.end.y,'Linear gradient endpoints must differ.'),
 z.object({kind:z.literal('radial'),start:circle,end:circle.extend({radius:radius.positive()}),...common}).strict().refine(
  value=>value.start.x!==value.end.x||value.start.y!==value.end.y||value.start.radius!==value.end.radius,'Radial gradient circles must differ.'),
]);
export type VectorGradientData=z.infer<typeof vectorGradientSchema>;
export type VectorGradientStop=z.infer<typeof vectorGradientStopSchema>;
export const vectorFillRuleSchema=z.enum(['nonzero','evenodd']);
export interface VectorFillOptions {fillGradient?:VectorGradientData|null;fillRule?:'nonzero'|'evenodd'}
/** Optional records leave legacy paths byte-for-byte unchanged. */
export function vectorFillData(value:VectorFillOptions):VectorFillOptions{
 return {
  ...(value.fillGradient===undefined?{}:{fillGradient:value.fillGradient===null?null:vectorGradientSchema.parse(value.fillGradient)}),
  ...(value.fillRule===undefined?{}:{fillRule:vectorFillRuleSchema.parse(value.fillRule)}),
 };
}
export function gradientStopColor(stop:VectorGradientStop){
 const rgb=[1,3,5].map(offset=>parseInt(stop.color.slice(offset,offset+2),16));
 return `rgba(${rgb.join(',')},${stop.opacity??1})`;
}
