import type { Point, SelectionData } from './drawing';
import { z } from 'zod';

/** Document-space vertices; bounded by the same capture budget as freeform lasso. */
export const polygonSelectionSchema = z.object({
  points: z.array(z.object({
    x: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
    y: z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  }).strict()).min(3).max(20000),
  operation: z.enum(['replace', 'add', 'subtract', 'intersect']).default('replace'),
}).strict();

/** Even-odd 4×4 scan conversion; emit coverage spans without visiting interior pixels. */
export function lassoSelection(points: Point[], documentWidth: number, documentHeight: number): SelectionData {
  if (points.length < 3) return { regions: [] };
  const left=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x))));
  const top=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y))));
  const right=Math.min(documentWidth,Math.ceil(Math.max(...points.map(p=>p.x))));
  const bottom=Math.min(documentHeight,Math.ceil(Math.max(...points.map(p=>p.y))));
  const width=right-left,height=bottom-top;
  if(width<=0||height<=0)return {regions:[]};
  // Enter each edge only on scanlines crossing its vertical extent. Preserve
  // original endpoint order for identical floating-point intersection results.
  const edges: {a:Point;b:Point;low:number;high:number}[]=[];
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i];
    if(a.y!==b.y)edges.push({a,b,low:Math.min(a.y,b.y),high:Math.max(a.y,b.y)});
  }
  edges.sort((a,b)=>a.low-b.low);
  const active=new Set<(typeof edges)[number]>();
  let nextEdge=0;
  const runs:number[]=[];
  let previous=-1,index=0,nonempty=false;
  for(let y=top;y<bottom;y++){
    const events=new Map<number,number>([[0,0],[width,0]]);
    const addSpan=(start:number,end:number,coverage:number)=>{
      if(start>=end)return;
      events.set(start,(events.get(start)??0)+coverage);
      events.set(end,(events.get(end)??0)-coverage);
    };
    for(let subY=0;subY<4;subY++){
      const sample=y+(subY+0.5)/4,intersections:number[]=[];
      while(nextEdge<edges.length&&edges[nextEdge].low<=sample){
        const edge=edges[nextEdge++];
        if(edge.high>sample)active.add(edge);
      }
      for(const edge of active){
        if(edge.high<=sample){active.delete(edge);continue;}
        const {a,b}=edge;
        intersections.push(a.x+(sample-a.y)*(b.x-a.x)/(b.y-a.y));
      }
      intersections.sort((a,b)=>a-b);
      for(let i=0;i+1<intersections.length;i+=2){
        const start=Math.max(0,Math.ceil((intersections[i]-left)*4-0.5));
        const end=Math.min(width*4,Math.ceil((intersections[i+1]-left)*4-0.5));
        if(start>=end)continue;
        const first=Math.floor(start/4),last=Math.floor((end-1)/4);
        if(first===last)addSpan(first,first+1,end-start);
        else {
          addSpan(first,first+1,4-start%4);
          addSpan(first+1,last,4);
          addSpan(last,last+1,end-last*4);
        }
      }
    }
    const boundaries=[...events.keys()].sort((a,b)=>a-b);
    let count=0;
    for(let i=0;i+1<boundaries.length;i++){
      count+=events.get(boundaries[i])!;
      const alpha=Math.round(count*255/16);nonempty ||= alpha>0;
      if(alpha!==previous){if(index)runs.push(index,previous);previous=alpha;}
      index+=boundaries[i+1]-boundaries[i];
    }
  }
  if(!nonempty)return {regions:[]};
  runs.push(index,previous);
  return {regions:[{shape:'pixels',operation:'add',x:left,y:top,width,height,coverage:{width,height,runs}}]};
}
