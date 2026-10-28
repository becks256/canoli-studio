import{gradientMapAdjustmentSchema,packGradientStops,type GradientMapAdjustmentData}from'./gradient-map';
export function compileFloatGradient(input:GradientMapAdjustmentData):{adjustment:GradientMapAdjustmentData;values:number[]}{
 const adjustment=gradientMapAdjustmentSchema.parse(input);return{adjustment,values:packGradientStops(adjustment.stops)};
}
