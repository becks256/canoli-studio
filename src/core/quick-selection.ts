import { z } from 'zod';
import { colorRangeSourceSchema } from './color-range';
import type { SelectionModificationControl } from './selection-modification';
const coordinate=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const quickSelectionOptionsSchema=z.object({
  points:z.array(z.object({x:coordinate,y:coordinate}).strict()).min(1).max(20000),
  size:z.number().finite().min(0.5).max(512).default(32),
  tolerance:z.number().finite().min(0).max(255).default(32),
  edgeThreshold:z.number().finite().min(0).max(255).default(64),
  operation:z.enum(['replace','add','subtract','intersect']).default('add'),
  source:colorRangeSourceSchema.default({kind:'merged'}),
}).strict();
export type QuickSelectionOptions=z.input<typeof quickSelectionOptionsSchema>;
export type QuickSelectionSettings=z.output<typeof quickSelectionOptionsSchema>;
export type QuickSelectionControl=SelectionModificationControl;
export const quickSelectionRequestSchema=quickSelectionOptionsSchema.extend({
  x:coordinate,y:coordinate,width:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),height:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type QuickSelectionRequest=z.output<typeof quickSelectionRequestSchema>;

/** Circular dabs with <=radius/4 spacing, clipped before interpolation. */
export function quickSelectionSeeds(request:QuickSelectionRequest):Uint32Array{
  const {width,height,size,points,x:originX,y:originY}=request,radius=size/2;
  const rows=new Map<number,number[]>();
  const add=(row:number,left:number,right:number)=>{left=Math.max(0,left);right=Math.min(width,right);if(left>=right||row<0||row>=height)return;const spans=rows.get(row)??[];spans.push(left,right);rows.set(row,spans);};
  const dab=(x:number,y:number)=>{
    const top=Math.max(0,Math.ceil(y-radius-.5)),bottom=Math.min(height-1,Math.floor(y+radius-.5));
    for(let row=top;row<=bottom;row++){const half=Math.sqrt(Math.max(0,radius*radius-(row+.5-y)**2));add(row,Math.ceil(x-half-.5),Math.floor(x+half-.5)+1);}
    add(Math.floor(y),Math.floor(x),Math.floor(x)+1);
  };
  let previous:{x:number;y:number}|undefined;
  for(const point of points){
    const next={x:point.x-originX,y:point.y-originY};
    if(!previous){dab(next.x,next.y);previous=next;continue;}
    const dx=next.x-previous.x,dy=next.y-previous.y;let low=0,high=1,visible=true;
    for(const [p,q] of [[-dx,previous.x+radius],[dx,width+radius-previous.x],[-dy,previous.y+radius],[dy,height+radius-previous.y]]){if(p===0){if(q<0)visible=false;continue;}const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);}
    if(visible&&low<=high){const steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)*(high-low)/Math.max(.25,radius/4)));for(let i=0;i<=steps;i++){const t=low+(high-low)*i/steps;dab(previous.x+dx*t,previous.y+dy*t);}}
    previous=next;
  }
  const packed:number[]=[];
  for(const [row,spans] of [...rows].sort((a,b)=>a[0]-b[0])){
    const pairs=Array.from({length:spans.length/2},(_,i)=>[spans[i*2],spans[i*2+1]]).sort((a,b)=>a[0]-b[0]);let left=-1,right=-1;
    for(const [a,b] of pairs){if(a<=right)right=Math.max(right,b);else{if(left>=0)packed.push(row*width+left,row*width+right);left=a;right=b;}}
    if(left>=0)packed.push(row*width+left,row*width+right);
  }
  return new Uint32Array(packed);
}
