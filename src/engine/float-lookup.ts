import{compileFloatLookup}from'../core/float-lookup';
import type{LutAdjustmentData}from'../core/lut';
import{forkPixelKernel,type PixelKernel}from'./wasm';
import{validateFloatWorkerWindow}from'./float-pixels';

const WINDOW=65536;
interface CapturedLookup{settings:LutAdjustmentData;values:Float32Array;identity:boolean}
interface ActiveTable{capacity:number;data:string;kernel:PixelKernel;table:number;params:number;source:number;output:number}
/** Private worker owner. Captured handles retain immutable validated controls;
 * decoded read-only values live until release, beyond the shared byte cache budget.
 * Only one native table is resident, separate from other float pixel memory. */
export class FloatLookupProcessor{
 private entries=new Map<number,CapturedLookup>();private active:ActiveTable|null=null;private sequence=0;private closed=false;
 constructor(private seed:PixelKernel){}
 private current(){if(this.closed)throw new Error('Float lookup processor is disposed.');}
 private install(data:string,values:Float32Array){
  if(this.active?.data===data)return this.active;
  if(this.active&&values.byteLength<=this.active.capacity){
   // The worker serializes native calls. Replacing a fully validated table can
   // reuse this private allocation; offsets stay behind its retained capacity.
   // Prepare all JS wrappers before writing so an allocation failure retains
   // the previous table/metadata association.
   const next={...this.active,data},target=new Float32Array(next.kernel.memory.buffer,next.table,values.length);target.set(values);this.active=next;return next;
  }
  const kernel=forkPixelKernel(this.seed);if(typeof kernel.lookupFloat!=='function')throw new Error('Float lookup kernel export is unavailable.');
  const params=Math.ceil(kernel.bufferOffset()/8)*8,table=params+64,source=Math.ceil((table+values.byteLength)/8)*8,output=source+WINDOW*16,required=output+WINDOW*16;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Float32Array(kernel.memory.buffer,table,values.length).set(values);
  // Publish only after successful full allocation/copy; failed preparation does
  // not poison the previously captured table or handles.
  return this.active={capacity:values.byteLength,data,kernel,params,table,source,output};
 }
 prepare(input:LutAdjustmentData):number{
  this.current();const{settings,values,identity}=compileFloatLookup(input);this.install(settings.lut.data,values);
  if(!Number.isSafeInteger(this.sequence+1))throw new Error('Float lookup handle space is exhausted.');const handle=++this.sequence;this.entries.set(handle,{settings,values,identity});return handle;
 }
 apply(handle:number,pixels:Float32Array):Float32Array<ArrayBuffer>{
  this.current();if(!Number.isSafeInteger(handle)||handle<=0)throw new Error('Invalid captured float lookup handle.');const entry=this.entries.get(handle);if(!entry)throw new Error('Captured float lookup is unavailable or released.');validateFloatWorkerWindow(pixels);
  const{lut,amount,interpolation}=entry.settings,active=this.active?.data===lut.data?this.active:this.install(lut.data,entry.values),result=new Float32Array(pixels.length);
  new Float64Array(active.kernel.memory.buffer,active.params,7).set([...lut.domainMin,...lut.domainMax,amount]);
  for(let at=0;at<pixels.length;at+=WINDOW*4){
   const count=Math.min(WINDOW,(pixels.length-at)/4);new Float32Array(active.kernel.memory.buffer,active.source,count*4).set(pixels.subarray(at,at+count*4));
   const status=active.kernel.lookupFloat(active.source,active.output,active.table,active.params,count,lut.size,lut.dimension,interpolation==='tetrahedral',entry.identity);
   if(status===1)throw new Error('Float lookup source or controls are invalid.');if(status!==0)throw new Error('Float lookup output is not finite float32.');result.set(new Float32Array(active.kernel.memory.buffer,active.output,count*4),at);
  }
  return result;
 }
 release(handle:number):void{
  this.current();if(!Number.isSafeInteger(handle)||handle<=0)throw new Error('Invalid captured float lookup handle.');this.entries.delete(handle);
  if(this.active){
   let referenced=false,largest=0;
   for(const entry of this.entries.values()){const lut=entry.settings.lut;if(lut.data===this.active.data)referenced=true;largest=Math.max(largest,3*(lut.dimension===1?lut.size:lut.size**3)*4);}
   if(!referenced||this.active.capacity>32*1024*1024&&largest<this.active.capacity/2)this.active=null;
  }
 }
 dispose(){this.entries.clear();this.active=null;this.closed=true;}
}
