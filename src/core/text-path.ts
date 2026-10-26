import {z} from 'zod';
import {pathSchema,type PathAnchor} from './drawing';

const coordinate=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
/** Private baseline geometry. Reuses vector anchor validation and its editing
 * budget; original document/font dimensions are not allocation budgets. */
export const textPathSchema=z.object({
 points:pathSchema.shape.points,
 closed:z.boolean().default(false),
 startOffset:coordinate.default(0),
 baselineOffset:coordinate.default(0),
 reverse:z.boolean().default(false),
}).strict().superRefine((path,context)=>{
 const count=path.closed?path.points.length:path.points.length-1;
 let useful=false;
 for(let i=0;i<count;i++){
  const a=path.points[i],b=path.points[(i+1)%path.points.length];
  if(a.x!==b.x||a.y!==b.y||a.out.x!==a.x||a.out.y!==a.y||b.in.x!==b.x||b.in.y!==b.y){useful=true;break;}
 }
 if(!useful)context.addIssue({code:'custom',message:'Text requires a nonzero baseline path.'});
});
export type TextPathInput=z.input<typeof textPathSchema>;
export interface TextPathGeometry {
 readonly points:readonly Readonly<{x:number;y:number;in:Readonly<{x:number;y:number}>;out:Readonly<{x:number;y:number}>}>[];
 readonly closed:boolean;readonly startOffset:number;readonly baselineOffset:number;readonly reverse:boolean;
}
export function normalizeTextPath(input:TextPathInput):TextPathGeometry{
 const value=textPathSchema.parse(input);
 return Object.freeze({...value,points:Object.freeze(value.points.map(point=>Object.freeze({...point,in:Object.freeze(point.in),out:Object.freeze(point.out)})))});
}
/** Reverse the baseline, not Unicode source order or native glyph shaping.
 * Closed paths retain the original seam and reverse their cubic handles. */
export function textPathData(path:TextPathGeometry):string{
 const original=path.points,ordered=path.reverse?(path.closed?[original[0],...original.slice(1).reverse()]:[...original].reverse()):original;
 const points:readonly Readonly<PathAnchor>[]=path.reverse?ordered.map(p=>({...p,in:p.out,out:p.in})):ordered;
 let d=`M${points[0].x} ${points[0].y}`;
 for(let i=0;i<(path.closed?points.length:points.length-1);i++){
  const p=points[i],q=points[(i+1)%points.length];
  d+=`C${p.out.x} ${p.out.y} ${q.in.x} ${q.in.y} ${q.x} ${q.y}`;
 }
 return d+(path.closed?'Z':'');
}
