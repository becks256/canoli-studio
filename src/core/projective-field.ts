import {z} from 'zod';
import {compileProjectiveSample} from './projective-sampling';
import type {ProjectiveQuad} from './projective';
import {validateWindow,type FloatSourceWindow} from './float-source/types';

const integer=z.number().int().safe(),extent=integer.positive();
const rectangle=z.object({x:integer,y:integer,width:extent,height:extent}).strict();
const schema=z.object({
  sourceWidth:extent,sourceHeight:extent,corners:z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).length(4),
  field:rectangle,source:rectangle,output:rectangle,background:z.number().finite().min(0).max(1),
}).strict();

/** Finite scalar deviations from a constant infinite background. Reference
 * geometry defines the homography, not a clip or clamp boundary for the field. */
export interface ProjectiveFieldOptions {
  sourceWidth:number;sourceHeight:number;corners:ProjectiveQuad;
  field:FloatSourceWindow;source:FloatSourceWindow;output:FloatSourceWindow;background:number;
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
  return {options:{...options,field,source,output,corners},values:new Float64Array([
    ...frame.values.subarray(0,9),corners[0].x,corners[0].y,
    field.x,field.y,field.width,field.height,source.x,source.y,source.width,source.height,
    output.x,output.y,output.width,output.height,options.background,
  ])};
}
