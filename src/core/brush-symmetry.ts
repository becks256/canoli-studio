import {z} from 'zod';
import {isImmutable} from './immutable';
import {AffineTransform,type AffineData,type AffineBounds} from './affine';
import {affineSchema} from './transform-schema';

/** Original ink is implicit; copies carry full affine geometry in the stroke plane. */
export interface BrushSymmetryData {copies:AffineData[]}
const identity=(m:AffineData)=>m.a===1&&m.b===0&&m.c===0&&m.d===1&&m.e===0&&m.f===0;
export const brushSymmetrySchema:z.ZodType<BrushSymmetryData>=z.object({copies:z.array(affineSchema).min(1).max(31)}).strict().superRefine((value,context)=>{
 if(value.copies.some(identity))context.addIssue({code:'custom',message:'The original symmetry copy is implicit; explicit identity copies are invalid.'});
 if(new Set(value.copies.map(m=>JSON.stringify([m.a,m.b,m.c,m.d,m.e,m.f]))).size!==value.copies.length)context.addIssue({code:'custom',message:'Symmetry copies must be distinct.'});
});
const original=Object.freeze([new AffineTransform()]);
const matrices=new WeakMap<BrushSymmetryData,readonly AffineTransform[]>();
export function symmetryMatrices(data?:BrushSymmetryData):readonly AffineTransform[]{if(!data)return original;const cached=matrices.get(data);if(cached)return cached;const result=Object.freeze([original[0],...data.copies.map(AffineTransform.fromJSON)]);if(isImmutable(data))matrices.set(data,result);return result;}
export function symmetryBounds(bounds:AffineBounds,data?:BrushSymmetryData):AffineBounds{
 if(!data)return bounds;
 let left=bounds.x,top=bounds.y,right=bounds.x+bounds.width,bottom=bounds.y+bounds.height;
 for(const matrix of data.copies){const box=AffineTransform.fromJSON(matrix).bounds(bounds);left=Math.min(left,box.x);top=Math.min(top,box.y);right=Math.max(right,box.x+box.width);bottom=Math.max(bottom,box.y+box.height);}
 if(![left,top,right,bottom,right-left,bottom-top].every(Number.isFinite))throw new Error('Symmetry support exceeds numeric precision.');
 return{x:left,y:top,width:right-left,height:bottom-top};
}
