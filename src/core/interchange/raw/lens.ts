import {z} from 'zod';
import {lensProfileSelectionSchema} from '../lens/schema';
// Radial output-to-source coordinates; radius 1 is half the smaller image side.
// https://docs.opencv.org/4.6.0/d9/d0c/group__calib3d.html
// Vignetting attenuation uses diagonal-normalized source coordinates, before sampling.
// https://lensfun.github.io/manual/latest/group__Lens.html
const coefficient=z.number().finite().min(-1).max(1).default(0);
export const lensCorrectionSchema=z.object({
  version:z.literal(1).default(1),enabled:z.boolean().default(true),
  center:z.object({x:z.number().finite().min(0).max(1).default(.5),y:z.number().finite().min(0).max(1).default(.5)}).strict().prefault({}),
  scale:z.number().finite().min(.1).max(10).default(1),
  distortion:z.object({k1:coefficient,k2:coefficient,k3:coefficient}).strict().prefault({}),
  chromatic:z.object({red:z.number().finite().min(.5).max(2).default(1),blue:z.number().finite().min(.5).max(2).default(1)}).strict().prefault({}),
  vignette:z.object({k1:coefficient,k2:coefficient,k3:coefficient}).strict().prefault({}),
  profile:lensProfileSelectionSchema.optional(),
}).strict().superRefine((value,context)=>{
  if(value.profile&&(value.center.x!==.5||value.center.y!==.5||value.chromatic.red!==1||value.chromatic.blue!==1||Object.values(value.distortion).some(n=>n!==0)||Object.values(value.vignette).some(n=>n!==0)))
    context.addIssue({code:'custom',message:'A calibrated profile cannot be combined with manual lens coefficients or an overridden optical center.'});
});
export type LensCorrectionOptions=z.input<typeof lensCorrectionSchema>;
export type LensCorrectionData=z.output<typeof lensCorrectionSchema>;
export function hasLensCorrection(value:LensCorrectionData|undefined){
  return !!value?.enabled&&(!!value.profile||value.scale!==1||value.chromatic.red!==1||value.chromatic.blue!==1||Object.values(value.distortion).some(n=>n!==0)||Object.values(value.vignette).some(n=>n!==0));
}
/** Exact extrema of a cubic on a finite interval; sampling cannot miss a fold between grid points. */
function positiveCubic(a:number,b:number,c:number,max:number){
  const points=[0,max],A=3*c,B=2*b,C=a;
  if(A===0){if(B!==0)points.push(-C/B);}else{
    const d=B*B-4*A*C;
    if(d>=0){
      // Avoid subtracting nearly equal values: that can erase an interior extremum
      // when the cubic term is tiny, allowing a fold between positive endpoints.
      const root=Math.sqrt(d),q=-.5*(B+(B<0?-root:root));
      if(q===0)points.push(-B/(2*A));else points.push(q/A,C/q);
    }
  }
  return points.filter(t=>t>=0&&t<=max).every(t=>Number.isFinite(t)&&1+t*(a+t*(b+t*c))>0);
}
export function validateLensGeometry(value:LensCorrectionData,width:number,height:number){
  if(!value.enabled||value.profile)return; // Profile geometry is validated by the actual native model before sensor development.
  const radius2=Math.max(...[0,width].flatMap(x=>[0,height].map(y=>(x-width*value.center.x)**2+(y-height*value.center.y)**2)));
  const radialMax=radius2/(Math.min(width,height)*.5*value.scale)**2;
  const {k1,k2,k3}=value.distortion;
  if(!positiveCubic(3*k1,5*k2,7*k3,radialMax))throw new Error('Lens distortion folds within this image. Reduce coefficients or increase lens scale.');
  const v=value.vignette;
  if(!positiveCubic(v.k1,v.k2,v.k3,radius2/((width*width+height*height)*.25)))throw new Error('Lens vignette attenuation must remain positive throughout this image.');
}
