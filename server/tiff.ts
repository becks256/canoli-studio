import {Worker} from 'node:worker_threads';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setImmediate as yieldNode} from 'node:timers/promises';
import {z} from 'zod';
import {FloatRasterSource} from '../src/core/float-source/source';
import {describeFloatSource} from '../src/core/float-source/prepare';
import {freeze} from '../src/core/immutable';
import {validatePixels} from '../src/core/float-source/codec';
import {FloatCacheError} from '../src/core/float-source/errors';
import {floatSourceDescriptorSchema,floatTileMetaSchema,validateTileMeta,validateManifest,validateFloatPreparation,validateWindow,descriptorKey,tileCount,FLOAT_TILE_BATCH_SIZE,FLOAT_SOURCE_NATIVE_SHA,type FloatSourceInput,type FloatSourceManifest,type FloatEncodedTile,type FloatSourceWindow,type FloatSourceControl} from '../src/core/float-source/types';
import {tiffDecodeOptionsSchema,tiffFloatColorSchema,tiffReportSchema,type TiffDecodeOptions,type TiffFloatColor,type TiffImportReport} from '../src/core/interchange/tiff/types';
import {iccTarget} from '../src/core/color/profile-source';
import type {ImageAsset} from '../src/core/assets';
import {openPngRows} from './png-rows';

