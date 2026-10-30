import{z}from'zod';
import{styleSchema,defaultStyle,type LayerStyleData}from'./drawing';
import{srgbToLinear}from'./color/spaces';

const convolutionGeometry={width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),axis:z.enum(['horizontal','vertical'])};
export const floatConvolutionSchema=z.union([
 z.object({...convolutionGeometry,kernel:z.literal('gaussian').optional(),sigma:z.number().finite().min(0).max(128)}).strict(),
 z.object({...convolutionGeometry,kernel:z.literal('box'),radius:z.number().finite().min(0).max(128)}).strict(),
]).superRefine((v,c)=>{
 const radius=floatConvolutionRadius(v),edge=v.axis==='horizontal'?v.width:v.height;
 if(!Number.isSafeInteger(v.width*v.height)||v.width*v.height>262144||edge<=2*radius)c.addIssue({code:'custom',message:'Float convolution requires a complete valid halo within the 262144-sample working budget.'});
});
export type FloatConvolutionOptions=z.input<typeof floatConvolutionSchema>;
export function floatConvolutionRadius(v:FloatConvolutionOptions){return Math.ceil(v.kernel==='box'?v.radius:3*v.sigma);}
export function floatConvolutionLength(v:FloatConvolutionOptions){const r=floatConvolutionRadius(v);return v.axis==='horizontal'?(v.width-2*r)*v.height:v.width*(v.height-2*r);}
/** Same fractional edge weights as the established three-pass mask feather. */
export function fractionalBoxWeights(radius:number){
 const r=Math.ceil(radius),fraction=radius-Math.floor(radius),divisor=2*Math.floor(radius)+1+2*fraction;
 const weights=new Float64Array(2*r+1).fill(1/divisor);
 if(fraction!==0)weights[0]=weights[weights.length-1]=fraction/divisor;
 return weights;
}
export function validateFloatAlpha(value:unknown,length?:number):asserts value is Float32Array{
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||value.length>262144||length!==undefined&&value.length!==length)throw new Error('Float alpha requires a fixed owned working plane of the expected length.');
 for(const v of value)if(!Number.isFinite(v)||v<0||v>1)throw new Error('Float alpha coverage must be finite and within [0,1].');
}
export function compileFloatShadow(input:LayerStyleData['dropShadow']){
 const value=styleSchema.parse({...defaultStyle(),dropShadow:input}).dropShadow;
 return{...value,radius:Math.ceil(3*value.blur),rgb:[1,3,5].map(at=>Math.fround(srgbToLinear(parseInt(value.color.slice(at,at+2),16)/255)))};
}
