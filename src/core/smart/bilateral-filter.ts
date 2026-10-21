import {z} from 'zod';

/** Native effect support and quality controls; never an original-image size limit. */
export const bilateralOptionsSchema=z.object({
  radius:z.number().int().min(0).max(16),
  colorSigma:z.number().finite().min(0).max(255),
  amount:z.number().finite().min(0).max(1),
}).strict();
export type BilateralFilterOptions=z.infer<typeof bilateralOptionsSchema>;
export const bilateralFilterSchema=bilateralOptionsSchema.extend({
  id:z.string().min(1).max(240),enabled:z.boolean(),kind:z.literal('bilateral-denoise'),
}).strict();

// One table per process/worker, independent of image dimensions and private to this module.
let cachedRange:{sigma:number;values:Float64Array}|undefined;
let cachedSpatial:{radius:number;values:Float64Array}|undefined;
export function bilateralWeights(radius:number,colorSigma:number) {
  bilateralOptionsSchema.parse({radius,colorSigma,amount:1});
  if(radius===0||colorSigma===0)throw new Error('Inert bilateral settings need no weight tables.');
  if(cachedRange?.sigma!==colorSigma){
    const values=new Float64Array(3*255*255+1),denominator=6*colorSigma*colorSigma;
    values[0]=1;
    for(let distance=1;distance<values.length;distance++)values[distance]=Math.exp(-distance/denominator);
    cachedRange={sigma:colorSigma,values};
  }
  if(cachedSpatial?.radius!==radius){
    const edge=2*radius+1,values=new Float64Array(edge*edge);
    for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)
      values[(y+radius)*edge+x+radius]=Math.exp(-2*(x*x+y*y)/(radius*radius));
    cachedSpatial={radius,values};
  }
  // Callers receive copies; retained native tables cannot be mutated or transferred away.
  return {spatial:cachedSpatial.values.slice(),range:cachedRange.values.slice()};
}
