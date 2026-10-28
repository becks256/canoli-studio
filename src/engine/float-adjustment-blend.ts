import type{BlendMode}from'../core/model';
import type{PixelProcessor}from'./processor';
import{validateFloatWorkerWindow}from'./float-pixels';
import{interpolateFloatBackdrops}from'./float-interpolate';
import{yieldTask}from'../core/task-yield';

/** Adjustment blending changes backdrop colors without compositing its alpha
 * onto itself. Artistic blend colors use the existing normalized native domain. */
export async function blendFloatAdjustment(before:Float32Array,after:Float32Array,mode:BlendMode,opacity:number,mask:Float32Array|undefined,processor:Pick<PixelProcessor,'floatComposite'>,check:()=>void):Promise<Float32Array<ArrayBuffer>>{
 if(mode==='normal')return interpolateFloatBackdrops(before,after,opacity,mask,check);
 check();validateFloatWorkerWindow(before);validateFloatWorkerWindow(after);
 if(before.length!==after.length)throw new Error('Float adjustment blend geometry differs.');
 const source=after.slice(),backdrop=before.slice();let deadline=performance.now()+2;
 for(let i=3;i<source.length;i+=4){
  if(before[i]!==after[i])throw new Error('A float adjustment must preserve backdrop alpha.');
  source[i]=backdrop[i]=1;
  if((i&127)===3&&performance.now()>=deadline){check();await yieldTask();check();deadline=performance.now()+2;}
 }
 check();const colors=await processor.floatComposite(source,backdrop,{mode});check();validateFloatWorkerWindow(colors);
 if(colors.length!==before.length)throw new Error('Float adjustment blend result geometry differs.');
 for(let i=3;i<colors.length;i+=4){if(colors[i]!==1)throw new Error('Float adjustment blend did not return opaque blend colors.');colors[i]=before[i];}
 return interpolateFloatBackdrops(before,colors,opacity,mask,check);
}
