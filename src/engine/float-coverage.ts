import{validateFloatWorkerWindow}from'./float-pixels';
import{yieldTask}from'../core/task-yield';

/** Intrinsic shadow shape, before own Fill/appearance/opacity. */
export async function floatAlphaPlane(pixels:Float32Array,coverage:Float32Array|undefined,check:()=>void){
 check();validateFloatWorkerWindow(pixels);if(coverage&&coverage.length!==pixels.length/4)throw new Error('Float silhouette coverage geometry differs.');const output=new Float32Array(pixels.length/4);let deadline=performance.now()+2;
 for(let i=0;i<output.length;i++){
  const amount=coverage?coverage[i]:1;if(!Number.isFinite(amount)||amount<0||amount>1)throw new Error('Float silhouette coverage is invalid.');output[i]=pixels[i*4+3]*amount;
  if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();return output;
}
/** Prepare foreground alpha once, keeping own Fill separate from the shadow. */
export async function fillFloatCoverage(pixels:Float32Array,coverage:Float32Array|undefined,fill:number,check:()=>void){
 check();validateFloatWorkerWindow(pixels);if(!Number.isFinite(fill)||fill<0||fill>1||coverage&&coverage.length!==pixels.length/4)throw new Error('Float foreground coverage or Fill is invalid.');if(!coverage&&fill===1)return pixels;
 const output=pixels.slice();let deadline=performance.now()+2;
 for(let i=0;i<output.length;i+=4){const mask=coverage?coverage[i/4]:1;if(!Number.isFinite(mask)||mask<0||mask>1)throw new Error('Float foreground mask is invalid.');output[i+3]=pixels[i+3]*mask*fill;if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}}
 check();return output;
}

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
