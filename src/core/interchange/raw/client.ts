import {rawDecodeOptionsSchema,type RawDecodeOptions,type RawImportControl,type RawImportReport} from './types';

import {rawProgressSchema as progressSchema,rawInspectedSchema as inspectedSchema,rawDevelopedSchema as decodedSchema,validateRawDevelopmentResult,type RawDeveloped} from './result';
type Developed=RawDeveloped;
// RAW inspection also opens a native full-input buffer, so both modes share a
// FIFO lease. Waiting sources have no worker/native heap/decoded plane.
let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('RAW preparation cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}
function run(blob:Blob,mode:'inspect',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport>;
function run(blob:Blob,mode:'develop',options:RawDecodeOptions,control:RawImportControl):Promise<Developed>;
function run(blob:Blob,mode:'inspect'|'develop',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport|Developed>{
  control.signal?.throwIfAborted();const settings=rawDecodeOptionsSchema.parse(options);
  if(mode==='develop'&&!settings.allowPrecisionLoss)return Promise.reject(new Error('RAW working output requires explicit 8-bit precision-loss consent.'));
  if(typeof Worker==='undefined')return Promise.reject(new Error('RAW preparation requires the browser worker host.'));
  return new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
    let settled=false,received=false,terminated=false;
    const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
    const cleanup=()=>{terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>fail(control.signal?.reason??new Error('RAW preparation cancelled.'));
    const finish=async(value:unknown)=>{
      if(settled||received)return;received=true;terminate();
      try{
        control.signal?.throwIfAborted();const parsed=mode==='inspect'?inspectedSchema.parse(value):decodedSchema.parse(value);
        if(parsed.report.image!==settings.development.image)throw new Error('RAW result selected a different source image.');
        if(mode==='develop')await validateRawDevelopmentResult(parsed,settings);
        control.signal?.throwIfAborted();if(settled)return;settled=true;cleanup();resolve(mode==='inspect'?parsed.report:parsed as Developed);
      }catch(error){fail(error);}
    };
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>{if(settled||received)return;try{const data=event.data;if(data&&typeof data.error==='string')fail(new Error(data.error));else if(data&&'progress'in data){control.onProgress?.(progressSchema.parse(data.progress));control.signal?.throwIfAborted();}else void finish(data);}catch(error){fail(error);}};
    worker.onerror=()=>fail(new Error('RAW worker failed. Check the source, codec availability and device memory.'));
    worker.onmessageerror=()=>fail(new Error('Invalid RAW worker message.'));
    try{worker.postMessage({blob,mode,options:settings});if(control.signal?.aborted)cancel();}catch(error){fail(error);}
  });
}
export async function inspectRawFile(blob:Blob,image=0,control:RawImportControl={}){
  const options=rawDecodeOptionsSchema.parse({development:{image}}),release=await acquire(control.signal);
  try{return await run(blob,'inspect',options,control);}finally{release();}
}
export async function developRawFile(blob:Blob,options:RawDecodeOptions={},control:RawImportControl={}){
  const settings=rawDecodeOptionsSchema.parse(options);
  if(!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');
  const release=await acquire(control.signal);
  try{return await run(blob,'develop',settings,control);}finally{release();}
}

/** Native TIFF shares the single RAW owner with inspection and 8-bit proxies. */
export async function exportRawTiffFile(blob:Blob,options:import('./tiff-types').RawTiffSettings,control:import('./tiff-types').RawTiffControl={}){
 const{rawTiffSettingsSchema}=await import('./tiff-types'),settings=rawTiffSettingsSchema.parse(options);
 if(!(blob instanceof Blob)||!blob.size)throw new Error('Choose a complete RAW original.');
 control.signal?.throwIfAborted();control.onProgress?.({phase:'waiting',fraction:null});control.signal?.throwIfAborted();
 const release=await acquire(control.signal);let releaseIcc:(()=>void)|undefined;
 try{const{acquireIccOwner}=await import('../../color/icc-client');control.signal?.throwIfAborted();releaseIcc=await acquireIccOwner(control.signal);const{runRawTiffWorker}=await import('./tiff-client');control.signal?.throwIfAborted();return await runRawTiffWorker(blob,settings,control);}finally{releaseIcc?.();release();}
}
