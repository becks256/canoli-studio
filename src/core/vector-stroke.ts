import {z} from 'zod';
import type {VectorPathData,Point} from './drawing';

/** Optional records preserve the round-cap/round-join appearance of older files. */
export const vectorStrokeSchema=z.object({
 strokeCap:z.enum(['butt','round','square']).optional(),
 strokeJoin:z.enum(['miter','round','bevel']).optional(),
 strokeMiterLimit:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
 strokeDashArray:z.array(z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER)).max(256).optional(),
 strokeDashOffset:z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();
export type VectorStrokeOptions=z.infer<typeof vectorStrokeSchema>;
export const vectorStrokeKeys=Object.keys(vectorStrokeSchema.shape) as (keyof VectorStrokeOptions)[];
export function vectorStrokeData(value:VectorStrokeOptions):VectorStrokeOptions{
 return Object.fromEntries(vectorStrokeKeys.filter(key=>value[key]!==undefined).map(key=>[key,Array.isArray(value[key])?[...value[key] as number[]]:value[key]]));
}
/** No parsing in the paint loop; native documents have already been validated. */
export function vectorStrokeValues(value:VectorStrokeOptions){
 return{strokeCap:value.strokeCap??'round',strokeJoin:value.strokeJoin??'round',strokeMiterLimit:value.strokeMiterLimit??4,strokeDashArray:value.strokeDashArray??[],strokeDashOffset:value.strokeDashOffset??0};
}

/** Move-only contours have no stroke; an explicit zero segment/close has caps. */
export function zeroLengthStrokePoint(path:Pick<VectorPathData,'points'|'closed'>):Point|null{
 const first=path.points[0],count=path.points.length;if(!first||(!path.closed&&count<2))return null;
 for(let i=0;i<(path.closed?count:count-1);i++){
  const a=path.points[i],b=path.points[(i+1)%count];
  if([a,a.out,b.in,b].some(p=>p.x!==first.x||p.y!==first.y))return null;
 }
 return{x:first.x,y:first.y};
}
/** Resolve native half-open dash phase; a zero-sized on-dash still has caps. */
export function strokeDashAtOrigin(dashes:readonly number[],offset:number):boolean{
 const count=dashes.length,total=dashes.reduce((sum,value)=>sum+value,0)*(count%2?2:1);if(!total)return true;
 let phase=offset%total;if(phase<0)phase+=total;
 for(let i=0;i<(count%2?count*2:count);i++){
  const length=dashes[i%count];if(phase<length||phase===0&&length===0&&i%2===0)return i%2===0;phase-=length;
 }
 return true;
}
