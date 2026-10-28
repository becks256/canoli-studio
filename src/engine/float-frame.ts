import{AffineTransform}from'../core/affine';
import{validateWindow,type FloatSourceWindow}from'../core/float-source/types';
import{projectFloatWindow,type FloatProjectionControl,type FloatWindowSource}from'./float-projection';
import{validateFloatWorkerWindow}from'./float-pixels';
import{checkRenderCurrent}from'./render-control';

export interface FloatSceneFrame{region:{x:number;y:number;width:number;height:number};width:number;height:number;rootTransform?:AffineTransform}
/** Filter a completed native artboard. Layer effects/masks/clipping must already
 * be resolved by the source. Native borders are clamped, then covered once. */
export async function projectFloatFrame(source:FloatWindowSource,input:FloatSourceWindow,frame:FloatSceneFrame,control:FloatProjectionControl={}):Promise<Float32Array<ArrayBuffer>>{
 const bounds=validateWindow(input),{x,y,width,height}=frame.region,outputWidth=frame.width,outputHeight=frame.height;
 if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0||![outputWidth,outputHeight].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Float scene frame geometry is invalid.');
 const nativeWidth=source.width,nativeHeight=source.height;if(![nativeWidth,nativeHeight].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Float frame source geometry is invalid.');
 const root=frame.rootTransform?AffineTransform.fromJSON(frame.rootTransform):new AffineTransform(),sx=outputWidth/width,sy=outputHeight/height,placement=new AffineTransform(sx*root.a,sy*root.b,sx*root.c,sy*root.d,(root.e-x)*sx,(root.f-y)*sy);
 const check=()=>{control.signal?.throwIfAborted();checkRenderCurrent(control.isCancelled);if(source.width!==nativeWidth||source.height!==nativeHeight)throw new Error('Float frame source changed.');};check();
 // Aligned complete native samples retain exact words, including hidden RGB.
 // This also keeps native-size delivery and ordinary 100% views unfiltered.
 if(placement.a===1&&placement.b===0&&placement.c===0&&placement.d===1&&Number.isSafeInteger(placement.e)&&Number.isSafeInteger(placement.f)){
  const native={...bounds,x:bounds.x-placement.e,y:bounds.y-placement.f};
  const left=Math.max(0,native.x),top=Math.max(0,native.y),right=Math.min(nativeWidth,native.x+native.width),bottom=Math.min(nativeHeight,native.y+native.height);
  if(right<=left||bottom<=top)return new Float32Array(bounds.width*bounds.height*4);
  const width=right-left,height=bottom-top,pixels=await source.readWindow({x:left,y:top,width,height},{signal:control.signal,onProgress:check});check();validateFloatWorkerWindow(pixels);if(pixels.length!==width*height*4)throw new Error('Float frame read differs from requested native geometry.');
  if(left===native.x&&top===native.y&&width===bounds.width&&height===bounds.height)return pixels.slice();
  const output=new Float32Array(bounds.width*bounds.height*4);
  for(let row=0;row<height;row++)output.set(pixels.subarray(row*width*4,(row+1)*width*4),((top-native.y+row)*bounds.width+left-native.x)*4);
  check();return output;
 }
 return projectFloatWindow(source,placement,bounds,{signal:control.signal,isCancelled:()=>{check();return false;}});
}
