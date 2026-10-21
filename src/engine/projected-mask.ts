import {drawProjectedBitmap,bitmapProjectionRequiresPrecision} from './bitmap-projection';
import {AffineTransform} from '../core/affine';
import {nativeRenderTiles} from './native-tiles';
import {createCanvas,release,renderTransform,type RenderSpace} from './canvas';
import {checkRenderCurrent} from './render-control';

/** Sample native mask coverage after native feathering, preserving its authored coordinate plane. */
export async function projectNativeMask(space:RenderSpace,world:AffineTransform,render:(region:{x:number;y:number;width:number;height:number})=>Promise<HTMLCanvasElement>,isCancelled?:()=>boolean):Promise<HTMLCanvasElement>{
 const output=createCanvas(space.width,space.height,true),context=output.getContext('2d')!,placement=renderTransform(space,world);
 try{
  for(const tile of nativeRenderTiles(space,world)){
   checkRenderCurrent(isCancelled);const source=await render(tile.native);
   try{checkRenderCurrent(isCancelled);context.save();try{context.resetTransform();context.beginPath();context.rect(tile.output.x,tile.output.y,tile.output.width,tile.output.height);context.clip();context.setTransform(placement.a,placement.b,placement.c,placement.d,placement.e,placement.f);if(bitmapProjectionRequiresPrecision(placement,source.width,source.height))await drawProjectedBitmap(context,source,placement.multiply(AffineTransform.translation(tile.native.x,tile.native.y)),{isCancelled});else context.drawImage(source,tile.native.x,tile.native.y);}finally{context.restore();}}
   finally{release(source);}
  }
  return output;
 }catch(error){release(output);throw error;}
}
