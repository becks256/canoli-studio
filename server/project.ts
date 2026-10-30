import {retainedDocuments} from '../src/core/history';
import {Worker} from 'node:worker_threads';
import {referencedAssets,type DocumentData} from '../src/core/model';
import type {AssetStore,ImageAsset} from '../src/core/assets';
import type {RetainedHistory} from '../src/core/history';
import {verifyRawSource} from '../src/core/interchange/raw/source';

const verified=new WeakMap<Blob,{width:number;height:number}>();
/** Deliver only actual supported encoded images, not legacy unverified metadata claims. */
export async function validateServerProjectSources(document:DocumentData,assets:AssetStore,history?:RetainedHistory,signal?:AbortSignal,verifyTiff?:(asset:ImageAsset)=>void){
  const ids=new Set(retainedDocuments(document,history).flatMap(value=>[...referencedAssets(value)]));
  const sources=[...ids].map(id=>assets.get(id));
  for(const asset of sources){
    signal?.throwIfAborted();
    if(asset.blob.type==='image/tiff'&&verifyTiff){verifyTiff(asset);continue;}
    if(asset.raw){await verifyRawSource(asset.raw,asset.blob,asset.width,asset.height,()=>signal?.throwIfAborted());continue;}
    if(asset.blob.type!=='image/png')throw new Error('Headless native project delivery requires validated ordinary sRGB PNG, RAW-derived or service-verified high-precision TIFF sources. Other metadata-only image formats are not decoded by this server.');
    let proof=verified.get(asset.blob);
    if(!proof){
      const proof=(async()=>{
        const png=await asset.blob.arrayBuffer();signal?.throwIfAborted();
        return await new Promise<{width:number;height:number}>((resolve,reject)=>{
          const worker=new Worker(new URL('./png-validation-worker.mjs',import.meta.url),{workerData:{png},transferList:[png],execArgv:[]});let settled=false;
          const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',cancel);void worker.terminate();if(error)reject(error);else{const data=value as {width?:unknown;height?:unknown};if(!Number.isSafeInteger(data?.width)||!Number.isSafeInteger(data?.height)||Number(data.width)<=0||Number(data.height)<=0)reject(new Error('Invalid encoded image validation result.'));else resolve(data as {width:number;height:number});}};
          const cancel=()=>finish(signal?.reason??new Error('Project image validation cancelled.'));signal?.addEventListener('abort',cancel,{once:true});
          worker.once('error',finish);worker.once('exit',code=>finish(new Error(`PNG validation worker closed (${code}).`)));worker.once('message',message=>message.error?finish(new Error(message.error)):finish(undefined,message));if(signal?.aborted)cancel();
        });
      })();
      const result=await proof;verified.set(asset.blob,result);
    }
    const result=verified.get(asset.blob)!;signal?.throwIfAborted();if(result.width!==asset.width||result.height!==asset.height)throw new Error('Encoded source dimensions differ from the headless asset metadata.');
  }
}
