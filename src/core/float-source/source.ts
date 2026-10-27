import{z}from'zod';
import{inspectTiff}from'../interchange/tiff/inspect';
import{freeze}from'../immutable';
import{normalizeColorOutput,type ColorOutput}from'../color/color-settings';
import{iccTarget}from'../color/profile-source';
import{acquireIccOwner}from'../color/icc-client';
import{iccRgbPreparationSchema,type IccRgbPreparation}from'../color/icc-types';
import{tiffDecodeOptionsSchema,tiffFloatColorSchema,type TiffDecodeOptions,type TiffFloatColor}from'../interchange/tiff/types';
import{FloatTileRepository}from'./storage';
import{validatePixels,digest}from'./codec';
import{FloatCacheError}from'./errors';
import{descriptorKey,floatSourceDescriptorSchema,floatTileMetaSchema,tileCount,validateFloatPreparation,validateManifest,validateWindow,windowTiles,type FloatSourceInput,type FloatSourceManifest,type FloatSourceControl,type FloatSourceWindow,type FloatSourceProgress,type FloatTileMeta,type FloatEncodedTile}from'./types';
const progressSchema=z.object({phase:z.enum(['inspecting','hashing','waiting','converting','reading','cached']),fraction:z.number().min(0).max(1).nullable()}).strict();
const messages=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('progress'),progress:progressSchema}).strict(),
 z.object({kind:z.literal('descriptor'),descriptor:floatSourceDescriptorSchema,key:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal('prepared'),prepared:iccRgbPreparationSchema}).strict(),
 z.object({kind:z.literal('tile'),tile:z.object({meta:floatTileMetaSchema,blob:z.instanceof(Blob)}).strict()}).strict(),
 z.object({kind:z.literal('complete')}).strict(),
 z.object({kind:z.literal('error'),error:z.string().max(8192)}).strict(),
]);
const readResponse=z.union([z.object({id:z.number().int().positive().safe(),pixels:z.instanceof(Float32Array)}).strict(),z.object({id:z.number().int().positive().safe(),error:z.string().max(8192),corrupt:z.boolean().optional()}).strict()]);
interface Waiter{token:symbol;resolve:(v:Readonly<FloatSourceManifest>)=>void;reject:(e:unknown)=>void;progress?:(v:FloatSourceProgress)=>void;remove():void}
interface Job{abort:AbortController;waiters:Set<Waiter>;done:Promise<void>;started?:boolean}
const shared=new WeakMap<Blob,Map<string,SourceContext>>();
const cancelled=()=>new DOMException('Float source operation cancelled.','AbortError');
class SourceContext{
 private owners=new Set<symbol>();private work=new Set<{token:symbol;abort:AbortController}>();private inFlight=0;private waitingReads:{start():void}[]=[];private ready?:Readonly<FloatSourceManifest>;private job?:Job;private closed=false;
 private reader?:Worker;private readerBuildId?:string;private serial=0;private reads=new Map<number,{token:symbol;resolve:(v:Float32Array<ArrayBuffer>)=>void;reject:(e:unknown)=>void;remove():void;length:number}>();
 constructor(readonly input:FloatSourceInput,private readonly release:()=>void){}
 add(token:symbol){if(this.closed)throw new Error('Float source is closed.');this.owners.add(token);}
 private active(token:symbol){if(this.closed||!this.owners.has(token))throw new Error('Float source lease is closed.');}
 private dropWaiter(job:Job,waiter:Waiter,error?:unknown){if(!job.waiters.delete(waiter))return;waiter.remove();if(error!==undefined)waiter.reject(error);if(!job.waiters.size&&!job.abort.signal.aborted)job.abort.abort(cancelled());}
 remove(token:symbol){
  this.owners.delete(token);for(const work of this.work)if(work.token===token)work.abort.abort(new Error('Float source lease is closed.'));if(this.job)for(const w of[...this.job.waiters])if(w.token===token)this.dropWaiter(this.job,w,new Error('Float source lease is closed.'));
  for(const[id,pending]of this.reads)if(pending.token===token){this.reads.delete(id);pending.remove();pending.reject(new Error('Float source lease is closed.'));this.reader?.postMessage({kind:'cancel',id});}
  if(!this.owners.size){this.closed=true;this.job?.abort.abort(cancelled());this.reader?.terminate();this.reader=undefined;this.ready=undefined;this.release();}
 }
 prepare(token:symbol,control:FloatSourceControl={}):Promise<Readonly<FloatSourceManifest>>{
  this.active(token);control.signal?.throwIfAborted();if(this.ready){control.onProgress?.({phase:'cached',fraction:1});this.active(token);control.signal?.throwIfAborted();return Promise.resolve(this.ready);}
  let job=this.job;if(!job||job.abort.signal.aborted){job={abort:new AbortController(),waiters:new Set(),done:Promise.resolve()};this.job=job;}
  const current=job,pending=new Promise<Readonly<FloatSourceManifest>>((resolve,reject)=>{const abort=()=>this.dropWaiter(current,waiter,control.signal?.reason??cancelled()),waiter:Waiter={token,resolve,reject,progress:control.onProgress,remove:()=>control.signal?.removeEventListener('abort',abort)};current.waiters.add(waiter);control.signal?.addEventListener('abort',abort,{once:true});if(control.signal?.aborted)abort();});
  if(!current.started){current.started=true;current.done=this.run(current).then(manifest=>{if(this.job!==current||this.closed)return;this.job=undefined;this.ready=freeze(manifest);for(const w of[...current.waiters]){current.waiters.delete(w);w.remove();try{this.active(w.token);w.resolve(this.ready);}catch(error){w.reject(error);}}},error=>{if(this.job===current)this.job=undefined;for(const w of[...current.waiters]){current.waiters.delete(w);w.remove();w.reject(error);}}).finally(()=>{if(this.job===current)this.job=undefined;});void current.done.catch(()=>{});}
  return pending;
 }
 private progress(job:Job,progress:FloatSourceProgress){for(const w of[...job.waiters])try{this.active(w.token);w.progress?.(progress);}catch(error){this.dropWaiter(job,w,error);}}
 private async run(job:Job):Promise<FloatSourceManifest>{
  const signal=job.abort.signal;signal.throwIfAborted();const targetHash=await digest(new Uint8Array(await this.input.target.arrayBuffer()));signal.throwIfAborted();const repository=new FloatTileRepository(),worker=new Worker(new URL('./prepare.worker.ts',import.meta.url),{type:'module'});let release:(()=>void)|undefined,buildId:string|undefined,published=false,finished=false,removeAbort=()=>{};
  try{return await new Promise<FloatSourceManifest>((resolve,reject)=>{
   let descriptor:z.infer<typeof floatSourceDescriptorSchema>|undefined,prepared:IccRgbPreparation|undefined;const tiles:FloatTileMeta[]=[];let queue=Promise.resolve();
   const fail=(error:unknown)=>{if(finished)return;finished=true;reject(error);},complete=(manifest:FloatSourceManifest)=>{if(finished)return;signal.throwIfAborted();finished=true;resolve(manifest);},abort=()=>fail(signal.reason??cancelled());signal.addEventListener('abort',abort,{once:true});removeAbort=()=>signal.removeEventListener('abort',abort);
   const dispatch=async(raw:unknown)=>{if(finished)return;signal.throwIfAborted();const value=messages.parse(raw);
    if(value.kind==='error')throw new Error(value.error);
    if(value.kind==='progress'){this.progress(job,value.progress);return;}
    if(value.kind==='descriptor'){
     if(descriptor||value.key!==descriptorKey(value.descriptor)||value.descriptor.width!==this.input.width||value.descriptor.height!==this.input.height||value.descriptor.sourceBytes!==this.input.original.size||JSON.stringify(value.descriptor.tiff)!==JSON.stringify(this.input.tiff)||value.descriptor.intent!==this.input.intent||value.descriptor.blackPointCompensation!==this.input.blackPointCompensation||value.descriptor.sourceProfileSha256!==this.input.expectedSource.sha256||value.descriptor.targetProfileSha256!==targetHash)throw new Error('Float source descriptor differs from captured original choices.');
     descriptor=value.descriptor;let cached:FloatSourceManifest|undefined;try{cached=await repository.lookup(descriptor,signal);}catch(error){if(error instanceof FloatCacheError&&error.identity)await repository.invalidate(error.identity);throw error;}signal.throwIfAborted();if(cached){this.progress(job,{phase:'cached',fraction:1});complete(cached);return;}
     this.progress(job,{phase:'waiting',fraction:null});signal.throwIfAborted();release=await acquireIccOwner(signal);signal.throwIfAborted();buildId=crypto.randomUUID();await repository.begin(descriptor,buildId,signal);signal.throwIfAborted();worker.postMessage({kind:'continue'});return;
    }
    if(value.kind==='prepared'){if(!descriptor||!buildId||prepared)throw new Error('Unexpected float source conversion receipt.');prepared=validateFloatPreparation(descriptor,value.prepared);return;}
    if(value.kind==='tile'){if(!descriptor||!buildId||!prepared||value.tile.meta.index!==tiles.length)throw new Error('Unexpected float source tile sequence.');await repository.append(descriptor,buildId,value.tile,signal);signal.throwIfAborted();tiles.push(value.tile.meta);worker.postMessage({kind:'ack'});return;}
    if(!descriptor||!buildId||!prepared||tiles.length!==tileCount(descriptor))throw new Error('Float source completed without all verified tiles.');const manifest=validateManifest({version:1,key:descriptorKey(descriptor),buildId,descriptor,prepared,tiles},descriptor);await repository.publish(manifest,signal);published=true;complete(manifest);
   };
   worker.onmessage=event=>{queue=queue.then(()=>dispatch(event.data)).catch(fail);};worker.onerror=()=>fail(new Error('Float source worker failed. Check source/profile and available resources.'));worker.onmessageerror=()=>fail(new Error('Invalid float source worker message.'));
   worker.postMessage({kind:'start',input:this.input});
  });}finally{finished=true;removeAbort();worker.terminate();release?.();repository.dispose();if(buildId&&!published){const cleanup=new FloatTileRepository();try{await cleanup.discard(buildId);}catch{/* Unfinished derived stages remain recoverable cache data. */}finally{cleanup.dispose();}}}
 }
 private pumpReads(){while(this.inFlight<4&&this.waitingReads.length)this.waitingReads.shift()!.start();}
 private slot(signal:AbortSignal):Promise<()=>void>{signal.throwIfAborted();return new Promise((resolve,reject)=>{const cancel=()=>{const at=this.waitingReads.indexOf(entry);if(at>=0)this.waitingReads.splice(at,1);signal.removeEventListener('abort',cancel);reject(signal.reason??cancelled());this.pumpReads();},entry={start:()=>{if(signal.aborted){cancel();return;}this.inFlight++;signal.removeEventListener('abort',cancel);let done=false;resolve(()=>{if(done)return;done=true;this.inFlight--;this.pumpReads();});}};this.waitingReads.push(entry);signal.addEventListener('abort',cancel,{once:true});this.pumpReads();});}
 async read(token:symbol,input:FloatSourceWindow,control:FloatSourceControl={}):Promise<Float32Array<ArrayBuffer>>{
  this.active(token);const bounds=validateWindow(input),abort=new AbortController(),cancel=()=>abort.abort(control.signal?.reason),work={token,abort};control.signal?.addEventListener('abort',cancel,{once:true});if(control.signal?.aborted)cancel();this.work.add(work);const repository=new FloatTileRepository();let manifest:Readonly<FloatSourceManifest>|undefined,release:(()=>void)|undefined;
  try{manifest=await this.prepare(token,{...control,signal:abort.signal});this.active(token);abort.signal.throwIfAborted();release=await this.slot(abort.signal);const tiles=await repository.read(manifest as FloatSourceManifest,windowTiles(manifest.descriptor,bounds),abort.signal);this.active(token);abort.signal.throwIfAborted();control.onProgress?.({phase:'reading',fraction:0});this.active(token);abort.signal.throwIfAborted();const result=await this.readWorker(token,manifest as FloatSourceManifest,bounds,tiles,abort.signal);abort.signal.throwIfAborted();this.active(token);return result;}
  catch(error){if(manifest&&error instanceof FloatCacheError&&!abort.signal.aborted&&!this.closed&&this.owners.has(token)){this.ready=undefined;try{await repository.invalidate(manifest as FloatSourceManifest);}catch{/* Original bytes remain authoritative on storage failure. */}}throw error;}finally{release?.();control.signal?.removeEventListener('abort',cancel);this.work.delete(work);repository.dispose();}
 }
 private readWorker(token:symbol,manifest:FloatSourceManifest,bounds:FloatSourceWindow,tiles:FloatEncodedTile[],signal?:AbortSignal):Promise<Float32Array<ArrayBuffer>>{
  if(!this.reader){const worker=this.reader=new Worker(new URL('./read.worker.ts',import.meta.url),{type:'module'});const fail=(error:unknown)=>{for(const p of this.reads.values()){p.remove();p.reject(error);}this.reads.clear();worker.terminate();if(this.reader===worker){this.reader=undefined;this.readerBuildId=undefined;}};worker.onerror=()=>fail(new Error('Float tile reader failed.'));worker.onmessageerror=()=>fail(new Error('Invalid float tile reader response.'));worker.onmessage=event=>{const data=event.data;if(!Number.isSafeInteger(data?.id)||data.id<1||data.id>this.serial){fail(new Error('Invalid float tile reader response identity.'));return;}const pending=this.reads.get(data.id);if(!pending)return;this.reads.delete(data.id);pending.remove();try{const response=readResponse.parse(data);if('error'in response){if(response.corrupt)throw new FloatCacheError(response.error);throw new Error(response.error);}const pixels=response.pixels;if(!(pixels instanceof Float32Array)||!(pixels.buffer instanceof ArrayBuffer)||pixels.byteOffset!==0||pixels.byteLength!==pixels.buffer.byteLength||pixels.length!==pending.length)throw new Error('Float read result differs from requested geometry.');validatePixels(pixels);this.active(pending.token);pending.resolve(pixels as Float32Array<ArrayBuffer>);}catch(error){pending.reject(error);}};}
  const worker=this.reader,id=++this.serial;return new Promise((resolve,reject)=>{const abort=()=>{if(!this.reads.delete(id))return;signal?.removeEventListener('abort',abort);worker.postMessage({kind:'cancel',id});reject(signal?.reason??cancelled());};this.reads.set(id,{token,resolve,reject,remove:()=>signal?.removeEventListener('abort',abort),length:bounds.width*bounds.height*4});signal?.addEventListener('abort',abort,{once:true});try{signal?.throwIfAborted();worker.postMessage({id,...(this.readerBuildId===manifest.buildId?{buildId:manifest.buildId}:{manifest}),bounds,tiles});this.readerBuildId=manifest.buildId;}catch(error){this.reads.delete(id);signal?.removeEventListener('abort',abort);reject(error);}});
 }
}
/** Explicit independent lease over a retained immutable original, not a bitmap
 * borrow or public document mutation API. Closing its source store is safe. */
