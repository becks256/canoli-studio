import type {AffineTransform} from '../core/affine';
import type {Rect} from '../core/drawing';
import {renderTransform,type RenderSpace} from './canvas';

/** Document-anchored output cells produce the same native sampling ROI when a
 * viewport/export is partitioned differently. Clip only on integer output edges;
 * the complete cell and native halo stay independent of the requested crop. */
export function* nativeRenderTiles(space:RenderSpace,world:AffineTransform):Generator<{native:Rect;output:Rect}>{
  const inverse=renderTransform({...space,x:0,y:0},world).inverse();
  const footprint=Math.max(Math.abs(inverse.a)+Math.abs(inverse.c),Math.abs(inverse.b)+Math.abs(inverse.d));
  const step=Math.max(1,Math.min(256,Math.floor(512/footprint))),originX=space.x*space.sx,originY=space.y*space.sy;
  const firstX=Math.floor(originX/step)*step,firstY=Math.floor(originY/step)*step;
  if(![originX,originY].every(Number.isFinite)||![firstX,firstY,firstX+space.width+step,firstY+space.height+step].every(value=>Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER))throw new Error('Native sampling grid exceeds numeric precision.');
  for(let cy=firstY;cy<originY+space.height;cy+=step)for(let cx=firstX;cx<originX+space.width;cx+=step){
    const x=Math.max(0,Math.round(cx-originX)),y=Math.max(0,Math.round(cy-originY)),right=Math.min(space.width,Math.round(cx+step-originX)),bottom=Math.min(space.height,Math.round(cy+step-originY));
    if(right<=x||bottom<=y)continue;
    const bounds=inverse.bounds({x:cx,y:cy,width:step,height:step}),left=Math.floor(bounds.x)-2,top=Math.floor(bounds.y)-2,nativeRight=Math.ceil(bounds.x+bounds.width)+2,nativeBottom=Math.ceil(bounds.y+bounds.height)+2;
    const width=nativeRight-left,height=nativeBottom-top;
    if(![left,top,nativeRight,nativeBottom,width,height].every(Number.isSafeInteger)||width<1||height<1)throw new Error('Native sampling footprint exceeds numeric precision.');
    if(width*height>4_000_000||Math.max(width,height)>4096)throw new Error('This view requires a native sampling footprint beyond the working-buffer budget. Increase zoom; original geometry remains unchanged.');
    yield{native:{x:left,y:top,width,height},output:{x,y,width:right-x,height:bottom-y}};
  }
}
