import {z} from 'zod';
import {compileProjectiveSample} from './projective-sampling';
import {ProjectiveTransform,type ProjectiveQuad} from './projective';
import {AffineTransform,type AffineData} from './affine';
import {affineSchema} from './transform-schema';
import {validateWindow,type FloatSourceWindow} from './float-source/types';

const integer=z.number().int().safe(),extent=integer.positive();
const rectangle=z.object({x:integer,y:integer,width:extent,height:extent}).strict();
export const fieldInputSchema=z.object({origin:z.object({x:z.number().finite(),y:z.number().finite()}).strict(),matrix:affineSchema}).strict();
export interface ProjectiveFieldInput {origin:{x:number;y:number};matrix:AffineData}
const schema=z.object({
  sourceWidth:extent,sourceHeight:extent,corners:z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).length(4),
  field:rectangle,source:rectangle,output:rectangle,background:z.number().finite().min(0).max(1),
  direction:z.enum(['quad-to-source','source-to-quad']).optional(),
  input:fieldInputSchema.optional(),
}).strict();

/** Finite scalar deviations from a constant infinite background. Reference
 * geometry defines the homography, not a clip or clamp boundary for the field. */
export type ProjectiveFieldDirection='quad-to-source'|'source-to-quad';
export interface ProjectiveFieldOptions {
  sourceWidth:number;sourceHeight:number;corners:ProjectiveQuad;direction?:ProjectiveFieldDirection;
  field:FloatSourceWindow;source:FloatSourceWindow;output:FloatSourceWindow;background:number;
  input?:ProjectiveFieldInput;
}

export function captureFieldBounds(input:FloatSourceWindow):FloatSourceWindow {
  const value=rectangle.parse(input);
  if(!Number.isSafeInteger(value.x+value.width)||!Number.isSafeInteger(value.y+value.height)||
    [value.x,value.y,value.x+value.width-1,value.y+value.height-1].some(v=>v+.5===v||v+.5===v+1))
    throw new Error('Projective field pixel centers cannot be resolved at working precision.');
  return value;
}

export function compileProjectiveField(input:ProjectiveFieldOptions) {
  const options=schema.parse(input),field=captureFieldBounds(options.field),source=validateWindow(options.source),output=validateWindow(options.output);
  if(source.x<field.x||source.y<field.y||source.x+source.width>field.x+field.width||source.y+source.height>field.y+field.height)
    throw new Error('Projective field source window lies outside the finite field.');
  const frame=compileProjectiveSample({sourceWidth:options.sourceWidth,sourceHeight:options.sourceHeight,
    source:{x:0,y:0,width:1,height:1},output,corners:options.corners as unknown as ProjectiveQuad});
  const corners=frame.options.corners;
  let inputOrigin={...corners[0]},sourceOrigin={x:0,y:0},matrix=frame.values.subarray(0,9);
  if(options.direction==='source-to-quad'){
    // Pull coverage from the placed/brush plane onto the original reference
    // lattice. Keep both coordinate origins separate: a large placement must
    // not enter matrix cofactors or erase subpixel interpolation precision.
    inputOrigin={x:0,y:0};sourceOrigin={x:Math.floor(field.x+field.width/2),y:Math.floor(field.y+field.height/2)};
    const forward=ProjectiveTransform.rectangle(options.sourceWidth,options.sourceHeight,corners.map(p=>({x:p.x-corners[0].x,y:p.y-corners[0].y})) as unknown as ProjectiveQuad);
    matrix=Float64Array.from(ProjectiveTransform.fromAffine(AffineTransform.translation(corners[0].x-sourceOrigin.x,corners[0].y-sourceOrigin.y)).multiply(forward).values);
  }
  if(options.input){
    if(options.direction!=='source-to-quad')throw new Error('Field input mapping requires source-to-quad sampling.');
    const input=AffineTransform.fromJSON(options.input.matrix);input.inverse();inputOrigin={...options.input.origin};
    matrix=Float64Array.from(new ProjectiveTransform(Array.from(matrix)).multiply(ProjectiveTransform.fromAffine(input)).values);
  }
  const localField=captureFieldBounds({...field,x:field.x-sourceOrigin.x,y:field.y-sourceOrigin.y}),localSource=validateWindow({...source,x:source.x-sourceOrigin.x,y:source.y-sourceOrigin.y});
  return {inputOrigin,sourceOrigin,options:{...options,field,source,output,corners},values:new Float64Array([
    ...matrix,inputOrigin.x,inputOrigin.y,
    localField.x,localField.y,localField.width,localField.height,localSource.x,localSource.y,localSource.width,localSource.height,
    output.x,output.y,output.width,output.height,options.background,
  ])};
}
