import {preflightAlignmentGeometryIds} from '../src/core/preflight-alignment';
import {preflightDocumentView} from '../src/core/preflight-view';
import {Worker} from 'node:worker_threads';
import {preflightReportSchema,type PreflightSettings,type PreflightReport} from '../src/core/preflight';
import type {DocumentData} from '../src/core/model';
export function prepareServerPreflight(document:DocumentData,revision:number,options:PreflightSettings,assets:[string,{width:number;height:number}][],signal:AbortSignal):Promise<PreflightReport>{
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./preflight-worker.mjs',import.meta.url),{workerData:{document:preflightDocumentView(document,options.checkBounds,preflightAlignmentGeometryIds(options.alignments)),revision,options,assets},execArgv:[]});let settled=false;
    const finish=(error?:unknown,result?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);void worker.terminate();if(error)reject(error);else try{resolve(preflightReportSchema.parse(result));}catch(cause){reject(cause);}};
    const cancel=()=>finish(signal.reason??new Error('Design checks cancelled.'));signal.addEventListener('abort',cancel,{once:true});
    worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Design-check worker closed (${code}).`)));
    worker.once('message',message=>message.error?finish(new Error(message.error)):finish(undefined,message.report));
    if(signal.aborted)cancel();
  });
}
