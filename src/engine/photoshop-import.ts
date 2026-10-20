import {validateDocument,referencedAssets,allLayers,type DocumentData} from '../core/model';
import {isPhotoshopGroupOnlyDocument,photoshopInspectionSchema,photoshopOptionsSchema,photoshopProgressSchema,photoshopReportSchema,photoshopInputBlob,type PhotoshopInput,type PhotoshopInspection,type PhotoshopImportControl} from '../core/photoshop-import';
import type {PsdCapabilityReport,PsdImportOptions} from '../core/interchange/psd/types';

export interface PhotoshopDecodedEntry {id:string;width:number;height:number;png:Blob;pixels:Uint8ClampedArray<ArrayBuffer>}
export interface PhotoshopDecoded {document:DocumentData;report:PsdCapabilityReport;entries:PhotoshopDecodedEntry[]}
function decodedResult(input:unknown):PhotoshopDecoded {
 const value=input as PhotoshopDecoded;
 if(!value||typeof value!=='object'||!Array.isArray(value.entries))throw new Error('Invalid Photoshop decoded result.');
 validateDocument(value.document);const report=photoshopReportSchema.parse(value.report),ids=new Set<string>();
 if(!value.entries.length&&(!report.canImportAsLayers||!isPhotoshopGroupOnlyDocument(value.document)))throw new Error('Invalid Photoshop decoded result without pixels or editable folders.');
 for(const entry of value.entries){
  if(!entry||typeof entry.id!=='string'||ids.has(entry.id)||!(entry.png instanceof Blob)||entry.png.type!=='image/png'||!entry.png.size||!(entry.pixels instanceof Uint8ClampedArray)||!(entry.pixels.buffer instanceof ArrayBuffer)||!Number.isSafeInteger(entry.width)||entry.width<1||!Number.isSafeInteger(entry.height)||entry.height<1||entry.pixels.length!==entry.width*entry.height*4)throw new Error('Invalid Photoshop decoded source.');
  ids.add(entry.id);
 }
 const expected=referencedAssets(value.document);if(ids.size!==expected.size||[...expected].some(id=>!ids.has(id)))throw new Error('Photoshop decoded sources do not match the document.');
 const sources=new Map(value.entries.map(entry=>[entry.id,entry]));for(const layer of allLayers(value.document.children))if(layer.kind==='raster'){const entry=sources.get(layer.assetId);if(!entry||entry.width!==layer.width||entry.height!==layer.height)throw new Error('Photoshop source geometry does not match the document.');}
 return{document:value.document,report,entries:value.entries};
}

function run(source:PhotoshopInput,mode:'inspect',options:PsdImportOptions,control:PhotoshopImportControl):Promise<PhotoshopInspection>;
function run(source:PhotoshopInput,mode:'decode',options:PsdImportOptions,control:PhotoshopImportControl):Promise<PhotoshopDecoded>;
function run(source:PhotoshopInput,mode:'inspect'|'decode',options:PsdImportOptions,control:PhotoshopImportControl):Promise<PhotoshopInspection|PhotoshopDecoded>{
 control.signal?.throwIfAborted();const blob=photoshopInputBlob(source),settings=photoshopOptionsSchema.parse(options);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./photoshop-import.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const cleanup=()=>{worker.terminate();control.signal?.removeEventListener('abort',cancel);worker.removeEventListener('messageerror',messageError);};
  const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;cleanup();try{control.signal?.throwIfAborted();if(error)throw error;resolve(mode==='inspect'?photoshopInspectionSchema.parse(value):decodedResult(value));}catch(cause){reject(cause);}};
  const cancel=()=>finish(control.signal?.reason??new DOMException('Cancelled','AbortError'));
  const messageError=()=>finish(new Error('Invalid Photoshop import worker message.'));
  worker.addEventListener('messageerror',messageError);control.signal?.addEventListener('abort',cancel,{once:true});
  worker.onerror=()=>finish(new Error('Photoshop import worker failed. Check the file and available device memory.'));
  worker.onmessage=event=>{if(settled)return;try{const data=event.data;if(typeof data?.error==='string')finish(new Error(data.error));else if(data?.progress){control.onProgress?.(photoshopProgressSchema.parse(data.progress));control.signal?.throwIfAborted();}else finish(undefined,mode==='inspect'?data?.inspection:data?.decoded);}catch(error){finish(error);}};
  try{worker.postMessage({blob,mode,options:settings});if(control.signal?.aborted)cancel();}catch(error){finish(error);}
 });
}
export const inspectPhotoshop=(source:PhotoshopInput,control:PhotoshopImportControl={})=>run(source,'inspect',{},control);
export const decodePhotoshop=(source:PhotoshopInput,options:PsdImportOptions={},control:PhotoshopImportControl={})=>run(source,'decode',options,control);
