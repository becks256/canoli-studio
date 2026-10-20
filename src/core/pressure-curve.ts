import {z} from 'zod';

export interface PressureKnot {input:number;output:number}
export interface PressureCurveData {points:PressureKnot[]}
const unit=z.number().finite().min(0).max(1);
export const pressureCurveSchema:z.ZodType<PressureCurveData>=z.object({points:z.array(z.object({input:unit,output:unit}).strict()).min(2).max(16)}).strict().superRefine((curve,context)=>{
 if(curve.points.length<2)return;
 if(curve.points[0].input!==0||curve.points.at(-1)!.input!==1)context.addIssue({code:'custom',message:'Pressure curve input must begin at 0 and end at 1.'});
 for(let i=1;i<curve.points.length;i++){
  if(curve.points[i].input<=curve.points[i-1].input)context.addIssue({code:'custom',message:'Pressure inputs must increase strictly.'});
  if(curve.points[i].output<curve.points[i-1].output)context.addIssue({code:'custom',message:'Pressure output must not decrease.'});
 }
});

/** Evaluate authored knots after recorded pressure interpolation; never rewrite retained
 * pressure samples. Absent curves preserve the legacy response exactly. */
export function pressureResponse(pressure:number,curve?:PressureCurveData):number{
 if(!curve)return pressure;
 const value=Math.max(0,Math.min(1,pressure)),points=curve.points;
 let low=0,high=points.length-1;
 while(high-low>1){const middle=(low+high)>>>1;if(points[middle].input<=value)low=middle;else high=middle;}
 const a=points[low],b=points[high],t=(value-a.input)/(b.input-a.input);
 return a.output+(b.output-a.output)*t;
}

export function pressureSizeResponse(pressure:number,curve?:PressureCurveData):number{
 return curve?pressureResponse(pressure,curve):Math.max(.05,pressure);
}
export function pressureOpacityResponse(pressure:number,curve?:PressureCurveData):number{
 return curve?pressureResponse(pressure,curve):Math.max(.01,pressure);
}

export const PRESSURE_CURVE_PRESETS={
 linear:{points:[{input:0,output:0},{input:1,output:1}]},
 soft:{points:[{input:0,output:0},{input:.25,output:.5},{input:.5,output:.75},{input:.75,output:.9},{input:1,output:1}]},
 firm:{points:[{input:0,output:0},{input:.25,output:.1},{input:.5,output:.25},{input:.75,output:.5},{input:1,output:1}]},
} satisfies Record<string,PressureCurveData>;
