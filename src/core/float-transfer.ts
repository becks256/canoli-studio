import{curvePointsSchema,curvesAdjustmentSchema,levelsAdjustmentSchema,type CurvePoint,type CurvesAdjustmentData,type LevelsAdjustmentData,type LevelChannelData}from'./adjustments';
export type FloatTransferAdjustment=CurvesAdjustmentData|LevelsAdjustmentData;
export const FLOAT_TRANSFER_STRIDE=100;
export const FLOAT_TRANSFER_VALUES=400;
export function parseFloatTransfer(value:unknown):FloatTransferAdjustment{
 if(value&&typeof value==='object'&&'kind'in value&&value.kind==='curves')return curvesAdjustmentSchema.parse(value);
 return levelsAdjustmentSchema.parse(value);
}
/** Continuous, sign-safe Hermite control data. No 256-entry color lookup. */
export function compileFloatCurve(points:readonly CurvePoint[]):Float64Array{
 points=curvePointsSchema.parse(points);const n=points.length,out=new Float64Array(FLOAT_TRANSFER_STRIDE);
 if(points.every(p=>p.x===p.y))return out;
 out[0]=1;out[1]=n;const slopes:number[]=[],tangents:number[]=[];
 for(let i=0;i<n;i++){out[2+i*3]=points[i].x/255;out[3+i*3]=points[i].y/255;}
 for(let i=0;i<n-1;i++){
  const dx=out[2+(i+1)*3]-out[2+i*3];if(!(dx>0))throw new Error('Float curve knots exceed coordinate precision.');
  slopes[i]=(out[3+(i+1)*3]-out[3+i*3])/dx;if(!Number.isFinite(slopes[i]))throw new Error('Float curve slope is not finite.');
 }
 tangents[0]=slopes[0];tangents[n-1]=slopes[n-2];for(let i=1;i<n-1;i++)tangents[i]=slopes[i-1]/2+slopes[i]/2;
 for(let i=0;i<n-1;i++){
  const slope=slopes[i];if(slope===0){tangents[i]=tangents[i+1]=0;continue;}
  if(tangents[i]/slope<0)tangents[i]=0;if(tangents[i+1]/slope<0)tangents[i+1]=0;
  const a=tangents[i]/slope,b=tangents[i+1]/slope,distance=Math.hypot(a,b);
  if(distance>3){const scale=3/distance;tangents[i]=scale*a*slope;tangents[i+1]=scale*b*slope;}
 }
 for(let i=0;i<n;i++){if(!Number.isFinite(tangents[i]))throw new Error('Float curve tangent is not finite.');out[4+i*3]=tangents[i];}return out;
}
/** UI-only curve graph sampler; native pixel work consumes the same control data. */
export function sampleFloatCurve(table:Float64Array,value:number):number{
 if(table[0]===0)return value;const n=table[1],last=2+(n-1)*3;
 if(value<=table[2])return table[3]+(value-table[2])*table[4];
 if(value>=table[last])return table[last+1]+(value-table[last])*table[last+2];
 let i=0;while(i<n-2&&table[2+(i+1)*3]<value)i++;const p=2+i*3,h=table[p+3]-table[p],t=(value-table[p])/h,t2=t*t,t3=t2*t;
 return(2*t3-3*t2+1)*table[p+1]+(t3-2*t2+t)*h*table[p+2]+(-2*t3+3*t2)*table[p+4]+(t3-t2)*h*table[p+5];
}
function compileLevels(value:LevelChannelData):Float64Array{
 const out=new Float64Array(FLOAT_TRANSFER_STRIDE),{inputBlack,inputWhite,gamma,outputBlack,outputWhite}=value;
 if(inputBlack===0&&inputWhite===255&&gamma===1&&outputBlack===0&&outputWhite===255)return out;
 out[0]=2;out[2]=inputBlack/255;out[3]=(inputWhite-inputBlack)/255;out[4]=1/gamma;out[5]=outputBlack/255;out[6]=(outputWhite-outputBlack)/255;
 if(!(out[3]>0)||!out.every(Number.isFinite))throw new Error('Float levels exceed coordinate precision.');return out;
}
export function compileFloatTransfer(input:unknown):{adjustment:FloatTransferAdjustment;values:Float64Array}{
 const adjustment=parseFloatTransfer(input),values=new Float64Array(FLOAT_TRANSFER_VALUES);
 for(const[index,key]of(['rgb','red','green','blue']as const).entries()){
  const value=adjustment[key];if(!value)continue;
  const table=adjustment.kind==='curves'?compileFloatCurve(value as CurvePoint[]):compileLevels(value as LevelChannelData);values.set(table,index*FLOAT_TRANSFER_STRIDE);
 }
 return{adjustment,values};
}
