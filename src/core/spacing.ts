import type {AffineBounds} from './affine';

export type SpacingAxis='x'|'y';
export interface SpacingGuide {axis:SpacingAxis;from:number;to:number;at:number;gap:number;equal:boolean}
export interface SpacingMatch {axis:SpacingAxis;position:number;before:AffineBounds;after:AffineBounds;reference?:[AffineBounds,AffineBounds]}
const start=(r:AffineBounds,a:SpacingAxis)=>r[a];
const size=(r:AffineBounds,a:SpacingAxis)=>a==='x'?r.width:r.height;
const end=(r:AffineBounds,a:SpacingAxis)=>start(r,a)+size(r,a);
const other=(a:SpacingAxis):SpacingAxis=>a==='x'?'y':'x';
const valid=(r:AffineBounds)=>[r.x,r.y,r.width,r.height,r.x+r.width,r.y+r.height].every(Number.isFinite)&&r.width>0&&r.height>0;
const epsilon=(rects:readonly AffineBounds[])=>Math.max(1e-7,...rects.flatMap(r=>[Math.abs(r.x),Math.abs(r.y),r.width,r.height].map(n=>Number.EPSILON*n*8)));
const common=(rects:readonly AffineBounds[],axis:SpacingAxis)=>{
 const a=other(axis),low=Math.max(...rects.map(r=>start(r,a))),high=Math.min(...rects.map(r=>end(r,a)));
 return high-low>epsilon(rects)?(low+high)/2:undefined;
};
function neighbors(moving:AffineBounds,artwork:readonly AffineBounds[],axis:SpacingAxis,tolerance=0){
 const targets=artwork.filter(r=>valid(r)&&common([moving,r],axis)!==undefined),before=targets.filter(r=>end(r,axis)<=start(moving,axis)+tolerance).sort((a,b)=>end(b,axis)-end(a,axis)||start(b,axis)-start(a,axis)||start(a,other(axis))-start(b,other(axis))),after=targets.filter(r=>start(r,axis)>=end(moving,axis)-tolerance).sort((a,b)=>start(a,axis)-start(b,axis)||end(a,axis)-end(b,axis)||start(a,other(axis))-start(b,other(axis)));
 return{targets,before:before[0],after:after[0]};
}
function guide(before:AffineBounds,after:AffineBounds,axis:SpacingAxis,equal=false,at=common([before,after],axis)):SpacingGuide|undefined{
 const from=end(before,axis),to=start(after,axis),gap=to-from;
 if(at===undefined||!Number.isFinite(gap)||gap<=epsilon([before,after]))return;
 return{axis,from,to,at,gap,equal};
}
/** Four nearest, nonoverlapping geometric gaps plus eligible repeated-gap references at the final authored placement.
 * Hidden/moving/ancestor filtering belongs to artworkSnapBounds, not this numeric helper. */
