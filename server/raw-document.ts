import {retainedDocuments,captureRetainedHistory} from '../src/core/history';
import {Document,SmartObjectLayer} from '../src/dom';
import {AssetStore,captureAssetSource,type ImageAsset} from '../src/core/assets';
import {execute} from '../src/core/commands';
import {id,referencedAssets} from '../src/core/model';
import {prepareRawDerivation} from '../src/core/interchange/raw/derive';
import {rawComponentSource,rawComponentCommand} from '../src/core/interchange/raw/commands';
import {verifyRawSource} from '../src/core/interchange/raw/source';
import {parseRawDevelopmentOptions,type RawDecodeOptions,type RawImportControl} from '../src/core/interchange/raw/types';
import {developServerRaw} from './raw';

async function preparedAsset(blob:Blob,name:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void){
  const {png,source}=await prepareRawDerivation(blob,name,options,control,check,developServerRaw);
  return{id:id(),name,width:source.report.displayWidth,height:source.report.displayHeight,blob:png,raw:source};
}
function commit(document:Document,assets:AssetStore,asset:Omit<ImageAsset,'bitmap'|'thumbnail'>,command:Parameters<Document['_dispatch']>[0],check:()=>void,beforeCommit:()=>void){
  execute(document._read(),command);check();beforeCommit();let installed=false;
  try{assets.installEncoded(asset);installed=true;document._dispatch(command);}
  catch(error){
    const state=document.getSnapshot(),retained=retainedDocuments(state.document,captureRetainedHistory(state)).some(data=>referencedAssets(data).has(asset.id));
    if(installed&&!retained)assets.remove(asset.id);throw error;
  }
}
/** Existing headless document geometry stays authored; the placed master keeps native pixels. */
export async function importServerRaw(document:Document,assets:AssetStore,blob:Blob,name:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void,beforeCommit:()=>void){
  const asset=await preparedAsset(blob,name,options,control,check),componentId=id(),layer=new SmartObjectLayer({name:name.slice(0,240)||'RAW image',componentId,width:asset.width,height:asset.height});
  const command={type:'transaction' as const,label:'Import RAW',commands:[{type:'component.set' as const,definition:{id:componentId,name:layer.name,source:{kind:'asset' as const,assetId:asset.id,width:asset.width,height:asset.height}}},{type:'layer.add' as const,layer:layer.toJSON()}]};
  commit(document,assets,asset,command,check,beforeCommit);return{layerId:layer.id,report:asset.raw.report};
}
export async function developServerRawComponent(document:Document,assets:AssetStore,layerId:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void,beforeCommit:()=>void){
  options=parseRawDevelopmentOptions(options);
  const input=rawComponentSource(document._read(),layerId,assets),pin=captureAssetSource(assets,input.source.assetId),current=()=>{check();pin.check();control.signal?.throwIfAborted();};
  execute(document._read(),{type:'component.set',definition:input.definition});
  await verifyRawSource(input.raw,input.asset.blob,input.asset.width,input.asset.height,current);
  const asset=await preparedAsset(input.raw.originalBlob,input.raw.original.name,options,control,current),command=rawComponentCommand(document._read(),layerId,asset);
  commit(document,assets,asset,command,current,beforeCommit);return asset.raw.report;
}
