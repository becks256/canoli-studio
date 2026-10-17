import { selectSubjectOptionsSchema, subjectSource, type SelectSubjectOptions, type SelectSubjectControl } from '../core/subject-selection';
import { selectionSchema, transformSelection, type SelectionData } from '../core/drawing';
import { AffineTransform } from '../core/affine';
import type { DocumentData } from '../core/model';
import type { AssetStore } from '../core/assets';
import { PixelProcessor } from './processor';
import { createCanvas, release } from './canvas';
import { yieldTask } from '../core/task-yield';

export async function prepareSubject(document:DocumentData,assets:AssetStore,input:SelectSubjectOptions,
  control:SelectSubjectControl={},assertCurrent:()=>void=()=>{}):Promise<SelectionData> {
  const settings=selectSubjectOptionsSchema.parse(input),source=subjectSource(document,settings,id=>assets.get(id)),asset=assets.get(source.assetId);
  const {width,height}=source,count=width*height;
  if(!Number.isSafeInteger(count)||count*4>0x7fffffff)throw new Error('Select Subject source exceeds the native working-buffer address range.');
  const alive=assets.captureLifetime(),processor=new PixelProcessor();
  const check=()=>{control.signal?.throwIfAborted();alive();assertCurrent();if(assets.get(asset.id)!==asset)throw new Error('Select Subject source changed.');};
  const cancel=()=>processor.dispose();control.signal?.addEventListener('abort',cancel,{once:true});
  const tiles=Math.ceil(width/512)*Math.ceil(height/512),total=tiles+count*3;let completed=0;
  try{
    check();const pixels=new Uint8ClampedArray(count*4);let deadline=performance.now()+8;control.onProgress?.({completed,total});
    for(let y=0;y<height;y+=512)for(let x=0;x<width;x+=512){
      check();const w=Math.min(512,width-x),h=Math.min(512,height-y),canvas=createCanvas(w,h);
      try{
        const context=canvas.getContext('2d')!;context.drawImage(asset.bitmap,x,y,w,h,0,0,w,h);
        const data=context.getImageData(0,0,w,h).data;
        for(let row=0;row<h;row++)pixels.set(data.subarray(row*w*4,(row+1)*w*4),((y+row)*width+x)*4);
      }finally{release(canvas);}
      control.onProgress?.({completed:++completed,total});
      if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+8;}
    }
    check();const selection=await processor.selectSubject(pixels,{width,height,threshold:settings.threshold,expandRadius:settings.expandRadius},value=>{
      try{check();control.onProgress?.({completed:tiles+value.completed,total});}catch{processor.dispose();}
    });
    check();return selectionSchema.parse(transformSelection(selection,AffineTransform.fromJSON(source.transform)));
  }catch(error){check();throw error;}
  finally{control.signal?.removeEventListener('abort',cancel);processor.dispose();}
}
