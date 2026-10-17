import {PngRowEncoder} from './png';
import {mattingHalo,type RefineEdgeSettings,type RefineEdgeControl} from '../core/matting';
import type {MattingTileResult} from './matting-tile';
import {yieldTask} from '../core/task-yield';

export interface MattingRegion {x:number;y:number;width:number;height:number;core:{x:number;y:number;width:number;height:number}}
export function mattingLayout(width:number,height:number){const stripHeight=Math.max(1,Math.min(64,Math.floor(4_000_000/(width*4))));return{stripHeight,total:Math.ceil(width/512)*Math.ceil(height/stripHeight)};}
export function* mattingRegions(width:number,height:number,settings:RefineEdgeSettings):Generator<MattingRegion>{
  const halo=mattingHalo(settings),{stripHeight}=mattingLayout(width,height);
  for(let y=0;y<height;y+=stripHeight)for(let x=0;x<width;x+=512){const w=Math.min(512,width-x),h=Math.min(stripHeight,height-y);yield{x:x-halo,y:y-halo,width:w+2*halo,height:h+2*halo,core:{x:halo,y:halo,width:w,height:h}};}
}
/** Shared browser/Node production writer. Native pixels, bounded strips, no full output plane. */
export async function encodeMattingOutput(width:number,height:number,settings:RefineEdgeSettings,
  tile:(region:MattingRegion)=>Promise<MattingTileResult>,control:RefineEdgeControl={},check:()=>void=()=>{}){
  const mask=new PngRowEncoder(width,height),foreground=settings.decontaminate?new PngRowEncoder(width,height):undefined;
  const halo=mattingHalo(settings),{stripHeight,total}=mattingLayout(width,height);
  let completed=0,unresolvedPixels=0,nonempty=false;
  const current=()=>{control.signal?.throwIfAborted();check();};
  try{
    current();control.onProgress?.({completed,total});
    for(let y=0;y<height;y+=stripHeight){
      const h=Math.min(stripHeight,height-y),maskRows=new Uint8Array(width*h*4),colorRows=foreground?new Uint8Array(width*h*4):undefined;
      for(let x=0;x<width;x+=512){
        current();const w=Math.min(512,width-x),result=await tile({x:x-halo,y:y-halo,width:w+halo*2,height:h+halo*2,core:{x:halo,y:halo,width:w,height:h}});current();
        if(result.width!==w||result.height!==h||result.alpha.length!==w*h||result.rgba.length!==w*h*4||!Number.isSafeInteger(result.unresolvedPixels)||result.unresolvedPixels<0||result.unresolvedPixels>w*h)throw new Error('Invalid matting worker result.');
        unresolvedPixels+=result.unresolvedPixels;
        for(let row=0;row<h;row++)for(let col=0;col<w;col++){
          const i=row*w+col,out=(row*width+x+col)*4,a=result.alpha[i];maskRows[out]=255;maskRows[out+1]=255;maskRows[out+2]=255;maskRows[out+3]=a;
          nonempty ||= a>0&&result.rgba[i*4+3]>0;if(colorRows)for(let c=0;c<4;c++)colorRows[out+c]=result.rgba[i*4+c];
        }
        control.onProgress?.({completed:++completed,total});
      }
      await mask.append(maskRows,h);if(foreground&&colorRows)await foreground.append(colorRows,h);await yieldTask();current();
    }
    if(!nonempty)throw new Error('No foreground remains. Add foreground trimap marks or change the initial selection.');
    const maskBlob=await mask.finish(),foregroundBlob=await foreground?.finish();current();return{maskBlob,foregroundBlob,unresolvedPixels};
  }catch(error){await Promise.allSettled([mask.abort(error),foreground?.abort(error)]);throw error;}
}
