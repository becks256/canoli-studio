import {ProjectiveTransform,clipProjectiveQuad,type ProjectiveQuad} from '../core/projective';
import {compileProjectiveSample,type ProjectiveSampleOptions} from '../core/projective-sampling';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatWorkerWindow} from './float-pixels';
import type {FloatWindowSource,FloatProjectionControl} from './float-projection';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

export interface ProjectivePixelSampler {
  floatProjective(pixels:Float32Array,options:ProjectiveSampleOptions):Promise<Float32Array>;
}

/** Original-derived float perspective windows. The caller pins the complete
 * original and its interpretation for this operation. Native/output geometry
 * stays separate from the 262144-pixel read and working-buffer budgets. */
export async function projectPerspectiveWindow(
  source:FloatWindowSource,processor:ProjectivePixelSampler,corners:ProjectiveQuad,input:FloatSourceWindow,
  control:FloatProjectionControl={},
):Promise<Float32Array<ArrayBuffer>> {
  const width=source.width,height=source.height,bounds=validateWindow(input);
  const compiled=compileProjectiveSample({sourceWidth:width,sourceHeight:height,source:{x:0,y:0,width:1,height:1},output:bounds,corners});
  const quad=compiled.options.corners,inverse=new ProjectiveTransform(Array.from(compiled.values.subarray(0,9)));
  const signal=control.signal,isCancelled=control.isCancelled;
  const check=()=>{signal?.throwIfAborted();checkRenderCurrent(isCancelled);if(source.width!==width||source.height!==height)throw new Error('Perspective source geometry changed.');};
  check();const output=new Float32Array(bounds.width*bounds.height*4);let deadline=performance.now()+2;
  const render=async(region:FloatSourceWindow):Promise<void>=>{
    check();let polygon=clipProjectiveQuad(quad,region);if(polygon.length<3)return;
    if(region.width===1&&region.height===1){
      // A minified image may occupy only part of one pixel. Read its actual
      // centroid sample, rather than allocating the full inverse pixel footprint.
      const p=polygon.map(p=>({x:p.x-region.x,y:p.y-region.y}));let area=0,x=0,y=0;
      for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],cross=a.x*b.y-b.x*a.y;area+=cross;x+=(a.x+b.x)*cross;y+=(a.y+b.y)*cross;}
      if(area===0)return;polygon=[{x:region.x+x/(3*area),y:region.y+y/(3*area)}];
    }
    const points=polygon.map(p=>inverse.point({x:p.x-quad[0].x,y:p.y-quad[0].y})).map(p=>({x:Math.max(0,Math.min(width-1,p.x-.5)),y:Math.max(0,Math.min(height-1,p.y-.5))}));
    // One guard sample covers roundoff at clipped corners; bilinear support
    // still determines the complete captured ROI and the kernel checks it.
    const x=Math.max(0,Math.floor(Math.min(...points.map(p=>p.x)))-1),y=Math.max(0,Math.floor(Math.min(...points.map(p=>p.y)))-1);
    const right=Math.min(width,Math.floor(Math.max(...points.map(p=>p.x)))+3),bottom=Math.min(height,Math.floor(Math.max(...points.map(p=>p.y)))+3);
    if((right-x)*(bottom-y)>262144){
      if(region.width>=region.height&&region.width>1){const half=Math.floor(region.width/2);await render({...region,width:half});await render({...region,x:region.x+half,width:region.width-half});}
      else if(region.height>1){const half=Math.floor(region.height/2);await render({...region,height:half});await render({...region,y:region.y+half,height:region.height-half});}
      else throw new Error('Perspective sample footprint cannot be resolved at working precision.');
      return;
    }
    const nativeBounds={x,y,width:right-x,height:bottom-y},native=await source.readWindow(nativeBounds,{signal,onProgress:check});check();validateFloatWorkerWindow(native);
    if(native.length!==nativeBounds.width*nativeBounds.height*4)throw new Error('Perspective source read differs from captured native geometry.');
    const result=await processor.floatProjective(native,{sourceWidth:width,sourceHeight:height,source:nativeBounds,output:region,corners:quad});check();validateFloatWorkerWindow(result);
    if(result.length!==region.width*region.height*4)throw new Error('Perspective result differs from captured output geometry.');
    for(let row=0;row<region.height;row++)output.set(result.subarray(row*region.width*4,(row+1)*region.width*4),((region.y-bounds.y+row)*bounds.width+region.x-bounds.x)*4);
    if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
  };
  await render(bounds);check();validateFloatWorkerWindow(output);return output;
}
