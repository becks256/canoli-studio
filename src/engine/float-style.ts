import type{LayerData}from'../core/model';
import type{PixelProcessor}from'./processor';
import{yieldTask}from'../core/task-yield';

/** Apply appearance to completed layer colors; leave alpha and the original
 * backdrop intact. Mask/fill/layer opacity belong to the following composite. */
export async function applyFloatStyle(layer:LayerData,pixels:Float32Array,backdrop:Float32Array,mask:Float32Array|undefined,processor:Pick<PixelProcessor,'floatStyle'>,check:()=>void){
 const style=layer.styles;
 if(!style||!style.blendIf.enabled&&(!style.colorOverlay.enabled||style.colorOverlay.opacity===0))return{pixels,mask};
 check();const result=await processor.floatStyle(pixels,backdrop,style);check();
 if(!style.blendIf.enabled)return{pixels:result.pixels,mask};
 const coverage=result.coverage;
 if(mask){
  if(mask.length!==coverage.length)throw new Error('Float style mask geometry differs.');
  let deadline=performance.now()+2;
  for(let i=0;i<coverage.length;i++){
   coverage[i]*=mask[i];
   if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
  }
 }
 check();return{pixels:result.pixels,mask:coverage};
}
