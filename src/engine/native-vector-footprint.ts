import {pathBounds,pathContours,type Rect,type VectorPathData} from '../core/drawing';
import type {VectorLayerData} from '../core/model';
import {vectorStrokeValues} from '../core/vector-stroke';

/** Bound actual joins for working allocation, not the largest hypothetical
 * miter allowed by metadata. Unknown/ill-conditioned joins keep the old hull. */
function workingPath(path:VectorPathData):Rect {
 const style=vectorStrokeValues(path);
 if(!path.stroke||style.strokeJoin!=='miter')return pathBounds(path);
 let maximum=1,uncertain=false;
 for(const contour of pathContours(path)){
  const points=contour.points,n=points.length;
  const direction=(index:number,forward:boolean):{x:number;y:number}|undefined=>{
   for(let k=0;k<n;k++){
    const segment=forward?index+k:index-1-k;
    if(!contour.closed&&(segment<0||segment>=n-1))return;
    const a=points[(segment%n+n)%n],b=points[((segment+1)%n+n)%n];
    const pairs=forward?[[a.out,a],[b.in,a],[b,a]]:[[b,b.in],[b,a.out],[b,a]];
    for(const [end,start]of pairs){
     const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
     if(!length)continue;
     const magnitude=Math.max(Math.abs(end.x),Math.abs(end.y),Math.abs(start.x),Math.abs(start.y),length);
     // Do not infer a tight geometric reach from poorly resolved native tangents.
     if(!Number.isFinite(length)||magnitude/length*2**-20>1e-5){uncertain=true;return;}
     return{x:dx/length,y:dy/length};
    }
   }
  };
  for(let i=0;i<n;i++){
   if(!contour.closed&&(i===0||i===n-1))continue;
   const a=direction(i,false),b=direction(i,true);if(!a||!b)continue;
   const dot=Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y)),cross=Math.abs(a.x*b.y-a.y*b.x);
   if(dot<0&&cross<1e-7){uncertain=true;continue;}
   const ratio=dot<0?Math.sqrt(2*(1-dot))/cross:Math.sqrt(2/(1+dot));
   // A definite bevel needs no miter extension. Near the native threshold,
   // preserve the authored limit as a conservative bound.
   if(ratio>style.strokeMiterLimit*(1+1e-6))continue;
   maximum=Math.max(maximum,Math.min(style.strokeMiterLimit,ratio*(1+1e-6)+1e-6));
  }
 }
 return pathBounds(uncertain?path:{...path,strokeMiterLimit:maximum});
}

export function nativeVectorFootprint(layer:Pick<VectorLayerData,'paths'>):Rect|undefined {
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const path of layer.paths){const b=workingPath(path);left=Math.min(left,b.x);top=Math.min(top,b.y);right=Math.max(right,b.x+b.width);bottom=Math.max(bottom,b.y+b.height);}
 return left===Infinity?undefined:{x:left,y:top,width:right-left,height:bottom-top};
}
