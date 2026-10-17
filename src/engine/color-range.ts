import { colorRangeOptionsSchema, type ColorRangeOptions, type ColorRangeControl } from '../core/color-range';
import { SelectionRows } from '../core/selection-rows';
import type { DocumentData } from '../core/model';
import { createRaster } from '../core/model';
import type { AssetStore } from '../core/assets';
import { retouchViewDocument } from './retouch-sampling';
import { CanvasRenderer, workingSize } from './renderer';
import { PixelProcessor } from './processor';
import { release } from './canvas';
import type { SelectionData } from '../core/drawing';

export function colorRangeSource(document:DocumentData,assets:AssetStore,options:ColorRangeOptions):DocumentData {
  return selectionSourceDocument(document,assets,colorRangeOptionsSchema.parse(options).source);
}
export function selectionSourceDocument(document:DocumentData,assets:AssetStore,source:import('../core/color-range').ColorRangeSettings['source']):DocumentData {
  if(source.kind==='layer')return {...retouchViewDocument(document,{mode:'current-layer',layerId:source.layerId}),selection:null};
  if(source.kind==='asset'){
    const asset=assets.get(source.assetId);
    if(!Number.isSafeInteger(source.x+asset.width)||!Number.isSafeInteger(source.y+asset.height))throw new Error('Color Range source bounds exceed safe integer placement.');
    return {...document,selection:null,children:[{...createRaster('Color Range source',source.assetId,asset.width,asset.height),x:source.x,y:source.y}]};
  }
  return {...document,selection:null};
}

/** Dedicated renderer/worker; every final source sample is a native document pixel. */
export async function prepareColorRange(document:DocumentData,assets:AssetStore,input:ColorRangeOptions,control:ColorRangeControl={},assertCurrent:()=>void=()=>{}):Promise<SelectionData> {
  const settings=colorRangeOptionsSchema.parse(input),source=colorRangeSource(document,assets,settings);
  const renderer=new CanvasRenderer(),processor=new PixelProcessor(),alive=assets.captureLifetime();
  const sourceAsset=settings.source.kind==='asset'?assets.get(settings.source.assetId):null;
  const check=()=>{control.signal?.throwIfAborted();alive();assertCurrent();if(sourceAsset&&assets.get(sourceAsset.id)!==sourceAsset)throw new Error('Color Range source asset changed.');};
  const abort=()=>{processor.dispose();renderer.dispose();};control.signal?.addEventListener('abort',abort,{once:true});
  try{
    check();const {width,height}=document,rows=new SelectionRows({x:0,y:0,width,height});
    const bandHeight=Math.max(1,Math.min(512,Math.floor(4_000_000/width))),total=Math.ceil(width/512)*Math.ceil(height/bandHeight);let completed=0;
    control.onProgress?.({completed,total});
    for(let y=0;y<height;y+=bandHeight){
      const h=Math.min(bandHeight,height-y),band=new Uint8Array(width*h);
      for(let x=0;x<width;x+=512){
        check();const w=Math.min(512,width-x),canvas=await renderer.render(source,assets,{region:{x,y,width:w,height:h},outputSize:{width:w,height:h},cache:false,readback:true,isCancelled:()=>!!control.signal?.aborted});
        let alpha:Uint8Array;
        try{check();if(canvas.width!==w||canvas.height!==h)throw new Error('Color Range requires native-resolution source tiles.');alpha=await processor.colorRange(canvas.getContext('2d')!.getImageData(0,0,w,h).data,settings);}
        finally{release(canvas);}
        check();if(alpha.length!==w*h)throw new Error('Invalid Color Range worker coverage.');
        for(let row=0;row<h;row++)band.set(alpha.subarray(row*w,(row+1)*w),row*width+x);
        control.onProgress?.({completed:++completed,total});
      }
      await rows.append(band,check);
    }
    check();return rows.finish();
  }catch(error){check();throw error;}
  finally{control.signal?.removeEventListener('abort',abort);processor.dispose();renderer.dispose();}
}

export interface ColorRangePreview {width:number;height:number;pixels:Uint8ClampedArray;coverage:Uint8Array}
export async function sampleColorRange(document:DocumentData,assets:AssetStore,input:ColorRangeOptions,point:{x:number;y:number},signal:AbortSignal):Promise<string> {
  if(!Number.isInteger(point.x)||!Number.isInteger(point.y)||point.x<0||point.y<0||point.x>=document.width||point.y>=document.height)throw new Error('Choose a point inside the canvas.');
  const source=colorRangeSource(document,assets,input),renderer=new CanvasRenderer(),alive=assets.captureLifetime();
  const abort=()=>renderer.dispose();signal.addEventListener('abort',abort,{once:true});
  try{
    signal.throwIfAborted();const canvas=await renderer.render(source,assets,{region:{...point,width:1,height:1},outputSize:{width:1,height:1},cache:false,readback:true,isCancelled:()=>signal.aborted});
    try{signal.throwIfAborted();alive();const pixel=canvas.getContext('2d')!.getImageData(0,0,1,1).data;if(!pixel[3])throw new Error('Choose a visible source pixel.');return '#'+Array.from(pixel.slice(0,3),value=>value.toString(16).padStart(2,'0')).join('');}
    finally{release(canvas);}
  }finally{signal.removeEventListener('abort',abort);renderer.dispose();}
}
/** Bounded display proxy only; final preparation above never reuses its coverage. */
export async function previewColorRange(document:DocumentData,assets:AssetStore,input:ColorRangeOptions,signal:AbortSignal):Promise<ColorRangePreview> {
  const settings=colorRangeOptionsSchema.parse(input),source=colorRangeSource(document,assets,settings),renderer=new CanvasRenderer(),processor=new PixelProcessor();
  const alive=assets.captureLifetime(),size=workingSize(document.width,document.height,1,512*512,512);
  const abort=()=>{processor.dispose();renderer.dispose();};signal.addEventListener('abort',abort,{once:true});
  try{
    signal.throwIfAborted();const canvas=await renderer.render(source,assets,{outputSize:size,cache:false,readback:true,isCancelled:()=>signal.aborted});
    let pixels:Uint8ClampedArray;try{if(canvas.width!==size.width||canvas.height!==size.height)throw new Error('Color Range preview geometry is unavailable.');pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;}finally{release(canvas);}
    const coverage=await processor.colorRange(pixels,settings);
    if(settings.operation!=='replace'){
      const previous=await processor.selection({selection:document.selection??{regions:[]},width:size.width,height:size.height,x:0,y:0,stepX:document.width/size.width,stepY:document.height/size.height});
      for(let i=0;i<coverage.length;i++){
        const a=previous[i*4+3],b=coverage[i];
        coverage[i]=Math.round(settings.operation==='add'?Math.max(a,b):settings.operation==='subtract'?a*(1-b/255):Math.min(a,b));
      }
    }
    signal.throwIfAborted();alive();return{...size,pixels,coverage};
  }finally{signal.removeEventListener('abort',abort);processor.dispose();renderer.dispose();}
}