const progressSchema=z.object({phase:z.enum(['inspecting','hashing','waiting','converting','reading','cached']),fraction:z.number().min(0).max(1).nullable()}).strict();
class Slots{
  private busy=false;private waiting:{start():void}[]=[];
  private pump(){if(!this.busy)this.waiting.shift()?.start();}
  acquire(signal?:AbortSignal):Promise<()=>void>{
    signal?.throwIfAborted();return new Promise((resolve,reject)=>{
      const cancel=()=>{const at=this.waiting.indexOf(entry);if(at>=0)this.waiting.splice(at,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('Native TIFF work cancelled.'));this.pump();};
      const entry={start:()=>{if(signal?.aborted){cancel();return;}this.busy=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;this.busy=false;this.pump();});}};
      this.waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else this.pump();
    });
  }
}
const preparationSlots=new Slots();
async function hashOriginal(blob:Blob,signal?:AbortSignal,progress?:(fraction:number)=>void){
  const hash=createHash('sha256'),reader=blob.stream().getReader();let used=0,deadline=performance.now()+4;
  try{while(true){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;hash.update(part.value);used+=part.value.length;progress?.(used/blob.size);if(performance.now()>=deadline){await yieldNode();signal?.throwIfAborted();deadline=performance.now()+4;}}signal?.throwIfAborted();return hash.digest('hex');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** One real reader worker per server, bounded decoded cache and serialized jobs.
 * Cancelling a waiter does not kill another source's accepted read. */
class TiffReadPool{
  private slots=new Slots();private worker?:Worker;private serial=0;private lastSource='';
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void;remove():void;progress?:FloatSourceControl['onProgress']}>();private closed=false;
  private owner(){
    if(this.closed)throw new Error('Native TIFF reader is closed.');if(this.worker)return this.worker;
    const worker=this.worker=new Worker(new URL('./tiff-window-worker.mjs',import.meta.url),{execArgv:[]});
    const fail=(error:unknown)=>{if(this.worker!==worker)return;this.worker=undefined;this.lastSource='';for(const task of this.pending.values()){task.remove();task.reject(error);}this.pending.clear();void worker.terminate();};
    worker.once('error',fail);worker.once('exit',code=>fail(new Error(`Native TIFF reader closed (${code}).`)));
    worker.on('message',value=>{
      if(!Number.isSafeInteger(value?.id)||value.id<1||value.id>this.serial){fail(new Error('Invalid native TIFF reader reply identity.'));return;}
      const task=this.pending.get(value.id);if(!task)return;
      if(value.progress){try{const data=z.object({id:z.number().int().positive(),progress:progressSchema}).strict().parse(value);if(data.progress.phase!=='reading')throw new Error('Unexpected native TIFF reader progress.');task.progress?.(data.progress);}catch(error){if(this.pending.delete(value.id)){task.remove();task.reject(error);worker.postMessage({kind:'cancel',id:value.id});}}return;}
      this.pending.delete(value.id);task.remove();
      if(typeof value.error==='string')task.reject(value.corrupt?new FloatCacheError(value.error):new Error(value.error));else task.resolve(value);
    });return worker;
  }
  private request(message:Record<string,unknown>,signal?:AbortSignal,onProgress?:FloatSourceControl['onProgress']){
    const worker=this.owner(),id=++this.serial;
    return new Promise<unknown>((resolve,reject)=>{
      const cancel=()=>{if(!this.pending.delete(id))return;signal?.removeEventListener('abort',cancel);worker.postMessage({kind:'cancel',id});reject(signal?.reason??new Error('Native TIFF read cancelled.'));};
      this.pending.set(id,{resolve,reject,remove:()=>signal?.removeEventListener('abort',cancel),progress:onProgress});signal?.addEventListener('abort',cancel,{once:true});
      try{signal?.throwIfAborted();worker.postMessage({...message,id});}catch(error){this.pending.delete(id);signal?.removeEventListener('abort',cancel);this.lastSource='';reject(error);}
    });
  }
  async verify(descriptor:FloatSourceManifest['descriptor'],tiles:FloatEncodedTile[],signal?:AbortSignal){
    const release=await this.slots.acquire(signal);
    try{const value=z.object({id:z.number().int().positive(),verified:z.array(floatTileMetaSchema).min(1).max(FLOAT_TILE_BATCH_SIZE)}).strict().parse(await this.request({kind:'verify',descriptor,tiles},signal));signal?.throwIfAborted();if(JSON.stringify(value.verified)!==JSON.stringify(tiles.map(tile=>tile.meta)))throw new Error('Native TIFF verifier returned different tile identities.');}
    finally{release();}
  }
  async read(directory:string,manifest:Readonly<FloatSourceManifest>,input:FloatSourceWindow,signal?:AbortSignal,onProgress?:FloatSourceControl['onProgress']){
    const bounds=validateWindow(input),release=await this.slots.acquire(signal);
    try{
      this.owner();const key=directory+':'+manifest.buildId,include=this.lastSource!==key;this.lastSource=key;
      const value=z.object({id:z.number().int().positive(),pixels:z.instanceof(Float32Array)}).strict().parse(await this.request({kind:'read',directory,buildId:manifest.buildId,bounds,...(include?{manifest}:{})},signal,onProgress));
      signal?.throwIfAborted();validatePixels(value.pixels);if(value.pixels.length!==bounds.width*bounds.height*4||value.pixels.byteOffset!==0||value.pixels.byteLength!==value.pixels.buffer.byteLength)throw new Error('Native TIFF read result differs from requested geometry.');return value.pixels as Float32Array<ArrayBuffer>;
    }catch(error){this.lastSource='';throw error;}finally{release();}
  }
  async dispose(){if(this.closed)return;this.closed=true;for(const task of this.pending.values()){task.remove();task.reject(new Error('Native TIFF reader is closed.'));}this.pending.clear();const worker=this.worker;this.worker=undefined;this.lastSource='';if(worker)await worker.terminate();}
}

export class ServerTiffSource{
  private closed=false;private slots=new Slots();private invalid=false;
  private cache:{manifest:Readonly<FloatSourceManifest>;preview:Blob;color:Readonly<TiffFloatColor>;report:Readonly<TiffImportReport>;directory:string};
  constructor(readonly original:Blob,manifest:Readonly<FloatSourceManifest>,preview:Blob,color:Readonly<TiffFloatColor>,report:Readonly<TiffImportReport>,directory:string,private readonly owner:ServerTiffService){this.cache={manifest,preview,color,report,directory};}
  get manifest(){return this.cache.manifest;}get preview(){return this.cache.preview;}get color(){return this.cache.color;}get report(){return this.cache.report;}get directory(){return this.cache.directory;}
  check(){if(this.closed)throw new Error('Native TIFF source is closed.');}
  async readWindow(input:FloatSourceWindow,control:FloatSourceControl={}){
    this.check();const bounds=validateWindow(input),captured={signal:control.signal,onProgress:control.onProgress},release=await this.slots.acquire(captured.signal);
    try{this.check();if(this.invalid)await this.owner.repair(this,captured);this.check();const value=await this.owner.read(this,bounds,captured);this.check();return value;}
    catch(error){if(error instanceof FloatCacheError)this.invalid=true;throw error;}finally{release();}
  }
  async dispose(){if(this.closed)return;this.closed=true;await this.owner.release(this);}
  /** @internal Only a complete independently verified rebuild can replace files. */
  adopt(replacement:ServerTiffSource){
    this.check();replacement.check();
    if(this.original!==replacement.original||JSON.stringify(this.manifest.descriptor)!==JSON.stringify(replacement.manifest.descriptor)||JSON.stringify(this.color)!==JSON.stringify(replacement.color)||JSON.stringify(this.report)!==JSON.stringify(replacement.report))throw new Error('Native TIFF repair changed the captured original or color interpretation.');
    const previous=this.cache;this.cache=replacement.cache;this.invalid=false;replacement.closed=true;return previous.directory;
  }
}

/** Immutable originals and actual native receipts are authoritative; private
 * file tiles are disposable derivatives, independent of the browser database. */
export class ServerTiffService{
  private reader=new TiffReadPool();private sources=new Set<ServerTiffSource>();private bound=new WeakMap<ImageAsset,ServerTiffSource>();private owners=new Map<string,Set<ServerTiffSource>>();
  private controllers=new Set<AbortController>();private jobs=new Set<Promise<void>>();private closed=false;
  constructor(private readonly cacheDirectory=tmpdir()){}
  private scope(control:FloatSourceControl){
    if(this.closed)throw new Error('Native TIFF service is closed.');const signal=control.signal,onProgress=control.onProgress;signal?.throwIfAborted();const abort=new AbortController(),cancel=()=>abort.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});this.controllers.add(abort);
    let finish!:()=>void;const job=new Promise<void>(resolve=>{finish=resolve;});this.jobs.add(job);
    return{signal:abort.signal,done:()=>{signal?.removeEventListener('abort',cancel);this.controllers.delete(abort);this.jobs.delete(job);finish();},progress:(value:Parameters<NonNullable<FloatSourceControl['onProgress']>>[0])=>{abort.signal.throwIfAborted();onProgress?.(value);abort.signal.throwIfAborted();}};
  }
  async inspect(original:Blob,control:FloatSourceControl={}):Promise<TiffImportReport>{
    const scope=this.scope(control);let stopped:Promise<number>|undefined,release:(()=>void)|undefined;
    try{
      scope.progress({phase:'waiting',fraction:null});release=await preparationSlots.acquire(scope.signal);scope.progress({phase:'inspecting',fraction:null});
      return await new Promise((resolve,reject)=>{
        const worker=new Worker(new URL('./tiff-native-worker.mjs',import.meta.url),{workerData:{mode:'inspect',original},execArgv:[]});let settled=false;
        const finish=(error?:unknown,value?:TiffImportReport)=>{if(settled)return;settled=true;scope.signal.removeEventListener('abort',cancel);stopped??=worker.terminate();error?reject(error):resolve(value!);},cancel=()=>finish(scope.signal.reason??new Error('Native TIFF inspection cancelled.'));
        scope.signal.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Native TIFF inspector closed (${code}).`)));
        worker.once('message',value=>{try{scope.signal.throwIfAborted();if(value?.kind==='error')throw new Error(String(value.error).slice(0,8192));if(value?.kind!=='report')throw new Error('Unexpected native TIFF inspection reply.');finish(undefined,tiffReportSchema.parse(value.report));}catch(error){finish(error);}});if(scope.signal.aborted)cancel();
      });
    }finally{await stopped;release?.();scope.done();}
  }
  async prepare(original:Blob,options:TiffDecodeOptions,control:FloatSourceControl={}):Promise<ServerTiffSource>{
    const tiff=Object.freeze(tiffDecodeOptionsSchema.parse(options));if(tiff.editingPrecision!=='float32')throw new Error('Native TIFF admission requires editingPrecision float32.');
    const scope=this.scope(control);let directory:string|undefined,release:(()=>void)|undefined,stopped:Promise<number>|undefined,draining=Promise.resolve(),accepted=false;
    try{
      const lease=await FloatRasterSource.openTiff(original,tiff,undefined,{signal:scope.signal,onProgress:scope.progress});
      let input:FloatSourceInput;
      try{input={original:lease.original,width:lease.width,height:lease.height,tiff,expectedSource:lease.sourceColor,target:iccTarget('linear-srgb').source,intent:'relative-colorimetric',blackPointCompensation:false};}finally{lease.dispose();}
      const expected=await describeFloatSource(input,{signal:scope.signal,onProgress:scope.progress},hashOriginal);scope.progress({phase:'waiting',fraction:null});release=await preparationSlots.acquire(scope.signal);scope.signal.throwIfAborted();
      await mkdir(this.cacheDirectory,{recursive:true});directory=await mkdtemp(join(this.cacheDirectory,'canoli-tiff-'));scope.signal.throwIfAborted();const buildId=randomUUID(),root=directory;
      const result=await new Promise<{manifest:FloatSourceManifest;preview:Blob;color:TiffFloatColor;report:TiffImportReport}>((resolve,reject)=>{
        const worker=new Worker(new URL('./tiff-native-worker.mjs',import.meta.url),{workerData:{mode:'prepare',input,buildId,directory:root},execArgv:[]});let settled=false,descriptorSeen=false,prepared:unknown,tiles:FloatSourceManifest['tiles']=[],serial=Promise.resolve();
        const finish=(error?:unknown,value?:{manifest:FloatSourceManifest;preview:Blob;color:TiffFloatColor;report:TiffImportReport})=>{if(settled)return;settled=true;scope.signal.removeEventListener('abort',cancel);stopped??=worker.terminate();error?reject(error):resolve(value!);};
        const cancel=()=>finish(scope.signal.reason??new Error('Native TIFF preparation cancelled.'));scope.signal.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>{if(!settled)finish(new Error(`Native TIFF worker closed (${code}).`));});
        worker.on('message',raw=>{draining=serial=serial.then(async()=>{
          if(settled)return;scope.signal.throwIfAborted();
          if(raw?.kind==='error')throw new Error(String(raw.error).slice(0,8192));
          if(raw?.kind==='progress'){scope.progress(progressSchema.parse(raw.progress));return;}
          if(raw?.kind==='descriptor'){
            const descriptor=floatSourceDescriptorSchema.parse(raw.descriptor);if(descriptorSeen||raw.key!==descriptorKey(descriptor)||JSON.stringify(descriptor)!==JSON.stringify(expected.descriptor))throw new Error('Native TIFF descriptor differs from the captured original.');descriptorSeen=true;worker.postMessage({kind:'continue'});return;
          }
          if(raw?.kind==='prepared'){if(!descriptorSeen||prepared)throw new Error('Unexpected native TIFF conversion receipt.');prepared=validateFloatPreparation(expected.descriptor,raw.prepared);return;}
          if(raw?.kind==='tiles'){
            if(!prepared||!Array.isArray(raw.tiles)||!raw.tiles.length||raw.tiles.length>FLOAT_TILE_BATCH_SIZE)throw new Error('Invalid native TIFF tile batch.');
            const batch:FloatEncodedTile[]=raw.tiles.map((tile:FloatEncodedTile,index:number)=>{const meta=validateTileMeta(expected.descriptor,tile?.meta);if(meta.index!==tiles.length+index||!(tile.blob instanceof Blob)||tile.blob.size!==meta.encodedBytes)throw new Error('Native TIFF tile sequence is incomplete.');return{meta,blob:tile.blob};});
            await this.reader.verify(expected.descriptor,batch,scope.signal);scope.signal.throwIfAborted();
            for(const tile of batch){await writeFile(join(root,`${tile.meta.index}.tile`),new Uint8Array(await tile.blob.arrayBuffer()),{flag:'wx',mode:0o600});scope.signal.throwIfAborted();tiles.push(tile.meta);}
            scope.progress({phase:'converting',fraction:tiles.length/tileCount(expected.descriptor)});worker.postMessage({kind:'continue'});return;
          }
          if(raw?.kind==='complete'){
            const manifest=validateManifest(raw.manifest,expected.descriptor),color=tiffFloatColorSchema.parse(raw.color),report=tiffReportSchema.parse(raw.report);
            if(!prepared||manifest.buildId!==buildId||JSON.stringify(manifest.prepared)!==JSON.stringify(prepared)||JSON.stringify(manifest.tiles)!==JSON.stringify(tiles)||color.wasmSha256!==FLOAT_SOURCE_NATIVE_SHA||JSON.stringify(color.source)!==JSON.stringify(input.expectedSource)||JSON.stringify(report)!==JSON.stringify(expected.inspection.report)||!(raw.preview instanceof Blob)||raw.preview.type!=='image/png'||raw.preview.size>96*96*8+65536)throw new Error('Native TIFF preparation returned inconsistent originals or preview.');
            const png=openPngRows(new Uint8Array(await raw.preview.arrayBuffer())),factor=Math.min(1,96/input.width,96/input.height);
            if(png.width!==Math.max(1,Math.round(input.width*factor))||png.height!==Math.max(1,Math.round(input.height*factor)))throw new Error('Native TIFF preview dimensions differ.');for await(const _strip of png.strips){scope.signal.throwIfAborted();}
            finish(undefined,{manifest,preview:raw.preview,color,report});return;
          }
          throw new Error('Unexpected native TIFF worker response.');
        }).catch(error=>finish(error));});if(scope.signal.aborted)cancel();
      });
      scope.signal.throwIfAborted();const source=new ServerTiffSource(input.original,freeze(result.manifest),result.preview,freeze(result.color),freeze(result.report),root,this);this.sources.add(source);accepted=true;return source;
    }finally{try{await stopped;await draining;}finally{release?.();try{if(directory&&!accepted)await rm(directory,{recursive:true,force:true,maxRetries:2});}finally{scope.done();}}}
  }
  bind(asset:ImageAsset,source:ServerTiffSource,documentId:string){source.check();if(!this.sources.has(source)||asset.blob!==source.original||asset.width!==source.manifest.descriptor.width||asset.height!==source.manifest.descriptor.height||JSON.stringify(asset.tiff)!==JSON.stringify(source.manifest.descriptor.tiff)||JSON.stringify(asset.tiffColor)!==JSON.stringify(source.color))throw new Error('Native TIFF asset differs from its verified original.');this.bound.set(asset,source);let entries=this.owners.get(documentId);if(!entries)this.owners.set(documentId,entries=new Set());entries.add(source);}
  forAsset(asset:ImageAsset){const source=this.bound.get(asset);if(!source||!this.sources.has(source)||asset.blob!==source.original||asset.width!==source.manifest.descriptor.width||asset.height!==source.manifest.descriptor.height||JSON.stringify(asset.tiff)!==JSON.stringify(source.manifest.descriptor.tiff)||JSON.stringify(asset.tiffColor)!==JSON.stringify(source.color))throw new Error('This asset has no matching verified native TIFF source.');source.check();return source;}
  async repair(source:ServerTiffSource,control:FloatSourceControl){
    source.check();const replacement=await this.prepare(source.original,source.manifest.descriptor.tiff,control);let adopted=false;
    try{source.check();const previous=source.adopt(replacement);this.sources.delete(replacement);adopted=true;await rm(previous,{recursive:true,force:true,maxRetries:2});}
    finally{if(!adopted)await replacement.dispose();}
  }
  async read(source:ServerTiffSource,bounds:FloatSourceWindow,control:FloatSourceControl){
    const scope=this.scope(control);try{source.check();scope.progress({phase:'reading',fraction:0});const result=await this.reader.read(source.directory,source.manifest,bounds,scope.signal,scope.progress);source.check();scope.progress({phase:'reading',fraction:1});return result;}finally{scope.done();}
  }
  async release(source:ServerTiffSource){if(!this.sources.delete(source))return;for(const entries of this.owners.values())entries.delete(source);await rm(source.directory,{recursive:true,force:true,maxRetries:2});}
  async releaseDocument(documentId:string){const entries=this.owners.get(documentId);this.owners.delete(documentId);if(entries)await Promise.all([...entries].map(source=>source.dispose()));}
  async dispose(){if(this.closed)return;this.closed=true;for(const controller of this.controllers)controller.abort(new Error('Native TIFF service closed.'));await this.reader.dispose();await Promise.all([...this.jobs]);await Promise.all([...this.sources].map(source=>source.dispose()));this.owners.clear();}
}
