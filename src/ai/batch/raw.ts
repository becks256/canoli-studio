export {batchRawSourceSchema,type BatchRawSource} from './raw-record';
import {batchRawSourceSchema} from './raw-record';
import type {HistoryOrigin} from '../../core/history-provenance';
import {id} from '../../core/model';
import {Document,SmartObjectLayer} from '../../dom';
import {inspectRawFile} from '../../core/interchange/raw/client';
import {validateRawLensProfile} from '../../core/interchange/lens/client';
import {rawBlobHash} from '../../core/interchange/raw/source';
import {parseRawDevelopmentOptions,type RawDecodeOptions,type RawImportControl} from '../../core/interchange/raw/types';
import type {BatchSourceInput} from './types';

export async function prepareRawBatchSource(file:File,options:RawDecodeOptions={},control:RawImportControl={}):Promise<BatchSourceInput>{
  const settings=parseRawDevelopmentOptions(options);control.signal?.throwIfAborted();
  const report=await inspectRawFile(file,settings.development.image,control);control.signal?.throwIfAborted();
  await validateRawLensProfile(settings.development.lens,report,control.signal);control.signal?.throwIfAborted();
  const raw=batchRawSourceSchema.parse({version:1,originalName:file.name,options:settings,report});
  const sha256=await rawBlobHash(file,()=>control.signal?.throwIfAborted());
  return {id:`raw-${id()}`,name:file.name.slice(0,240),width:report.displayWidth,height:report.displayHeight,mimeType:file.type||'application/octet-stream',byteLength:file.size,sha256,blob:file,raw};
}
export function rawBatchDocument(name:string,width:number,height:number,assetId:string,origin?:HistoryOrigin){
  const document=new Document({name,width,height}),componentId=id();if(origin)document._setDefaultHistoryOrigin(origin);
  document._dispatch({type:'component.set',definition:{id:componentId,name,source:{kind:'asset',assetId,width,height}}});
  const layer=document.layers.add(new SmartObjectLayer({name,componentId,width,height}));document.selectedLayer=layer;
  return {document,layer};
}
