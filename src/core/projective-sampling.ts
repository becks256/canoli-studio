import {z} from 'zod';
import {ProjectiveTransform, nativeExtent, captureQuad, type ProjectiveQuad} from './projective';
import {validateWindow, type FloatSourceWindow} from './float-source/types';

const rectangle=z.object({x:z.number(),y:z.number(),width:z.number(),height:z.number()}).strict();
const schema=z.object({
  sourceWidth:z.number(),sourceHeight:z.number(),source:rectangle,output:rectangle,
  corners:z.array(z.object({x:z.number().finite(),y:z.number().finite()}).strict()).length(4),
}).strict();
export interface ProjectiveSampleOptions {
  sourceWidth:number;sourceHeight:number;
  source:FloatSourceWindow;output:FloatSourceWindow;
  corners:ProjectiveQuad;
}

/** Capture the complete private wire value before any worker/readiness await.
 * The source rectangle is an actual original-derived ROI, never a thumbnail. */
export function compileProjectiveSample(input:ProjectiveSampleOptions) {
  const options=schema.parse(input);nativeExtent(options.sourceWidth,options.sourceHeight);
  const source=validateWindow(options.source),output=validateWindow(options.output);
  if(source.x<0||source.y<0||source.x+source.width>options.sourceWidth||source.y+source.height>options.sourceHeight)
    throw new Error('Projective source window lies outside the original image.');
  if([output.x,output.y,output.x+output.width-1,output.y+output.height-1].some(v=>v+.5===v||v+.5===v+1))
    throw new Error('Projective pixel centers cannot be resolved at working precision.');
  const quad=captureQuad(options.corners as unknown as ProjectiveQuad);
  // Invert relative geometry before introducing world placement. Otherwise
  // projective cofactors subtract huge translated products near every pixel.
  const inverse=ProjectiveTransform.rectangle(options.sourceWidth,options.sourceHeight,
    quad.map(p=>({x:p.x-quad[0].x,y:p.y-quad[0].y})) as unknown as import('./projective').ProjectiveQuad).inverse();
  return {
    options:{...options,source,output,corners:quad},
    values:new Float64Array([...inverse.values,...quad.flatMap(p=>[p.x,p.y]),options.sourceWidth,options.sourceHeight,
      source.x,source.y,source.width,source.height,output.x,output.y,output.width,output.height]),
  };
}
