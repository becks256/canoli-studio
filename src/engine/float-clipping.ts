import{validateFloatWorkerWindow}from'./float-pixels';
import{yieldTask}from'../core/task-yield';

/** Owned straight color plane plus pre-fill intrinsic shape. Every member is
 * painted before shape is restored once, preventing repeated soft-edge loss. */
export async function prepareFloatClipping(base:Float32Array,fillOpacity:number,check:()=>void){
 check();validateFloatWorkerWindow(base);if(!Number.isFinite(fillOpacity)||fillOpacity<0||fillOpacity>1)throw new Error('Float clipping fill opacity is invalid.');
 const plane=base.slice(),shape=new Float32Array(base.length/4);let deadline=performance.now()+2;
 for(let i=0;i<plane.length;i+=4){
  const alpha=plane[i+3];shape[i/4]=alpha;plane[i+3]=alpha>0?fillOpacity:0;
  if(alpha===0)plane.fill(0,i,i+3);
  if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();return{plane,shape};
}
/** Restore intrinsic shape without quantizing colors. Base mask and opacity
 * belong to the later external composite, not to individual clipped members. */
export async function restoreFloatClipping(plane:Float32Array,shape:Float32Array,check:()=>void):Promise<Float32Array<ArrayBuffer>>{
 check();validateFloatWorkerWindow(plane);
 if(!(shape instanceof Float32Array)||!(shape.buffer instanceof ArrayBuffer)||('resizable'in shape.buffer&&shape.buffer.resizable)||('detached'in shape.buffer&&shape.buffer.detached)||shape.length!==plane.length/4)throw new Error('Float clipping shape differs from its working window.');
 const output=plane.slice(),coverage=shape.slice();for(const alpha of coverage)if(!Number.isFinite(alpha)||alpha<0||alpha>1)throw new Error('Float clipping shape is invalid.');let deadline=performance.now()+2;
 for(let i=0;i<output.length;i+=4){
  output[i+3]*=coverage[i/4];if(output[i+3]===0)output.fill(0,i,i+3);
  if((i&127)===0&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();validateFloatWorkerWindow(output);return output;
}
