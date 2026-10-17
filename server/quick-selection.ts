import { Worker } from 'node:worker_threads';
import { selectionSchema,type SelectionData } from '../src/core/drawing';
import type { QuickSelectionSettings } from '../src/core/quick-selection';
import type { ImageAsset } from '../src/core/assets';
export async function prepareServerQuickSelection(options:QuickSelectionSettings,asset:ImageAsset,width:number,height:number,signal:AbortSignal):Promise<SelectionData>{
  signal.throwIfAborted();const png=await asset.blob.arrayBuffer();signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./quick-selection-worker.mjs',import.meta.url),{workerData:{options,png,width,height,assetWidth:asset.width,assetHeight:asset.height},transferList:[png],execArgv:[]});
    let settled=false;
    const finish=(error?:unknown,result?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);void worker.terminate();if(error)reject(error);else{try{resolve(selectionSchema.parse(result));}catch(cause){reject(cause);}}};
    const cancel=()=>finish(signal.reason??new Error('Quick Selection cancelled.'));
    signal.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Quick Selection worker closed (${code}).`)));
    worker.once('message',message=>message.error?finish(new Error(message.error)):finish(undefined,message.selection));if(signal.aborted)cancel();
  });
}
