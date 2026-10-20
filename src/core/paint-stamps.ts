import {symmetryMatrices} from './brush-symmetry';
import {AffineTransform} from './affine';

/** Internal replay point; copy matrices are never serialized as input samples. */
export type PaintStampPoint=StrokePoint&{copy?:AffineTransform};
import {brushTipPose,brushSupportRadius,interpolatePenTilt,samePenTilt} from './brush-tip';
import type {BrushStrokeData,Rect,StrokePoint} from './drawing';
import {pressureResponse,pressureSizeResponse,pressureOpacityResponse} from './pressure-curve';

/** Shared native replay grid, clipped without changing segment stamp indices. */
export function* strokeStamps(
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
):Generator<PaintStampPoint> {
  const padding = brushSupportRadius(stroke.size,stroke.kind==='pencil',stroke.tip) + 2;
  const frames=stroke.symmetry?symmetryMatrices(stroke.symmetry).map((copy,index)=>({copy:index?copy:undefined,visible:index?copy.inverse().bounds(visible):visible})):[{copy:undefined,visible}];
  const inFrame=(p:StrokePoint,box:Rect)=>p.x>=box.x-padding&&p.x<=box.x+box.width+padding&&p.y>=box.y-padding&&p.y<=box.y+box.height+padding;
  function* copies(point:StrokePoint):Generator<PaintStampPoint>{for(const frame of frames)if(inFrame(point,frame.visible))yield frame.copy?{...point,copy:frame.copy}:point;}
  const active=!!stroke.pressureCurve&&(stroke.pressureSize!==false||stroke.pressureOpacity===true);
  const paints=(p:StrokePoint)=>!active||pressureResponse(p.pressure,stroke.pressureCurve)>0;
  if (from === 0 && paints(stroke.points[0])) {if(stroke.symmetry)yield* copies(stroke.points[0]);else if(inFrame(stroke.points[0],visible))yield stroke.points[0];}
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1],
      b = stroke.points[i];
    // Monotonic response: two empty endpoints imply the whole segment is empty.
    if(stroke.pressureCurve&&!paints(a)&&!paints(b))continue;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length =
      stroke.kind === "pencil"
        ? Math.max(Math.abs(dx), Math.abs(dy))
        : Math.hypot(dx, dy);
    const spacingFactor = stroke.spacing ?? 0.12;
    const spacing =
      stroke.kind === "pencil"
        ? 1
        : Math.max(
            0.5,
            stroke.size *
              spacingFactor *
              (stroke.tip?Math.min(brushTipPose(stroke.tip,a.tilt).roundness,brushTipPose(stroke.tip,b.tilt).roundness):1) *
              (stroke.pressureSize!==false&&stroke.pressureCurve
                ? Math.min(pressureResponse(a.pressure,stroke.pressureCurve),pressureResponse(b.pressure,stroke.pressureCurve))
                : Math.max(.05,Math.min(a.pressure, b.pressure))),
          );
    const count = Math.max(1, Math.ceil(length / spacing));
    // Clip the parameter interval before stepping, retaining the same stamp grid
    // on every viewport/export tile to avoid seams.
    const ranges:{first:number;last:number}[]=[];
    for(const frame of frames){
      const box=frame.visible;let low=0,high=1;
      for(const [start,delta,min,max] of [[a.x,dx,box.x-padding,box.x+box.width+padding],[a.y,dy,box.y-padding,box.y+box.height+padding]]){
        if(delta===0){if(start<min||start>max){high=-1;break;}}
        else{const t0=(min-start)/delta,t1=(max-start)/delta;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));}
      }
      const first=Math.max(1,Math.ceil(low*count)),last=Math.min(count,Math.floor(high*count));
      if(first<=last)ranges.push({first,last});
    }
    ranges.sort((a,b)=>a.first-b.first);
    const merged:typeof ranges=[];
    for(const range of ranges){const previous=merged.at(-1);if(previous&&range.first<=previous.last+1)previous.last=Math.max(previous.last,range.last);else merged.push({...range});}
    for(const {first,last} of merged){
    // Beyond safe integers, ++ can leave the index unchanged forever. This is
    // a numeric replay failure, never a source-image/import resolution limit.
    if (first <= last && (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)))
      throw new Error('Stroke stamp indices exceed numeric precision. Move extremely distant geometry closer before rendering.');
    for (
      let step = first;
      step <= last;
      step++
    ) {
      const t = step / count;
      const tilt=interpolatePenTilt(a.tilt,b.tilt,t);
      const point={
        ...(tilt?{tilt}:{}),
        x: a.x + dx * t,
        y: a.y + dy * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      };
      if(paints(point)){if(stroke.symmetry)yield* copies(point);else yield point;}
    }
    }
  }
}

export function paintStampSize(stroke:BrushStrokeData,point:StrokePoint):number{return (stroke.pressureSize??true)?stroke.size*pressureSizeResponse(point.pressure,stroke.pressureCurve):stroke.size;}
export function paintStampAlpha(stroke:BrushStrokeData,point:StrokePoint,alpha=1):number{const flow=stroke.flow??1;if(flow<1)alpha*=Math.max(0.01,flow);if(stroke.pressureOpacity??false)alpha*=pressureOpacityResponse(point.pressure,stroke.pressureCurve);return alpha;}

export function sameStrokePoint(a:StrokePoint,b:StrokePoint):boolean { return a===b||(a.x===b.x&&a.y===b.y&&a.pressure===b.pressure&&samePenTilt(a.tilt,b.tilt)); }
export function paintStampGeometry(stroke:Pick<BrushStrokeData,'size'|'kind'|'pressureSize'|'pressureCurve'|'tip'>,point:PaintStampPoint,preserveTipAngle=false){
  const size=paintStampSize(stroke as BrushStrokeData,point),pose=brushTipPose(stroke.tip,point.tilt);
  let cx=point.x,cy=point.y,rx=size/2,ry=size*pose.roundness/2;
  if(stroke.kind==='pencil'){
    const width=size<=0?0:Math.max(1,Math.round(size)),height=size<=0?0:Math.max(1,Math.round(size*pose.roundness));
    cx=Math.floor(point.x-width/2)+width/2;cy=Math.floor(point.y-height/2)+height/2;rx=width/2;ry=height/2;
  }
  const isotropic=stroke.kind!=='pencil'&&pose.roundness===1&&!preserveTipAngle;
  const cos=isotropic?1:pose.cos,sin=isotropic?0:pose.sin;
  let a=cos,b=sin,c=-sin,d=cos;
  if(point.copy){const m=point.copy,center=m.point({x:cx,y:cy});cx=center.x;cy=center.y;a=m.a*cos+m.c*sin;b=m.b*cos+m.d*sin;c=-m.a*sin+m.c*cos;d=-m.b*sin+m.d*cos;}
  return{cx,cy,rx,ry,cos,sin,a,b,c,d};
}
