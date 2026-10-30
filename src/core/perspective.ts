import {z} from 'zod';
import {AffineTransform,type AffineBounds,type AffinePoint} from './affine';
import {ProjectiveTransform,type ProjectiveQuad} from './projective';

export interface PerspectiveData {corners:ProjectiveQuad}
export const IDENTITY_PERSPECTIVE:ProjectiveQuad=Object.freeze([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(Object.freeze)) as unknown as ProjectiveQuad;
export const perspectiveSchema=z.object({corners:z.tuple([
  z.object({x:z.number().finite(),y:z.number().finite()}).strict(),z.object({x:z.number().finite(),y:z.number().finite()}).strict(),
  z.object({x:z.number().finite(),y:z.number().finite()}).strict(),z.object({x:z.number().finite(),y:z.number().finite()}).strict(),
])}).strict().superRefine((value,context)=>{try{ProjectiveTransform.rectangle(1,1,value.corners);}catch(error){context.addIssue({code:'custom',message:error instanceof Error?error.message:String(error)});}});
export function activePerspective(value:PerspectiveData|null|undefined):value is PerspectiveData {
  return !!value&&value.corners.some((p,i)=>p.x!==IDENTITY_PERSPECTIVE[i].x||p.y!==IDENTITY_PERSPECTIVE[i].y);
}
export function perspectiveLocalQuad(width:number,height:number,value:PerspectiveData):ProjectiveQuad {
  const corners=value.corners.map(p=>({x:p.x*width,y:p.y*height}));
  if(corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('Perspective corners must remain finite at the layer dimensions.');
  return corners as unknown as ProjectiveQuad;
}
export function perspectiveMatrix(width:number,height:number,value:PerspectiveData){
  if(![width,height].every(v=>Number.isFinite(v)&&v>0))throw new Error('Perspective requires positive finite layer dimensions.');
  return ProjectiveTransform.fromAffine(AffineTransform.scale(width,height)).multiply(ProjectiveTransform.rectangle(1,1,value.corners)).multiply(ProjectiveTransform.fromAffine(AffineTransform.scale(1/width,1/height)));
}
export function perspectiveRect(matrix:ProjectiveTransform,rect:AffineBounds):{corners:ProjectiveQuad;bounds:AffineBounds}{
  const points=[{x:rect.x,y:rect.y},{x:rect.x+rect.width,y:rect.y},{x:rect.x+rect.width,y:rect.y+rect.height},{x:rect.x,y:rect.y+rect.height}];
  const m=matrix.values,weights=points.map(p=>m[6]*p.x+m[7]*p.y+m[8]);
  if(weights.some(w=>!Number.isFinite(w)||w===0)||weights.some(w=>Math.sign(w)!==Math.sign(weights[0])))throw new Error('Perspective crosses a horizon in the artwork. Adjust the corners to keep the complete content finite.');
  const corners=points.map(p=>matrix.point(p)) as unknown as ProjectiveQuad,left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
  return{corners,bounds:{x:left,y:top,width:Math.max(...corners.map(p=>p.x))-left,height:Math.max(...corners.map(p=>p.y))-top}};
}
export function perspectivePoint(layer:{width:number;height:number;perspective?:PerspectiveData|null},point:AffinePoint,inverse=false){
  if(!activePerspective(layer.perspective))return {...point};
  const matrix=perspectiveMatrix(layer.width,layer.height,layer.perspective);return(inverse?matrix.inverse():matrix).point(point);
}
