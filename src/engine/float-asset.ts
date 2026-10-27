import{FloatRasterSource}from'../core/float-source/source';
import{FLOAT_SOURCE_NATIVE_SHA}from'../core/float-source/types';
import type{TiffDecodeSettings,TiffImportControl,TiffFloatColor}from'../core/interchange/tiff/types';
import{AffineTransform}from'../core/affine';
import{projectFloatWindow}from'./float-projection';
import{IccSession}from'../core/color/icc-client';
import{iccTarget}from'../core/color/profile-source';
import{freeze}from'../core/immutable';
import{createCanvas,release}from'./canvas';

/** Original float samples are the editing source. Only this bounded surface is
 * quantized for thumbnails; it must never be sampled as native image pixels. */
export async function prepareFloatAsset(original:Blob,settings:TiffDecodeSettings,control:TiffImportControl={}){
 const current=()=>control.signal?.throwIfAborted(),progress=(fraction:number|null)=>{current();control.onProgress?.({phase:'decoding',fraction});current();};let source:FloatRasterSource|undefined,display:IccSession|undefined,canvas:HTMLCanvasElement|undefined,bitmap:ImageBitmap|undefined,accepted=false;
 try{
  source=await FloatRasterSource.openTiff(original,settings,undefined,{signal:control.signal,onProgress:p=>progress(p.fraction)});current();const manifest=await source.prepare({signal:control.signal,onProgress:p=>progress(p.fraction)});current();
  const factor=Math.min(1,96/source.width,96/source.height),width=Math.max(1,Math.round(source.width*factor)),height=Math.max(1,Math.round(source.height*factor));
  const samples=await projectFloatWindow(source,AffineTransform.scale(width/source.width,height/source.height),{x:0,y:0,width,height},{signal:control.signal});current();
  const conversion=await IccSession.prepareRgb(iccTarget('linear-srgb').source,iccTarget('srgb').source,{inputFormat:'rgba-float32',outputFormat:'rgba8'},{signal:control.signal,onProgress:()=>progress(null)});display=conversion.session;current();const bytes=await display.applyWindow(samples);current();
  if(!(bytes instanceof Uint8ClampedArray))throw new Error('Float thumbnail conversion returned incorrect sample precision.');canvas=createCanvas(width,height,true);canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);bitmap=await createImageBitmap(canvas);current();
  const color:TiffFloatColor={version:1,engine:'Little CMS 2.19.1',wasmSha256:FLOAT_SOURCE_NATIVE_SHA,source:source.sourceColor,outputSpace:'srgb8',usesIntentFallback:manifest.prepared.usesIntentFallback||conversion.prepared.usesIntentFallback,warnings:[...new Set([...manifest.prepared.warnings,...conversion.prepared.warnings])]};progress(1);accepted=true;return{bitmap,width:source.width,height:source.height,color:freeze(color)};
 }finally{if(!accepted)bitmap?.close();if(canvas)release(canvas);display?.dispose();source?.dispose();}
}
