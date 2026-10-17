import {Worker} from 'node:worker_threads';
import {AffineTransform} from '../src/core/affine';
import {layerMaskSchema} from '../src/core/masks';
import {layerTransform} from '../src/core/spatial';
import {findLayer,isLocked,id,type DocumentData} from '../src/core/model';
import type {AssetStore,ImageAsset} from '../src/core/assets';
import type {MattingRequest,PreparedMatting,MattingPlan} from '../src/core/matting';

export async function prepareServerMatting(document:DocumentData,assets:AssetStore,request:MattingRequest,signal:AbortSignal,check:()=>void,didCommit:()=>boolean):Promise<PreparedMatting>{
  const layer=findLayer(document,request.layerId);if(layer?.kind!=='raster'||isLocked(document,layer.id))throw new Error('Refine Edge requires an attached unlocked raster layer.');
  const keys=new Set([layer.assetId]);if(layer.mask?.kind==='bitmap')keys.add(layer.mask.assetId);if(request.options.trimapAssetId)keys.add(request.options.trimapAssetId);
  const inputs:import('./matting-runtime').MattingPngInput[]=[];for(const key of keys){signal.throwIfAborted();check();const asset=assets.get(key);inputs.push({id:key,png:await asset.blob.arrayBuffer(),width:asset.width,height:asset.height});}
  const output=await new Promise<any>((resolve,reject)=>{
    const worker=new Worker(new URL('./matting-worker.mjs',import.meta.url),{workerData:{document,request,inputs},transferList:inputs.map(input=>input.png),execArgv:[]});let settled=false;
    const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener('abort',cancel);void worker.terminate();error?reject(error):resolve(value);};
    const cancel=()=>finish(signal.reason??new Error('Matting cancelled.'));
    signal.addEventListener('abort',cancel,{once:true});worker.once('error',finish);worker.once('exit',code=>finish(new Error(`Matting worker closed (${code}).`)));worker.once('message',message=>message.error?finish(new Error(message.error)):finish(undefined,message));if(signal.aborted)cancel();
  });signal.throwIfAborted();check();
  const source=assets.get(layer.assetId),prepared:ImageAsset[]=[];
  const stage=(bytes:unknown,name:string)=>{
    if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<33)throw new Error('Invalid matting PNG output.');const data=new Uint8Array(bytes),view=new DataView(bytes);
    if(data[0]!==137||String.fromCharCode(...data.subarray(1,4))!=='PNG'||view.getUint32(16)!==source.width||view.getUint32(20)!==source.height||output.width!==source.width||output.height!==source.height)throw new Error('Invalid matting PNG geometry.');
    const asset={id:id(),name,width:source.width,height:source.height,blob:new Blob([bytes],{type:'image/png'}),bitmap:{width:source.width,height:source.height,close(){}} as unknown as ImageBitmap,thumbnail:''};prepared.push(asset);return asset.id;
  };
  const maskId=stage(output.mask,`${layer.name} — matte`),foregroundId=output.foreground?stage(output.foreground,`${layer.name} — corrected colors`):source.id;
  if(!Number.isSafeInteger(output.unresolvedPixels)||output.unresolvedPixels<0||output.unresolvedPixels>source.width*source.height)throw new Error('Invalid matting diagnostics.');
  const linked=layer.mask?.linked!==false,basis=linked?AffineTransform.scale(layer.width/source.width,layer.height/source.height):layerTransform(document,layer.id)!.multiply(AffineTransform.scale(layer.width/source.width,layer.height/source.height));
  const mask=layerMaskSchema.parse({kind:'bitmap',assetId:maskId,enabled:true,inverted:false,density:1,feather:0,x:basis.e,y:basis.f,linked,basis:new AffineTransform(basis.a,basis.b,basis.c,basis.d,0,0).toJSON()}),plan:MattingPlan={sourceId:layer.id,mask,unresolvedPixels:output.unresolvedPixels};
  if(request.options.outputTo==='new-layer')plan.layer={...structuredClone(layer),id:id(),name:`${layer.name.slice(0,228)} — refined`,assetId:foregroundId,mask,visible:true,locked:false};
  return{plan,commit(apply){
    signal.throwIfAborted();check();const installed:string[]=[];
    try{for(const asset of prepared){assets.install(asset,false);installed.push(asset.id);}check();apply();}
    catch(error){if(!didCommit())for(const key of installed)assets.remove(key);throw error;}
  }};
}
