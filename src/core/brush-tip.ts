import { z } from 'zod';
import { pressureCurveSchema, pressureResponse, type PressureCurveData } from './pressure-curve';
import type { AffineTransform } from './affine';

export interface PenTiltData { altitude: number; azimuth: number; }
export const penTiltSchema: z.ZodType<PenTiltData> = z.object({
  altitude:z.number().finite().min(0).max(Math.PI/2),
  azimuth:z.number().finite().min(0).max(2*Math.PI),
}).strict();
export interface BrushTipData {
  roundness:number; angle:number;
  tiltAngle?:boolean; tiltRoundness?:boolean; tiltCurve?:PressureCurveData;
}
export const brushTipSchema:z.ZodType<BrushTipData> = z.object({
  roundness:z.number().finite().min(0.01).max(1), angle:z.number().finite().min(-180).max(180),
  tiltAngle:z.boolean().optional(), tiltRoundness:z.boolean().optional(), tiltCurve:pressureCurveSchema.optional(),
}).strict();
export const uprightTilt:Readonly<PenTiltData> = Object.freeze({altitude:Math.PI/2,azimuth:0});
const turn=2*Math.PI;
export function normalizeAzimuth(value:number):number { const wrapped=((value%turn)+turn)%turn;return wrapped===0?0:wrapped; }

/** W3C tilt projection. Horizontal non-axis pairs cannot determine azimuth. */
export function pointerPenTilt(event:{tiltX?:number;tiltY?:number;altitudeAngle?:number;azimuthAngle?:number}):PenTiltData {
  const x=Number.isFinite(event.tiltX)?Math.max(-90,Math.min(90,event.tiltX!)):0;
  const y=Number.isFinite(event.tiltY)?Math.max(-90,Math.min(90,event.tiltY!)):0;
  const altitude=event.altitudeAngle,azimuth=event.azimuthAngle;
  if(Number.isFinite(altitude)&&Number.isFinite(azimuth)&&altitude!>=0&&altitude!<=Math.PI/2&&azimuth!>=0&&azimuth!<=turn&&
    (altitude!==Math.PI/2||(x===0&&y===0)))return{altitude:altitude!,azimuth:normalizeAzimuth(azimuth!)};
  const horizontal=Math.abs(x)===90||Math.abs(y)===90;
  const a=horizontal?0:Math.PI/2-Math.atan(Math.hypot(Math.tan(x*Math.PI/180),Math.tan(y*Math.PI/180)));
  const direction=x===0?(y>0?Math.PI/2:y<0?3*Math.PI/2:0):y===0?(x<0?Math.PI:0):horizontal?0:normalizeAzimuth(Math.atan2(Math.tan(y*Math.PI/180),Math.tan(x*Math.PI/180)));
  return{altitude:a,azimuth:direction};
}
/** Preserve physical inclination while expressing its projected direction locally. */
export function transformPenTilt(tilt:PenTiltData,inverse?:AffineTransform):PenTiltData {
  if(!inverse||tilt.altitude===Math.PI/2)return{...tilt};
  const magnitude=Math.max(Math.abs(inverse.a),Math.abs(inverse.b),Math.abs(inverse.c),Math.abs(inverse.d));
  const c=Math.cos(tilt.azimuth),s=Math.sin(tilt.azimuth);
  const x=inverse.a/magnitude*c+inverse.c/magnitude*s,y=inverse.b/magnitude*c+inverse.d/magnitude*s;
  if(!Number.isFinite(x)||!Number.isFinite(y)||(x===0&&y===0))throw new Error('Pen tilt direction exceeds transform precision.');
  return{altitude:tilt.altitude,azimuth:normalizeAzimuth(Math.atan2(y,x))};
}
export function interpolatePenTilt(a:PenTiltData|undefined,b:PenTiltData|undefined,t:number):PenTiltData|undefined {
  if(!a&&!b)return undefined;
  const first=a??uprightTilt,last=b??uprightTilt;
  if(t===0)return{...first};if(t===1)return{...last};
  const delta=((last.azimuth-first.azimuth+3*Math.PI)%turn)-Math.PI;
  return{altitude:first.altitude+(last.altitude-first.altitude)*t,azimuth:normalizeAzimuth(first.azimuth+delta*t)};
}
export function samePenTilt(a:PenTiltData|undefined,b:PenTiltData|undefined):boolean {
  return a===b||(a?.altitude===b?.altitude&&a?.azimuth===b?.azimuth);
}
export function brushTipPose(tip:BrushTipData|undefined,tilt?:PenTiltData):{roundness:number;angle:number;cos:number;sin:number} {
  let angle=(tip?.angle??0)*Math.PI/180,roundness=tip?.roundness??1;
  const amount=1-(tilt?.altitude??Math.PI/2)/(Math.PI/2);
  if(tip?.tiltAngle&&amount>0)angle+=tilt!.azimuth;
  if(tip?.tiltRoundness&&tilt)roundness=Math.max(0.01,roundness*(1-pressureResponse(amount,tip.tiltCurve)));
  let cos=Math.cos(angle),sin=Math.sin(angle);
  if(Math.abs(cos)<1e-12)cos=0;if(Math.abs(sin)<1e-12)sin=0;
  return{roundness,angle,cos,sin};
}
export function brushSupportRadius(size:number,pencil:boolean,tip?:BrushTipData):number {
  return pencil&&tip?Math.SQRT2*Math.max(1,Math.round(size))/2:size/2;
}
