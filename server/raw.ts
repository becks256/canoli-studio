import {Worker} from 'node:worker_threads';
import {rawDecodeOptionsSchema,type RawDecodeOptions,type RawImportControl,type RawImportReport} from '../src/core/interchange/raw/types';
import {rawProgressSchema,rawInspectedSchema,validateRawDevelopmentResult,type RawDeveloped} from '../src/core/interchange/raw/result';

// Private server admission, independent of the browser's separate sessions/queue.
let active=false;const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
async function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();return new Promise((resolve,reject)=>{
    const cancel=()=>{const i=waiting.indexOf(entry);if(i>=0)waiting.splice(i,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('RAW request cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}
function run(blob:Blob,mode:'inspect',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport>;
function run(blob:Blob,mode:'develop',options:RawDecodeOptions,control:RawImportControl):Promise<RawDeveloped>;
async function run(blob:Blob,mode:'inspect'|'develop',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport|RawDeveloped>{
  const settings=rawDecodeOptionsSchema.parse(options);control.signal?.throwIfAborted();
  if(mode==='develop'&&!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');
  const release=await acquire(control.signal);
  let stopped:Promise<number>|undefined;
  try{
    const bytes=await blob.arrayBuffer();control.signal?.throwIfAborted();
    return await new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker(new URL('./raw-worker.mjs',import.meta.url),{workerData:{bytes,mode,options:settings},transferList:[bytes],execArgv:[]});}catch(error){reject(error);return;}
    let settled=false,received=false;
    const finish=(error?:unknown,result?:unknown)=>{if(settled)return;settled=true;control.signal?.removeEventListener('abort',cancel);stopped??=worker.terminate();error?reject(error):resolve(result as RawImportReport|RawDeveloped);};
    const cancel=()=>finish(control.signal?.reason??new Error('RAW request cancelled.'));
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.once('error',finish);worker.once('exit',code=>{if(!received)finish(new Error(`RAW worker closed (${code}).`));});
    worker.on('message',message=>{
      if(settled||received)return;
      try{
        if(message?.progress){control.onProgress?.(rawProgressSchema.parse(message.progress));control.signal?.throwIfAborted();return;}
        if(typeof message?.error==='string'){finish(new Error(message.error));return;}
        received=true;stopped??=worker.terminate();
        void(async()=>{
          try{
            const result=mode==='inspect'?rawInspectedSchema.parse(message?.result):await validateRawDevelopmentResult(message?.result,settings);
            if(result.report.image!==settings.development.image)throw new Error('RAW result selected a different source image.');
            control.signal?.throwIfAborted();finish(undefined,mode==='inspect'?result.report:result);
          }catch(error){finish(error);}
        })();
      }catch(error){finish(error);}
    });if(control.signal?.aborted)cancel();
  });}finally{try{await stopped;}finally{release();}}
}
export function inspectServerRaw(blob:Blob,image=0,control:RawImportControl={}){return run(blob,'inspect',{development:{image}},control);}
export function developServerRaw(blob:Blob,options:RawDecodeOptions={},control:RawImportControl={}){return run(blob,'develop',options,control);}
