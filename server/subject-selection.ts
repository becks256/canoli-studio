import {Worker} from 'node:worker_threads';
import {selectionSchema,type SelectionData} from '../src/core/drawing';
import type {SelectSubjectSettings} from '../src/core/subject-selection';
import type {ImageAsset} from '../src/core/assets';

export async function prepareServerSubject(options:SelectSubjectSettings,asset:ImageAsset,signal:AbortSignal):Promise<SelectionData>{
  signal.throwIfAborted();const png=await asset.blob.arrayBuffer();signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./subject-selection-worker.mjs',import.meta.url),{workerData:{options,png,width:asset.width,height:asset.height},transferList:[png],execArgv:[]});let settled=false;
    const finish=(error?:unknown,selection?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);void worker.terminate();if(error)reject(error);else{try{resolve(selectionSchema.parse(selection));}catch(cause){reject(cause);}}};
    const cancel=()=>finish(signal.reason??new Error('Select Subject cancelled.'));
    signal.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Select Subject worker closed (${code}).`)));
    worker.once('message',message=>message.error?finish(new Error(message.error)):finish(undefined,message.selection));if(signal.aborted)cancel();
  });
}
