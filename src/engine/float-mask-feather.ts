import {z} from 'zod';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {validateFloatAlpha} from '../core/float-shadow';
import type {PixelProcessor} from './processor';
import {yieldTask} from '../core/task-yield';

/** Native document-pixel feather, evaluated after geometry projection. Every
 * source/convolution band includes its complete halo within the alpha budget.
 * The caller supplies the infinite background through its source callback. */
export async function featherFloatMask(
  input:FloatSourceWindow,feather:number,read:(bounds:FloatSourceWindow)=>Promise<Float32Array>,
  processor:Pick<PixelProcessor,'floatConvolveAlpha'>,check:()=>void,
):Promise<Float32Array<ArrayBuffer>> {
  check();const bounds=validateWindow(input),radius=z.number().finite().min(0).max(128).parse(feather)/3,support=Math.ceil(radius),halo=3*support;
  const output=new Float32Array(bounds.width*bounds.height);
  if(support===0){const alpha=await read({...bounds});check();validateFloatAlpha(alpha,output.length);output.set(alpha);return output;}
  const edge=512-2*halo;let deadline=performance.now()+2;
  for(let ty=0;ty<bounds.height;ty+=edge)for(let tx=0;tx<bounds.width;tx+=edge){
    check();const width=Math.min(edge,bounds.width-tx),height=Math.min(edge,bounds.height-ty),x=bounds.x+tx,y=bounds.y+ty;
    let w=width+2*halo,h=height+2*halo;
    let alpha=await read(validateWindow({x:x-halo,y:y-halo,width:w,height:h}));check();validateFloatAlpha(alpha,w*h);
    // Validate the entire halo before omitting constant-field convolution.
    if(alpha.every(value=>value===alpha[0]))alpha=new Float32Array(width*height).fill(alpha[0]);
    else for(let pass=0;pass<3;pass++)for(const axis of ['horizontal','vertical'] as const){
      alpha=await processor.floatConvolveAlpha(alpha,{width:w,height:h,kernel:'box',radius,axis});check();
      if(axis==='horizontal')w-=2*support;else h-=2*support;
      validateFloatAlpha(alpha,w*h);
    }
    check();validateFloatAlpha(alpha,width*height);
    for(let row=0;row<height;row++)output.set(alpha.subarray(row*width,(row+1)*width),(ty+row)*bounds.width+tx);
    if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+2;}
  }
  check();return output;
}
