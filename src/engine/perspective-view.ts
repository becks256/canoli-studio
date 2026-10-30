import {AffineTransform} from '../core/affine';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import type {PixelProcessor} from './processor';
import {checkRenderCurrent} from './render-control';
import type {RenderSpace} from './canvas';
import type {ProjectiveQuad} from '../core/projective';

/** Sample completed native document coverage onto a viewport lattice without
 * clipping the infinite mask plane to an image or artboard. */
export async function perspectiveMaskView(
  read:(bounds:FloatSourceWindow)=>Promise<Float32Array>,space:RenderSpace,output:FloatSourceWindow,
  processor:Pick<PixelProcessor,'floatProjectiveField'>,isCancelled?:()=>boolean,
){
  const bounds=validateWindow(output),origin={x:Math.floor(space.x),y:Math.floor(space.y)},view=new AffineTransform(space.sx,0,0,space.sy,(origin.x-space.x)*space.sx,(origin.y-space.y)*space.sy);
  const inverse=view.inverse(),quad=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(p=>view.point(p)) as unknown as ProjectiveQuad;
  const check=()=>checkRenderCurrent(isCancelled),result=new Float32Array(bounds.width*bounds.height);
  const render=async(area:FloatSourceWindow):Promise<void>=>{
    check();const a=inverse.point({x:area.x+.5,y:area.y+.5}),b=inverse.point({x:area.x+area.width-.5,y:area.y+area.height-.5});
    const x=Math.floor(Math.min(a.x,b.x)-.5)-1,y=Math.floor(Math.min(a.y,b.y)-.5)-1;
    const right=Math.floor(Math.max(a.x,b.x)-.5)+3,bottom=Math.floor(Math.max(a.y,b.y)-.5)+3;
    if((right-x)*(bottom-y)>262144){
      if(area.width>=area.height&&area.width>1){const half=Math.floor(area.width/2);await render({...area,width:half});await render({...area,x:area.x+half,width:area.width-half});}
      else if(area.height>1){const half=Math.floor(area.height/2);await render({...area,height:half});await render({...area,y:area.y+half,height:area.height-half});}
      else throw new Error('Mask viewport sample cannot resolve its native neighborhood.');
      return;
    }
    const nativeBounds=validateWindow({x,y,width:right-x,height:bottom-y}),alpha=await read({...nativeBounds,x:x+origin.x,y:y+origin.y});check();validateFloatAlpha(alpha,nativeBounds.width*nativeBounds.height);
    const pixels=await processor.floatProjectiveField(alpha,{sourceWidth:1,sourceHeight:1,corners:quad,field:nativeBounds,source:nativeBounds,output:area,background:0});
    check();validateFloatAlpha(pixels,area.width*area.height);
    for(let row=0;row<area.height;row++)result.set(pixels.subarray(row*area.width,(row+1)*area.width),(area.y-bounds.y+row)*bounds.width+area.x-bounds.x);
  };
  await render(bounds);check();return result;
}
