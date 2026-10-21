import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import {AffineTransform} from '../core/affine';
import type {LayerMaskData} from '../core/masks';
import type {AssetStore} from '../core/assets';
import type {PixelProcessor} from './processor';
import type {BrushTextureSampler} from './brush-texture';
import {createCanvas,release,renderTransform,type RenderSpace} from './canvas';
import {paintedMask} from './drawing';
import {checkRenderCurrent} from './render-control';
import {nativeRenderTiles} from './native-tiles';
import {yieldTask} from './task-yield';

export function hasWetMask(mask:LayerMaskData):boolean{return !!mask.strokes?.some(entry=>entry.mode==='wet'&&entry.stroke.opacity>0);}

/** Reconstruct ordered coverage in its native mask plane before sampling through
 * the linked/unlinked/master transform. Infinite paint-base coverage is retained;
 * only working ROIs are bounded, never the source mask or image geometry. */
export async function nativeWetMask(mask:LayerMaskData,space:RenderSpace,processor:PixelProcessor,world:AffineTransform,bitmap:ImageBitmap|HTMLCanvasElement|undefined,assets:AssetStore,textures?:BrushTextureSampler,isCancelled?:()=>boolean):Promise<HTMLCanvasElement>{
  const check=()=>checkRenderCurrent(isCancelled),placement=renderTransform(space,world);
  const output=createCanvas(space.width,space.height),context=output.getContext('2d')!;
  let deadline=performance.now()+4;
  try{
    for(const tile of nativeRenderTiles(space,world)){
      check();const {x:left,y:top,width:nativeWidth,height:nativeHeight}=tile.native,clip=tile.output;
      const native=await paintedMask(mask,{x:left,y:top,width:nativeWidth,height:nativeHeight,sx:1,sy:1},0,0,processor,new AffineTransform(),bitmap,assets,textures,isCancelled,true);
      try{
        check();context.save();try{context.resetTransform();context.beginPath();context.rect(clip.x,clip.y,clip.width,clip.height);context.clip();context.setTransform(placement.a,placement.b,placement.c,placement.d,placement.e,placement.f);if(bitmapProjectionRequiresPrecision(placement,native.width,native.height))await drawProjectedBitmap(context,native,placement.multiply(AffineTransform.translation(left,top)),{isCancelled});else context.drawImage(native,left,top);}finally{context.restore();}
      }finally{release(native);}
      if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+4;}
    }
    check();return output;
  }catch(error){release(output);throw error;}
}
