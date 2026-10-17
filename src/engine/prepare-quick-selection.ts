import { quickSelectionOptionsSchema, type QuickSelectionOptions, type QuickSelectionControl } from '../core/quick-selection';
import { selectionSchema, type SelectionData } from '../core/drawing';
import type { DocumentData } from '../core/model';
import type { AssetStore } from '../core/assets';
import { selectionSourceDocument } from './color-range';
import { CanvasRenderer } from './renderer';
import { PixelProcessor } from './processor';
import { release } from './canvas';
import { yieldTask } from '../core/task-yield';

/** Bounded source readback; connectivity retains a native plane in its private worker. */
export async function prepareQuickSelection(document:DocumentData,assets:AssetStore,input:QuickSelectionOptions,control:QuickSelectionControl={},assertCurrent:()=>void=()=>{}):Promise<SelectionData>{
  const settings=quickSelectionOptionsSchema.parse(input),source=selectionSourceDocument(document,assets,settings.source);
  const {width,height}=document,count=width*height;
  if(!Number.isSafeInteger(count)||count*4>0x7fffffff)throw new Error('Quick Selection source exceeds the native working-buffer address range.');
  const renderer=new CanvasRenderer(),processor=new PixelProcessor(),alive=assets.captureLifetime();
  const asset=settings.source.kind==='asset'?assets.get(settings.source.assetId):null;
  const check=()=>{control.signal?.throwIfAborted();alive();assertCurrent();if(asset&&assets.get(asset.id)!==asset)throw new Error('Quick Selection source asset changed.');};
  const cancel=()=>{renderer.dispose();processor.dispose();};control.signal?.addEventListener('abort',cancel,{once:true});
  const tiles=Math.ceil(width/512)*Math.ceil(height/512),total=tiles+count*2;let completed=0;
  try{
    check();const pixels=new Uint8ClampedArray(count*4);control.onProgress?.({completed,total});let deadline=performance.now()+8;
    for(let y=0;y<height;y+=512)for(let x=0;x<width;x+=512){
      check();const w=Math.min(512,width-x),h=Math.min(512,height-y),canvas=await renderer.render(source,assets,{region:{x,y,width:w,height:h},outputSize:{width:w,height:h},cache:false,readback:true,isCancelled:()=>!!control.signal?.aborted});
      try{
        check();if(canvas.width!==w||canvas.height!==h)throw new Error('Quick Selection requires native-resolution source tiles.');
        const data=canvas.getContext('2d')!.getImageData(0,0,w,h).data;
        for(let row=0;row<h;row++)pixels.set(data.subarray(row*w*4,(row+1)*w*4),((y+row)*width+x)*4);
      }finally{release(canvas);}
      control.onProgress?.({completed:++completed,total});
      if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+8;}
    }
    renderer.dispose();check();
    const result=await processor.quickSelection(pixels,{...settings,x:0,y:0,width,height},progress=>{
      try{check();control.onProgress?.({completed:tiles+progress.completed,total});}catch{processor.dispose();}
    });
    check();return selectionSchema.parse(result);
  }catch(error){check();throw error;}
  finally{control.signal?.removeEventListener('abort',cancel);renderer.dispose();processor.dispose();}
}