export function measureSpacing(moving:AffineBounds,artwork:readonly AffineBounds[],matches:readonly SpacingMatch[]=[]):SpacingGuide[]{
 if(!valid(moving))return[];
 const guides:SpacingGuide[]=[];
 for(const axis of ['x','y']as const){
  const{before,after}=neighbors(moving,artwork,axis),left=before&&guide(before,moving,axis),right=after&&guide(moving,after,axis);
  if(left&&right&&Math.abs(left.gap-right.gap)<=epsilon([moving,before!,after!]))left.equal=right.equal=true;
  if(left)guides.push(left);if(right)guides.push(right);
 }
 for(const match of matches){
  const{axis,before,after,reference}=match,at=common([moving,before,after,...(reference??[])],axis);
  if(at===undefined||Math.abs(start(moving,axis)-match.position)>epsilon([moving,before,after]))continue;
  const pairs: [AffineBounds,AffineBounds][]=reference?[reference,match.position>=end(before,axis)?[before,moving]:[moving,after]]:[[before,moving],[moving,after]];
  const equal=pairs.map(([a,b])=>guide(a,b,axis,true,at));
  if(equal.some(g=>!g)||Math.abs(equal[0]!.gap-equal[1]!.gap)>epsilon([moving,before,after,...(reference??[])]))continue;
  for(const item of equal as SpacingGuide[]){const previous=guides.find(g=>g.axis===item.axis&&Math.abs(g.from-item.from)<1e-7&&Math.abs(g.to-item.to)<1e-7);if(previous){previous.equal=true;previous.at=item.at;}else guides.push(item);}
 }
 return guides;
}
function candidate(moving:AffineBounds,artwork:readonly AffineBounds[],axis:SpacingAxis,tolerance:number):SpacingMatch|undefined{
 const{targets,before,after}=neighbors(moving,artwork,axis,tolerance),choices:SpacingMatch[]=[],width=size(moving,axis);
 if(before&&after&&before!==after&&common([moving,before,after],axis)!==undefined){const gap=(start(after,axis)-end(before,axis)-width)/2;if(gap>epsilon([moving,before,after]))choices.push({axis,position:end(before,axis)+gap,before,after});}
 if(before){
  const previous=targets.filter(r=>r!==before&&end(r,axis)<start(before,axis)&&common([moving,before,r],axis)!==undefined).sort((a,b)=>end(b,axis)-end(a,axis)||start(b,axis)-start(a,axis))[0];
  if(previous){const gap=start(before,axis)-end(previous,axis);if(gap>epsilon([moving,before,previous]))choices.push({axis,position:end(before,axis)+gap,before,after:before,reference:[previous,before]});}
 }
 if(after){
  const next=targets.filter(r=>r!==after&&start(r,axis)>end(after,axis)&&common([moving,after,r],axis)!==undefined).sort((a,b)=>start(a,axis)-start(b,axis)||end(a,axis)-end(b,axis))[0];
  if(next){const gap=start(next,axis)-end(after,axis);if(gap>epsilon([moving,after,next]))choices.push({axis,position:start(after,axis)-gap-width,before:after,after,reference:[after,next]});}
 }
 return choices.filter(c=>Number.isFinite(c.position)&&Math.abs(c.position-start(moving,axis))<=tolerance&&epsilon([moving,c.before,c.after,...(c.reference??[])])<=Math.max(1e-7,tolerance)).sort((a,b)=>Math.abs(a.position-start(moving,axis))-Math.abs(b.position-start(moving,axis)))[0];
}
/** Equal gaps compete with existing edge/center/guide attraction. Existing anchors
 * win equal-distance ties. Tolerance is in document pixels (the UI uses 6/zoom). */
export function snapToSpacing(bounds:AffineBounds,delta:{x:number;y:number},anchored:{x:number;y:number;guides:{x?:number;y?:number}},artwork:readonly AffineBounds[],tolerance:number){
 const result={x:anchored.x,y:anchored.y,guides:{...anchored.guides},matches:[]as SpacingMatch[]};
 if(!valid(bounds)||!Number.isFinite(tolerance)||tolerance<0||![delta.x,delta.y,anchored.x,anchored.y].every(Number.isFinite))return result;
 const moving=()=>({...bounds,x:bounds.x+result.x,y:bounds.y+result.y});
 for(const axis of ['x','y']as const){const frame=moving();frame[axis]=bounds[axis]+delta[axis];const match=candidate(frame,artwork,axis,tolerance);if(!match)continue;
  const shift=match.position-bounds[axis],distance=Math.abs(shift-delta[axis]),anchorDistance=Math.abs(anchored[axis]-delta[axis]);
  if(anchored.guides[axis]!==undefined&&distance>=anchorDistance-1e-7)continue;
  result[axis]=shift;delete result.guides[axis];result.matches.push(match);
 }
 // Both axes must still share an orthogonal band after the final correction.
 // Fall back together rather than publish attraction to departed neighbors.
 const final=moving();if(result.matches.some(m=>common([final,m.before,m.after,...(m.reference??[])],m.axis)===undefined))return{x:anchored.x,y:anchored.y,guides:{...anchored.guides},matches:[]as SpacingMatch[]};
 return result;
}
