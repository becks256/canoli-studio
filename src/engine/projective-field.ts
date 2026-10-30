import {captureFieldBounds,compileProjectiveField,type ProjectiveFieldOptions} from '../core/projective-field';
import type {ProjectiveQuad} from '../core/projective';
import {validateWindow,type FloatSourceWindow,type FloatSourceControl} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import type {FloatProjectionControl} from './float-projection';
import {checkRenderCurrent} from './render-control';
import {yieldTask} from '../core/task-yield';

export interface ProjectiveFieldSource {
  /** Original/reference rectangle for the homography, independent of support. */
  width:number;height:number;bounds:FloatSourceWindow;background:number;
  readWindow(bounds:FloatSourceWindow,control?:FloatSourceControl):Promise<Float32Array>;
}
export interface ProjectiveFieldSampler {
  floatProjectiveField(alpha:Float32Array,options:ProjectiveFieldOptions):Promise<Float32Array>;
}

/** Project a finite deviation field over an infinite constant background. A
 * linked mask may extend beyond the image; the image quad never clips this
 * plane. Sampling is at output pixel centers, with constant border neighbors.
 * Callers retain source leases and apply document-space feather/settings later. */
export async function projectPerspectiveFieldWindow(
  source:ProjectiveFieldSource,processor:ProjectiveFieldSampler,corners:ProjectiveQuad,input:FloatSourceWindow,
  control:FloatProjectionControl={},
):Promise<Float32Array<ArrayBuffer>> {
  const width=source.width,height=source.height,field=captureFieldBounds(source.bounds),background=source.background;
  const bounds=validateWindow(input),read=source.readWindow;
  const compiled=compileProjectiveField({sourceWidth:width,sourceHeight:height,field,background,
    source:{x:field.x,y:field.y,width:1,height:1},output:bounds,corners});
  const quad=compiled.options.corners,m=compiled.values,signal=control.signal,isCancelled=control.isCancelled;
  const check=()=>{
    signal?.throwIfAborted();checkRenderCurrent(isCancelled);
    if(source.width!==width||source.height!==height||source.background!==background||source.readWindow!==read||
      source.bounds.x!==field.x||source.bounds.y!==field.y||source.bounds.width!==field.width||source.bounds.height!==field.height)
      throw new Error('Perspective field source geometry changed.');
  };
  check();const output=new Float32Array(bounds.width*bounds.height).fill(background);let deadline=performance.now()+2;
  const render=async(region:FloatSourceWindow):Promise<void>=>{
    check();if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
    const points=[];let negative=false,positive=false,horizon=false;
    for(const py of [region.y,region.y+region.height-1])for(const px of [region.x,region.x+region.width-1]){
      // Match native relative-frame arithmetic exactly, including pixel centers.
      const x=(px-quad[0].x)+.5,y=(py-quad[0].y)+.5,w=m[6]*x+m[7]*y+m[8];
      const nu=m[0]*x+m[1]*y+m[2],nv=m[3]*x+m[4]*y+m[5];
      if(!Number.isFinite(w)||!Number.isFinite(nu)||!Number.isFinite(nv))throw new Error('Perspective field inverse exceeds working precision.');
      negative ||= w<0;positive ||= w>0;horizon ||= w===0;
      if(w!==0)points.push({x:nu/w-.5,y:nv/w-.5});
    }
    const split=async()=>{
      if(region.width>=region.height&&region.width>1){const half=Math.floor(region.width/2);await render({...region,width:half});await render({...region,x:region.x+half,width:region.width-half});}
      else if(region.height>1){const half=Math.floor(region.height/2);await render({...region,height:half});await render({...region,y:region.y+half,height:region.height-half});}
      else throw new Error('Perspective field footprint cannot be resolved at working precision.');
    };
    if(horizon||negative&&positive){
      if(region.width===1&&region.height===1)return; // Infinity has the field's constant background.
      await split();return;
    }
    // With a constant-sign affine denominator, rational coordinate extrema
    // over this rectangle lie at its corners. Include a guard neighbor for
    // roundoff; the native kernel rejects any missing finite-support sample.
    const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
    const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
    if(maxX<field.x-1||maxY<field.y-1||minX>=field.x+field.width||minY>=field.y+field.height)return;
    const x=Math.max(field.x,Math.floor(Math.max(field.x-1,minX))-1),y=Math.max(field.y,Math.floor(Math.max(field.y-1,minY))-1);
    const right=Math.min(field.x+field.width,Math.floor(Math.min(field.x+field.width,maxX))+3);
    const bottom=Math.min(field.y+field.height,Math.floor(Math.min(field.y+field.height,maxY))+3);
    if((right-x)*(bottom-y)>262144){await split();return;}
    const nativeBounds={x,y,width:right-x,height:bottom-y};
    const alpha=await read.call(source,{...nativeBounds},{signal,onProgress:check});check();validateFloatAlpha(alpha,nativeBounds.width*nativeBounds.height);
    const result=await processor.floatProjectiveField(alpha,{sourceWidth:width,sourceHeight:height,corners:quad,field,background,source:nativeBounds,output:region});
    check();validateFloatAlpha(result,region.width*region.height);
    for(let row=0;row<region.height;row++)output.set(result.subarray(row*region.width,(row+1)*region.width),(region.y-bounds.y+row)*bounds.width+region.x-bounds.x);
  };
  await render(bounds);check();validateFloatAlpha(output,bounds.width*bounds.height);return output;
}
