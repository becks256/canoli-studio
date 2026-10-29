import{z}from'zod';
import{styleSchema,defaultStyle,type LayerStyleData}from'./drawing';
import{srgbToLinear}from'./color/spaces';

export const floatConvolutionSchema=z.object({width:z.number().int().positive().safe(),height:z.number().int().positive().safe(),sigma:z.number().finite().min(0).max(128),axis:z.enum(['horizontal','vertical'])}).strict().superRefine((v,c)=>{
 const radius=Math.ceil(3*v.sigma),edge=v.axis==='horizontal'?v.width:v.height;
 if(!Number.isSafeInteger(v.width*v.height)||v.width*v.height>262144||edge<=2*radius)c.addIssue({code:'custom',message:'Float convolution requires a complete valid halo within the 262144-sample working budget.'});
});
export type FloatConvolutionOptions=z.input<typeof floatConvolutionSchema>;
export function floatConvolutionLength(v:FloatConvolutionOptions){const r=Math.ceil(3*v.sigma);return v.axis==='horizontal'?(v.width-2*r)*v.height:v.width*(v.height-2*r);}
export function validateFloatAlpha(value:unknown,length?:number):asserts value is Float32Array{
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||value.length>262144||length!==undefined&&value.length!==length)throw new Error('Float alpha requires a fixed owned working plane of the expected length.');
 for(const v of value)if(!Number.isFinite(v)||v<0||v>1)throw new Error('Float alpha coverage must be finite and within [0,1].');
}
export function compileFloatShadow(input:LayerStyleData['dropShadow']){
 const value=styleSchema.parse({...defaultStyle(),dropShadow:input}).dropShadow;
 return{...value,radius:Math.ceil(3*value.blur),rgb:[1,3,5].map(at=>Math.fround(srgbToLinear(parseInt(value.color.slice(at,at+2),16)/255)))};
}
