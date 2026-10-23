import {hasLensCorrection,validateLensGeometry} from '../../core/interchange/raw/lens';
import {z} from 'zod';
import {id} from '../../core/model';
import {Document,SmartObjectLayer} from '../../dom';
import {inspectRawFile} from '../../core/interchange/raw/client';
import {rawBlobHash} from '../../core/interchange/raw/source';
import {parseRawDevelopmentOptions,rawDecodeOptionsSchema,rawImportReportSchema,type RawDecodeOptions,type RawImportControl} from '../../core/interchange/raw/types';
import type {BatchSourceInput} from './types';

/** Reviewed metadata only. Accepted pixels/provenance belong to the later prepared project. */
export const batchRawSourceSchema=z.object({version:z.literal(1),originalName:z.string().min(1),options:rawDecodeOptionsSchema,report:rawImportReportSchema}).strict().superRefine((value,context)=>{
  if(hasLensCorrection(value.options.development.lens)){try{validateLensGeometry(value.options.development.lens!,value.report.displayWidth,value.report.displayHeight);}catch(error){context.addIssue({code:'custom',message:String(error)});}}
  if(!value.options.allowPrecisionLoss||!value.report.canDevelop||value.options.development.image!==value.report.image||value.options.development.whiteBalance==='camera'&&value.report.channels>1&&!value.report.hasCameraWhiteBalance)
    context.addIssue({code:'custom',message:'RAW batch input requires explicit precision-loss consent and supported native settings.'});
});
export type BatchRawSource=z.infer<typeof batchRawSourceSchema>;
export async function prepareRawBatchSource(file:File,options:RawDecodeOptions={},control:RawImportControl={}):Promise<BatchSourceInput>{
  const settings=parseRawDevelopmentOptions(options);control.signal?.throwIfAborted();
  const report=await inspectRawFile(file,settings.development.image,control);control.signal?.throwIfAborted();
  const raw=batchRawSourceSchema.parse({version:1,originalName:file.name,options:settings,report});
  const sha256=await rawBlobHash(file,()=>control.signal?.throwIfAborted());
  return {id:`raw-${id()}`,name:file.name.slice(0,240),width:report.displayWidth,height:report.displayHeight,mimeType:file.type||'application/octet-stream',byteLength:file.size,sha256,blob:file,raw};
}
export function rawBatchDocument(name:string,width:number,height:number,assetId:string){
  const document=new Document({name,width,height}),componentId=id();
  document._dispatch({type:'component.set',definition:{id:componentId,name,source:{kind:'asset',assetId,width,height}}});
  const layer=document.layers.add(new SmartObjectLayer({name,componentId,width,height}));document.selectedLayer=layer;
  return {document,layer};
}
