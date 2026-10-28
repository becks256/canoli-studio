import {z}from 'zod';
import {iccPreparationSchema,iccTransformOptionsSchema,nativeIccReportSchema,type IccTransformOptions,type IccPreparation,type NativeIccReport}from './icc-types';
import {iccRgbOptionsSchema,iccRgbPreparationSchema,validateIccSamples,type IccRgbOptions,type IccRgbPreparation,type IccSampleFormat,type IccSamples}from './icc-types';
export interface IccControl{signal?:AbortSignal;onProgress?:(phase:'waiting'|'preparing'|'processing')=>void}
const responseSchema=z.discriminatedUnion('kind',[
 z.object({id:z.number().int().positive(),kind:z.literal('report'),report:nativeIccReportSchema}).strict(),
 z.object({id:z.number().int().positive(),kind:z.literal('prepared'),prepared:iccPreparationSchema}).strict(),
 z.object({id:z.number().int().positive(),kind:z.literal('rgb-prepared'),prepared:iccRgbPreparationSchema}).strict(),
 z.object({id:z.number().int().positive(),kind:z.literal('pixels'),pixels:z.union([z.instanceof(Uint8ClampedArray),z.instanceof(Uint16Array),z.instanceof(Float32Array)])}).strict(),
 z.object({id:z.number().int().positive(),kind:z.literal('error'),error:z.string().max(4096)}).strict(),
]);
type Response=z.infer<typeof responseSchema>;
// At most two live native owners: e.g. one viewport proof and one file export.
// Queued operations retain immutable profile Blobs, not decoded pixel planes.
let active=0,pumping=false;const waiting:{start():void}[]=[],idleOwners=new Set<()=>void>();
const pump=()=>{
 if(pumping)return;pumping=true;
 try{while(waiting.length){
  if(active<2){waiting.shift()!.start();continue;}
  const retire=idleOwners.values().next().value;if(!retire)break;
  idleOwners.delete(retire);retire();
 }}finally{pumping=false;}
};
/** Private host cooperation: idle sessions still count against the two-owner
 * ceiling and retire before they can block queued source/profile work. */
