import{validateFloatWorkerWindow}from'./float-pixels';
import{yieldTask}from'../core/task-yield';

/** Coverage interpolation of two completed backdrops, rather than source-over
 * compositing a backdrop onto itself. Used by pass-through groups/adjustments. */
export async function interpolateFloatBackdrops(before:Float32Array,after:Float32Array,opacity:number,mask:Float32Array|undefined,check:()=>void):Promise<Float32Array<ArrayBuffer>>{
 check();validateFloatWorkerWindow(before);validateFloatWorkerWindow(after);
 if(before.length!==after.length||!Number.isFinite(opacity)||opacity<0||opacity>1||mask&&mask.length!==before.length/4)throw new Error('Float backdrop interpolation geometry or opacity is invalid.');
 const output=new Float32Array(before.length);let deadline=performance.now()+2;
 for(let i=0;i<before.length;i+=4){
  const amount=opacity*(mask?mask[i/4]:1);if(!Number.isFinite(amount)||amount<0||amount>1)throw new Error('Float backdrop interpolation coverage is invalid.');
  if(amount===0)output.set(before.subarray(i,i+4),i);
  else if(amount===1)output.set(after.subarray(i,i+4),i);
  else{
   const a=before[i+3]*(1-amount),b=after[i+3]*amount,alpha=a+b;output[i+3]=alpha;
   if(alpha>0)for(let c=0;c<3;c++)output[i+c]=(before[i+c]*a+after[i+c]*b)/alpha;
  }
  if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();validateFloatWorkerWindow(output);return output;
}
