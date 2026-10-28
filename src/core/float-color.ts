import{z}from'zod';
import{hslAdjustmentSchema,colorBalanceAdjustmentSchema,vibranceAdjustmentSchema,type HslAdjustmentData,type ColorBalanceAdjustmentData,type VibranceAdjustmentData,type AdjustmentData}from'./adjustments';

export type FloatColorAdjustment=HslAdjustmentData|ColorBalanceAdjustmentData|VibranceAdjustmentData;
const schema=z.discriminatedUnion('kind',[hslAdjustmentSchema,colorBalanceAdjustmentSchema,vibranceAdjustmentSchema]);
export function isFloatColorAdjustment(value:AdjustmentData):value is FloatColorAdjustment{return value.kind==='hsl'||value.kind==='color-balance'||value.kind==='vibrance';}
export function parseFloatColor(input:FloatColorAdjustment):FloatColorAdjustment{return schema.parse(input);}
/** Private native parameters. Existing controls operate continuously in encoded
 * sRGB; the scene remains linear float32 and alpha is never adjusted. */
export function compileFloatColor(input:FloatColorAdjustment):{kind:0|1|2;values:number[];neutral:boolean}{
 const value=parseFloatColor(input);let kind:0|1|2,values:number[],controls:number;
 if(value.kind==='hsl'){kind=0;values=[value.hue,value.saturation,value.lightness];controls=3;}
 else if(value.kind==='color-balance'){kind=1;values=[...(['shadows','midtones','highlights']as const).flatMap(range=>[value[range].red,value[range].green,value[range].blue]),value.preserveLuminosity?1:0];controls=9;}
 else{kind=2;values=[value.vibrance,value.saturation];controls=2;}
 return{kind,values,neutral:values.slice(0,controls).every(v=>v===0)};
}