export function registerIdleIccOwner(retire:()=>void):()=>void{
 idleOwners.add(retire);pump();return()=>{idleOwners.delete(retire);};
}
export function acquireIccOwner(signal?:AbortSignal):Promise<()=>void>{
 signal?.throwIfAborted();return new Promise((resolve,reject)=>{
  const cancel=()=>{const at=waiting.indexOf(entry);if(at>=0)waiting.splice(at,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new DOMException('ICC operation cancelled','AbortError'));pump();};
  const entry={start(){if(signal?.aborted){cancel();return;}active++;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active--;pump();});}};
  waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
 });
}
/** Private host-owned transform lifetime; never an isolated script/plugin service. */
export class IccSession{
 private closed=false;
 get isClosed(){return this.closed;}
 private serial=0;
 private rgb?:IccRgbPreparation['settings'];
 private pending?:{id:number;kind:'report'|'prepared'|'rgb-prepared'|'pixels';length?:number;format?:IccSampleFormat;resolve:(value:Response)=>void;reject:(error:unknown)=>void};
 private readonly abort=()=>this.dispose(this.control.signal?.reason??new DOMException('ICC operation cancelled','AbortError'));
 private constructor(private readonly worker:Worker,private readonly release:()=>void,private readonly control:IccControl){
  worker.onmessage=event=>{
   if(this.closed)return;
   try{
    const value=responseSchema.parse(event.data),pending=this.pending;
    if(!pending||pending.id!==value.id)throw new Error('Unexpected ICC worker response.');
    if(value.kind==='error')throw new Error(value.error);
    if(value.kind!==pending.kind)throw new Error('ICC worker response does not match its request.');
    if(value.kind==='pixels'&&(!(value.pixels.buffer instanceof ArrayBuffer)||value.pixels.byteOffset!==0||value.pixels.byteLength!==value.pixels.buffer.byteLength||value.pixels.length!==pending.length))throw new Error('ICC worker returned an invalid RGBA window.');
    if(value.kind==='pixels')validateIccSamples(value.pixels,pending.format??'rgba8');
    this.control.signal?.throwIfAborted();this.pending=undefined;pending.resolve(value);
   }catch(error){this.dispose(error);}
  };
  worker.onerror=()=>this.dispose(new Error('ICC worker failed. Check the profile, engine availability and device memory.'));
  worker.onmessageerror=()=>this.dispose(new Error('Invalid ICC worker message.'));
  control.signal?.addEventListener('abort',this.abort,{once:true});if(control.signal?.aborted)this.abort();
 }
 private async request(kind:'report'|'prepared'|'rgb-prepared'|'pixels',body:Record<string,unknown>,transfer:Transferable[]=[],length?:number,format?:IccSampleFormat):Promise<Response>{
  this.control.signal?.throwIfAborted();if(this.closed)throw new Error('ICC session is closed.');if(this.pending)throw new Error('Wait for the current ICC window before processing another.');
  const id=++this.serial;return new Promise((resolve,reject)=>{this.pending={id,kind,length,format,resolve,reject};try{this.worker.postMessage({id,...body},transfer);}catch(error){this.dispose(error);}});
 }
 static async inspect(source:Blob,control:IccControl={}):Promise<NativeIccReport>{
  if(!(source instanceof Blob)||source.size<132||source.size>0xffffffff)throw new Error('A complete ICC profile is required.');
  const session=await this.open(control);try{
   control.signal?.throwIfAborted();
   control.onProgress?.('preparing');const result=await session.request('report',{operation:'inspect',source});if(result.kind!=='report')throw new Error('Invalid ICC inspection reply.');return result.report;
  }finally{session.dispose();}
 }
 static async prepare(source:Blob,value:IccTransformOptions,control:IccControl={}):Promise<{session:IccSession;prepared:IccPreparation}>{
  if(!(source instanceof Blob)||source.size<132||source.size>0xffffffff)throw new Error('A complete ICC profile is required.');
  const settings=iccTransformOptionsSchema.parse(value),session=await this.open(control);
  try{
   control.signal?.throwIfAborted();
   control.onProgress?.('preparing');const result=await session.request('prepared',{operation:'prepare',source,settings});if(result.kind!=='prepared'||JSON.stringify(result.prepared.settings)!==JSON.stringify(settings))throw new Error('ICC worker prepared different transform settings.');return{session,prepared:result.prepared};
  }catch(error){session.dispose();throw error;}
 }
 static async prepareRgb(source:Blob,destination:Blob,value:IccRgbOptions={},control:IccControl={}):Promise<{session:IccSession;prepared:IccRgbPreparation}>{
  for(const profile of[source,destination])if(!(profile instanceof Blob)||profile.size<132||profile.size>0xffffffff)throw new Error('Complete input and output ICC profiles are required.');
  const settings=iccRgbOptionsSchema.parse(value),session=await this.open(control);
  try{
   control.signal?.throwIfAborted();control.onProgress?.('preparing');
   const result=await session.request('rgb-prepared',{operation:'prepare-rgb',source,destination,settings});
   if(result.kind!=='rgb-prepared'||JSON.stringify(result.prepared.settings)!==JSON.stringify(settings)||result.prepared.source.colorSpace!=='RGB '||result.prepared.destination.colorSpace!=='RGB ')throw new Error('ICC worker prepared a different RGB transform.');
   session.rgb={...settings};return{session,prepared:result.prepared};
  }catch(error){session.dispose();throw error;}
 }
 private static async open(control:IccControl):Promise<IccSession>{
  control.signal?.throwIfAborted();if(typeof Worker==='undefined')throw new Error('ICC processing requires the browser worker host.');
  control.onProgress?.('waiting');control.signal?.throwIfAborted();const release=await acquireIccOwner(control.signal);
  let worker:Worker|undefined;
  try{control.signal?.throwIfAborted();worker=new Worker(new URL('./icc.worker.ts',import.meta.url),{type:'module'});return new IccSession(worker,release,control);}catch(error){try{worker?.terminate();}finally{release();}throw error;}
 }
 async apply(pixels:Uint8Array|Uint8ClampedArray):Promise<Uint8ClampedArray<ArrayBuffer>>{
  if(this.rgb)throw new Error('Use applyWindow for an explicit RGB sample transform.');
  this.control.signal?.throwIfAborted();if(this.closed)throw new Error('ICC session is closed.');
  if(!(pixels instanceof Uint8Array||pixels instanceof Uint8ClampedArray)||!pixels.length||pixels.length%4||pixels.length>0x7fffffff)throw new Error('ICC conversion requires a complete nonempty RGBA8 window.');
  if(this.pending)throw new Error('Wait for the current ICC window before processing another.');
  try{
   this.control.onProgress?.('processing');this.control.signal?.throwIfAborted();const owned=new Uint8ClampedArray(pixels),result=await this.request('pixels',{operation:'apply',pixels:owned},[owned.buffer],owned.length);
   if(result.kind!=='pixels')throw new Error('Invalid ICC pixel reply.');return result.pixels as Uint8ClampedArray<ArrayBuffer>;
  }catch(error){this.dispose(error);throw error;}
 }
 async applyWindow(samples:IccSamples):Promise<IccSamples>{
  this.control.signal?.throwIfAborted();if(this.closed)throw new Error('ICC session is closed.');
  if(!this.rgb)throw new Error('Prepare an explicit RGB transform before converting sample windows.');
  validateIccSamples(samples,this.rgb.inputFormat);
  if(samples.length*(this.rgb.outputFormat==='rgba8'?1:this.rgb.outputFormat==='rgba16'?2:4)>0x7fffffff)throw new Error('ICC output window exceeds native pointer representation.');
  if(this.pending)throw new Error('Wait for the current ICC window before processing another.');
  try{
   this.control.onProgress?.('processing');this.control.signal?.throwIfAborted();
   const owned=samples.slice(),result=await this.request('pixels',{operation:'apply-window',pixels:owned},[owned.buffer],owned.length,this.rgb.outputFormat);
   if(result.kind!=='pixels')throw new Error('Invalid ICC sample reply.');return result.pixels;
  }catch(error){this.dispose(error);throw error;}
 }
 dispose(reason:unknown=new DOMException('ICC operation closed','AbortError')){
  if(this.closed)return;this.closed=true;const pending=this.pending;this.pending=undefined;
  this.worker.onmessage=null;this.worker.onerror=null;this.worker.onmessageerror=null;this.control.signal?.removeEventListener('abort',this.abort);
  try{this.worker.terminate();}catch{/* Cleanup still releases its host slot and pending caller. */}finally{this.release();pending?.reject(reason);}
 }
}
