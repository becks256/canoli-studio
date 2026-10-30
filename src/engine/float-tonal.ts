import {floatTonalOptionsSchema, type FloatTonalOptions} from '../core/float-tonal';
import {validateFloatAlpha} from '../core/float-shadow';
import {yieldTask} from '../core/task-yield';
import type {PixelProcessor} from './processor';
import {validateFloatWorkerWindow} from './float-pixels';

/** Preserve the fixed coverage lattice while transferring only its nonzero
 * rectangle. Full source validation still applies to empty/neutral strokes. */
export async function applyFloatTonal(source:Float32Array,coverage:Float32Array,input:FloatTonalOptions,width:number,height:number,processor:Pick<PixelProcessor,'floatTonal'>,check:()=>void):Promise<Float32Array>{
  check();validateFloatWorkerWindow(source);validateFloatAlpha(coverage,source.length/4);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||source.length!==width*height*4)throw new Error('Float tonal coverage geometry differs.');
  const options=floatTonalOptionsSchema.parse(input),pixels=source.slice(),mask=coverage.slice();
  let left=width,top=height,right=-1,bottom=-1,deadline=performance.now()+2;
  for(let i=0;i<mask.length;i++){
    if(mask[i]!==0&&pixels[i*4+3]!==0){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if((i&1023)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
  }
  if(right<left||options.exposure===0||options.flow===0){check();return pixels;}
  const w=right-left+1,h=bottom-top+1;
  if(w===width&&h===height){const output=await processor.floatTonal(pixels,mask,options);check();return output;}
  const crop=new Float32Array(w*h*4),amount=new Float32Array(w*h);
  for(let y=0;y<h;y++){
    const start=(top+y)*width+left;crop.set(pixels.subarray(start*4,(start+w)*4),y*w*4);amount.set(mask.subarray(start,start+w),y*w);
    if(performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
  }
  check();const output=await processor.floatTonal(crop,amount,options);check();
  for(let y=0;y<h;y++)pixels.set(output.subarray(y*w*4,(y+1)*w*4),((top+y)*width+left)*4);
  return pixels;
}
