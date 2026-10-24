import {Worker} from 'node:worker_threads';
import {fontPrepareOptionsSchema,fontPreparedBytesSchema,type FontSourceControl} from '../src/fonts/types';
import type {FontResourcePreparer} from '../src/fonts/store';

let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
async function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('Font request cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}

/** Separate server queue and disposable Node parser; never a native FontFace. */
export const prepareServerFont:FontResourcePreparer=async(source,options,control:FontSourceControl)=>{
  const settings=fontPrepareOptionsSchema.parse(options),timeout=control.timeoutMs??60000;
  if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid font source timeout.');
  const release=await acquire(control.signal);let stopped:Promise<number>|undefined;
  try{return await new Promise((resolve,reject)=>{
    let worker:Worker;try{control.signal?.throwIfAborted();worker=new Worker(new URL('./font-worker.mjs',import.meta.url),{workerData:{source,options:settings},execArgv:[]});}catch(error){reject(error);return;}
    let settled=false;
    const finish=(error?:unknown,result?:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);control.signal?.removeEventListener('abort',cancel);stopped=worker.terminate();
      if(error)reject(error);else try{
        const value=fontPreparedBytesSchema.parse(result);
        if(value.report.faces.length!==1||value.faceIndex!==value.report.offset||value.faceIndex!==(settings.faceIndex??0))throw new Error('Font parser returned a different selected face.');
        control.signal?.throwIfAborted();control.onProgress?.({phase:'validating',fraction:null});control.signal?.throwIfAborted();resolve(value);
      }catch(cause){reject(cause);}
    };
    const timer=setTimeout(()=>finish(new Error('Font source operation exceeded its time budget.')),timeout),cancel=()=>finish(control.signal?.reason??new Error('Font request cancelled.'));
    control.signal?.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Font parser worker closed (${code}).`)));worker.once('message',message=>message?.error?finish(new Error(message.error)):finish(undefined,message?.result));
    try{control.onProgress?.({phase:'reading',fraction:null});control.signal?.throwIfAborted();}catch(error){finish(error);}
  });}finally{try{await stopped;}finally{release();}}
};
