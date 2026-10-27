import{validateFloatWorkerWindow}from'./float-pixels';
import{yieldTask}from'../core/task-yield';

/** Coverage changes alpha only. Colors never pass through the coverage canvas.
 * Each authored operation rounds alpha once, rather than accumulating byte alpha. */
export async function applyFloatCoverage(pixels:Float32Array,coverage:Float32Array,check:()=>void):Promise<Float32Array<ArrayBuffer>>{
 check();validateFloatWorkerWindow(pixels);
 if(!(coverage instanceof Float32Array)||!(coverage.buffer instanceof ArrayBuffer)||('resizable'in coverage.buffer&&coverage.buffer.resizable)||('detached'in coverage.buffer&&coverage.buffer.detached)||coverage.length!==pixels.length/4)throw new Error('Float coverage differs from its working window.');
 const output=pixels.slice(),owned=coverage.slice();for(const value of owned)if(!Number.isFinite(value)||value<0||value>1)throw new Error('Float coverage is invalid.');let deadline=performance.now()+2;
 for(let i=0;i<owned.length;i++){
  output[i*4+3]*=owned[i];
  if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();return output;
}
