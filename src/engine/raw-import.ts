import {AssetStore} from '../core/assets';
import {Document,SmartObjectLayer} from '../dom';
import {execute} from '../core/commands';
import {id,referencedAssets} from '../core/model';
import {ComponentRegistry} from '../core/smart/manager';
import {developRawFile} from '../core/interchange/raw/client';
import {parseRawDevelopmentOptions,type RawDecodeOptions,type RawImportControl} from '../core/interchange/raw/types';
import {verifyRawSource} from '../core/interchange/raw/source';
import {prepareRawDerivation} from '../core/interchange/raw/derive';
import {rawComponentCommand} from '../core/interchange/raw/commands';

/** Private native development. The original never becomes a browser bitmap. */
export async function prepareRawAsset(assets:AssetStore,blob:Blob,name:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void,assetId?:string){
  const current=()=>{check();control.signal?.throwIfAborted();};
  const {png,source}=await prepareRawDerivation(blob,name,options,control,current,developRawFile);
  const asset=await assets.add(png,name,assetId,false,{raw:source,signal:control.signal});current();return asset;
}
export async function prepareRawImport(file:File,options:RawDecodeOptions={},control:RawImportControl={},check:()=>void=()=>{}){
  const assets=new AssetStore();
  try{
    const asset=await prepareRawAsset(assets,file,file.name,options,control,check),componentId=id();
    const document=new Document({name:file.name.replace(/\.[^.]+$/,'').slice(0,240)||'Imported RAW',width:asset.width,height:asset.height});
    document._dispatch({type:'component.set',definition:{id:componentId,name:file.name.slice(0,240)||'RAW image',source:{kind:'asset',assetId:asset.id,width:asset.width,height:asset.height}}});
    document.layers.add(new SmartObjectLayer({name:file.name.slice(0,240)||'RAW image',componentId,width:asset.width,height:asset.height}));
    check();control.signal?.throwIfAborted();return {document:Document.fromJSON(document.toJSON()),assets,report:asset.raw!.report};
  }catch(error){assets.dispose();throw error;}
}

/** One master replacement updates all instances and retains prior accepted pixels for undo. */
export async function developRawComponent(document:Document,assets:AssetStore,layerId:string,options:RawDecodeOptions,control:RawImportControl,check:()=>void,beforeCommit:()=>void=()=>{}){
  options=parseRawDevelopmentOptions(options);
  const layer=document.getLayer(layerId);if(!(layer instanceof SmartObjectLayer))throw new Error('Choose an attached RAW smart object.');
  const definition=new ComponentRegistry(document._read().components).get(layer.componentId),source=definition.source;
  if(source.kind!=='asset')throw new Error('This smart object has no retained RAW original.');
  const original=assets.get(source.assetId);if(!original.raw)throw new Error('This smart object has no retained RAW original.');
  const raw=original.raw,bitmap=original.bitmap,blob=original.blob,width=original.width,height=original.height;
  const current=()=>{
    check();control.signal?.throwIfAborted();
    if(!assets.has(source.assetId)||assets.get(source.assetId)!==original||original.raw!==raw||original.blob!==blob||
      original.width!==width||original.height!==height||original.bitmap!==bitmap||bitmap.width!==width||bitmap.height!==height)
      throw new Error('RAW source changed during development. Try again.');
  };
  current();
  // Shared validation checks every dependent instance and ancestor lock before native work.
  execute(document._read(),{type:'component.set',definition});
  const staging=new AssetStore();let installed:string|undefined,committed=false;
  try{
    await verifyRawSource(raw,blob,width,height,current);
    const asset=await prepareRawAsset(staging,raw.originalBlob,raw.original.name,options,control,current);current();
    const command=rawComponentCommand(document._read(),layerId,asset);
    execute(document._read(),command);current();
    beforeCommit();staging.shareTo(assets,asset.id,asset.id);installed=asset.id;
    try{document._dispatch(command);committed=true;}
    finally{
      // A throwing observer may run after a shared command was already accepted.
      // Never remove an asset that the current model or its history now owns.
      if(!committed){const state=document.getSnapshot();committed=[state.document,...state.past.map(entry=>entry.document),...state.future.map(entry=>entry.document)].some(data=>referencedAssets(data).has(asset.id));}
    }
    return asset.raw!.report;
  }finally{
    if(installed&&!committed)assets.remove(installed);
    staging.dispose();
  }
}