export class FloatRasterSource{
 private context:SourceContext|null;private readonly token=Symbol('float source lease');
 private constructor(context:SourceContext){this.context=context;context.add(this.token);}
 /** Trusted original-file source admission; no bitmap or 8-bit proxy required. */
 static async openTiff(original:Blob,tiff:TiffDecodeOptions={},output:ColorOutput={profile:'linear-srgb'},control:FloatSourceControl={}):Promise<FloatRasterSource>{
  control.signal?.throwIfAborted();if(!(original instanceof Blob))throw new Error('Choose an original TIFF Blob.');const settings=tiffDecodeOptionsSchema.parse(tiff);control.onProgress?.({phase:'inspecting',fraction:null});control.signal?.throwIfAborted();const inspection=await inspectTiff(original,()=>control.signal?.throwIfAborted()),page=inspection.pages[settings.page];control.signal?.throwIfAborted();if(!page||!page.report.canDecode||page.report.sampleFormat!==3)throw new Error('A supported original float32 TIFF page is required.');if(!page.icc&&!settings.floatColorSpace)throw new Error('Unprofiled float source requires an explicit original color interpretation.');const bytes=page.icc??new Uint8Array(await iccTarget(settings.floatColorSpace!).source.arrayBuffer()),sha256=await digest(bytes);control.signal?.throwIfAborted();const color:TiffFloatColor['source']=page.icc?{kind:'icc',sha256}:{kind:'assumed',id:settings.floatColorSpace!,sha256},owned=original.type==='image/tiff'?original:original.slice(0,original.size,'image/tiff');return FloatRasterSource.capture(owned,page.report.width,page.report.height,settings,color,output);
 }
 static capture(original:Blob,width:number,height:number,tiff:TiffDecodeOptions,color:TiffFloatColor['source'],output:ColorOutput={profile:'linear-srgb'}):FloatRasterSource{
  if(!(original instanceof Blob)||original.type!=='image/tiff'||![width,height].every(v=>Number.isSafeInteger(v)&&v>0))throw new Error('Capture a complete retained float TIFF original.');const settings=Object.freeze(tiffDecodeOptionsSchema.parse(tiff)),source=freeze(tiffFloatColorSchema.shape.source.parse(color)),target=normalizeColorOutput(output),profile=iccTarget(target.profile),key=JSON.stringify([width,height,settings,source,profile.key,target.intent,target.blackPointCompensation]);let entries=shared.get(original);if(!entries){entries=new Map();shared.set(original,entries);}let context=entries.get(key);if(!context){const input:FloatSourceInput=Object.freeze({original,target:profile.source,width,height,tiff:settings,expectedSource:source,intent:target.intent,blackPointCompensation:target.blackPointCompensation});context=new SourceContext(input,()=>{entries!.delete(key);});entries.set(key,context);}return new FloatRasterSource(context);
 }
 private owner(){if(!this.context)throw new Error('Float source lease is closed.');return this.context;}
 get original(){return this.owner().input.original;}
 get sourceColor(){return this.owner().input.expectedSource;}
 get width(){return this.owner().input.width;}
 get height(){return this.owner().input.height;}
 share(){return new FloatRasterSource(this.owner());}
 prepare(control:FloatSourceControl={}){return this.owner().prepare(this.token,control);}
 readWindow(bounds:FloatSourceWindow,control:FloatSourceControl={}){return this.owner().read(this.token,bounds,control);}
 dispose(){const context=this.context;if(!context)return;this.context=null;context.remove(this.token);}
}
