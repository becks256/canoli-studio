import{isFloatDocument}from'../core/float-document';
import type{DocumentData}from'../core/model';
import type{AssetStore}from'../core/assets';
import{normalizeColorOutput,type ColorOutput}from'../core/color/color-settings';
import{iccTarget}from'../core/color/profile-source';
import{IccSession}from'../core/color/icc-client';
import type{IccSampleFormat}from'../core/color/icc-types';
import type{FloatSourceWindow}from'../core/float-source/types';
import type{DocumentRenderer}from'./renderer';
import type{CapturedFloatScene}from'./float-scene';
import{checkExport,type ExportControl}from'./export-control';
import{PngRowEncoder}from'../core/png-stream';
import{RASTER_EXPORT_COLUMNS,rasterExportRows}from'./raster-export-grid';
import{yieldTask}from'../core/task-yield';

export type FloatDeliverySamples<F extends IccSampleFormat>=F extends'rgba8'?Uint8ClampedArray<ArrayBuffer>:F extends'rgba16'?Uint16Array<ArrayBuffer>:Float32Array<ArrayBuffer>;
export interface FloatDelivery<F extends IccSampleFormat>{readonly document:DocumentData;readonly profile:Uint8Array<ArrayBuffer>;readonly warnings:readonly string[];check():void;read(bounds:FloatSourceWindow):Promise<FloatDeliverySamples<F>>;dispose():void}
/** Prepare all original-derived tiles before acquiring the output CMM owner.
 * Display surfaces are never read into file output. Conversion/quantization is
 * performed once, directly from the working float samples to the file encoding. */
export async function prepareFloatDelivery<F extends IccSampleFormat>(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,format:F,control?:ExportControl,color?:ColorOutput,captured?:CapturedFloatScene):Promise<FloatDelivery<F>>{
 checkExport(control);if(!isFloatDocument(document)||!renderer.captureFloatScene)throw new Error('This renderer cannot deliver native float document samples.');
 const settings=normalizeColorOutput(color??{profile:format==='rgba8'?'srgb':'linear-srgb'}),target=iccTarget(settings.profile),originalProfile=target.source;let scene:CapturedFloatScene|undefined,session:IccSession|undefined,closed=false;
 const check=()=>{checkExport(control);scene?.check();if(closed)throw new Error('Float file delivery is closed.');};
 try{
  scene=captured??await renderer.captureFloatScene(document,assets,{signal:control?.signal,isCancelled:()=>!!control?.signal?.aborted,onProgress:()=>{check();control?.onProgress?.({phase:'rendering',fraction:null});check();}});check();
  const prepared=await IccSession.prepareRgb(iccTarget('linear-srgb').source,originalProfile,{inputFormat:'rgba-float32',outputFormat:format,intent:settings.intent,blackPointCompensation:settings.blackPointCompensation},{signal:scene.signal,onProgress:check});session=prepared.session;check();const profile=new Uint8Array(await originalProfile.arrayBuffer());check();
  const ownedScene=scene,ownedSession=session;return{document:scene.document,profile,warnings:Object.freeze([...prepared.prepared.warnings]),check,async read(bounds){check();const native=await ownedScene.read(bounds);check();const result=await ownedSession.applyWindow(native);check();return result as FloatDeliverySamples<F>;},dispose(){if(closed)return;closed=true;ownedSession.dispose();ownedScene.dispose();}};
 }catch(error){session?.dispose();scene?.dispose();throw error;}
}

export async function exportFloatPng(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,control?:ExportControl,color?:ColorOutput):Promise<Blob>{
 const delivery=await prepareFloatDelivery(document,assets,renderer,'rgba8',control,color);let encoder:PngRowEncoder|undefined,accepted=false;
 try{
  document=delivery.document;checkExport(control);const profile=new Uint8Array(await new Response(new Blob([delivery.profile]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());checkExport(control);encoder=new PngRowEncoder(document.width,document.height,profile,'Canoli output');
  const rows=rasterExportRows(document.width);control?.onProgress?.({phase:'rendering',fraction:0});checkExport(control);
  for(let y=0;y<document.height;y+=rows){
   const height=Math.min(rows,document.height-y),strip=new Uint8Array(document.width*height*4);
   for(let x=0;x<document.width;x+=RASTER_EXPORT_COLUMNS){checkExport(control);const width=Math.min(RASTER_EXPORT_COLUMNS,document.width-x),pixels=await delivery.read({x,y,width,height});for(let row=0;row<height;row++)strip.set(pixels.subarray(row*width*4,(row+1)*width*4),(row*document.width+x)*4);await yieldTask();}
   await encoder.append(strip,height);checkExport(control);control?.onProgress?.({phase:'rendering',fraction:(y+height)/document.height});checkExport(control);
  }
  control?.onProgress?.({phase:'encoding',fraction:null});delivery.check();const result=await encoder.finish();delivery.check();accepted=true;return result;
 }finally{delivery.dispose();if(!accepted)await encoder?.abort(new Error('Float PNG export interrupted.'));}
}
