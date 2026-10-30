import {AffineTransform,type AffineBounds} from '../core/affine';
import {perspectiveMatrix,perspectiveRect,perspectiveLocalQuad,type PerspectiveData} from '../core/perspective';
import type {ProjectiveQuad} from '../core/projective';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {projectPerspectiveWindow} from './projective-projection';
import {renderTransform,type RenderSpace} from './canvas';
import type {PixelProcessor} from './processor';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

/** Rasterize existing intrinsic operations in bounded original-pixel windows,
 * then sample the retained virtual source. No replacement asset is installed. */
export async function drawPerspectiveContent(
  layer:{width:number;height:number;perspective:PerspectiveData},native:{width:number;height:number},localBounds:AffineBounds,
  target:HTMLCanvasElement,space:RenderSpace,world:AffineTransform,processor:PixelProcessor,
  readNative:(bounds:FloatSourceWindow)=>Promise<Uint8ClampedArray>,isCancelled?:()=>boolean,
){
  const check=()=>checkRenderCurrent(isCancelled),scale=AffineTransform.scale(native.width/layer.width,native.height/layer.height);
  const nativeBox=scale.bounds(localBounds),x=Math.floor(nativeBox.x),y=Math.floor(nativeBox.y),width=Math.ceil(nativeBox.x+nativeBox.width)-x,height=Math.ceil(nativeBox.y+nativeBox.height)-y;
  const matrix=perspectiveMatrix(layer.width,layer.height,layer.perspective),view=renderTransform(space,world),toLocal=scale.inverse();
  const original=x===0&&y===0&&width===native.width&&height===native.height;
  const corners=(original?perspectiveLocalQuad(layer.width,layer.height,layer.perspective):perspectiveRect(matrix,toLocal.bounds({x,y,width,height})).corners).map(p=>view.point(p)) as unknown as ProjectiveQuad;
  const source={width,height,readWindow:async(input:FloatSourceWindow)=>{
    check();const area=validateWindow(input),bytes=await readNative({...area,x:area.x+x,y:area.y+y});check();
    if(!(bytes instanceof Uint8ClampedArray)||bytes.length!==area.width*area.height*4)throw new Error('Native perspective content differs from its captured geometry.');
    const pixels=new Float32Array(bytes.length);for(let i=0;i<bytes.length;i++)pixels[i]=bytes[i]/255;return pixels;
  }};
  const context=target.getContext('2d')!;let deadline=performance.now()+2;
  for(let top=0;top<target.height;top+=512)for(let left=0;left<target.width;left+=512){
    check();const area={x:left,y:top,width:Math.min(512,target.width-left),height:Math.min(512,target.height-top)};
    const pixels=await projectPerspectiveWindow(source,processor,corners,area,{isCancelled});check();
    const image=context.createImageData(area.width,area.height);for(let i=0;i<pixels.length;i++)image.data[i]=Math.max(0,Math.min(255,Math.round(pixels[i]*255)));
    context.putImageData(image,left,top);
    if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
  }
  check();
}
