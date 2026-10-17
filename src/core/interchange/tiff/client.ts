import {z} from 'zod';
import {tiffDecodeOptionsSchema,tiffPageReportSchema,tiffReportSchema,type TiffDecodeOptions,type TiffImportControl,type TiffImportReport,type TiffPageReport} from './types';
const progressSchema=z.object({phase:z.enum(['inspecting','decoding']),fraction:z.number().min(0).max(1).nullable()}).strict();
const decodedSchema=z.object({png:z.instanceof(Blob),page:tiffPageReportSchema,report:tiffReportSchema}).strict();
type Decoded={png:Blob;page:TiffPageReport;report:TiffImportReport};
function run(blob:Blob,mode:'inspect',options:TiffDecodeOptions,control:TiffImportControl):Promise<TiffImportReport>;
function run(blob:Blob,mode:'decode',options:TiffDecodeOptions,control:TiffImportControl):Promise<Decoded>;
function run(blob:Blob,mode:'inspect'|'decode',options:TiffDecodeOptions,control:TiffImportControl):Promise<TiffImportReport|Decoded>{
 control.signal?.throwIfAborted();const settings=tiffDecodeOptionsSchema.parse(options);if(typeof Worker==='undefined')return Promise.reject(new Error('TIFF image decoding requires the browser worker host.'));
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});let settled=false;
  const finish=(error?:unknown,value?:unknown)=>{if(settled)return;settled=true;worker.terminate();control.signal?.removeEventListener('abort',cancel);try{control.signal?.throwIfAborted();if(error)throw error;if(mode==='inspect')resolve(tiffReportSchema.parse(value));else{const decoded=decodedSchema.parse(value);if(decoded.png.type!=='image/png'||decoded.page.index!==settings.page||JSON.stringify(decoded.page)!==JSON.stringify(decoded.report.pages[settings.page])||!decoded.page.canDecode||decoded.page.requiresPrecisionLoss&&!settings.allowPrecisionLoss)throw new Error('Invalid TIFF decoder result.');resolve(decoded);}}catch(cause){reject(cause);}};
  const cancel=()=>finish(control.signal?.reason??new Error('TIFF import cancelled.'));control.signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=event=>{try{control.signal?.throwIfAborted();const data=event.data;if(data.error)finish(new Error(String(data.error)));else if(data.progress){control.onProgress?.(progressSchema.parse(data.progress));control.signal?.throwIfAborted();}else finish(undefined,mode==='inspect'?data.report:data);}catch(error){finish(error);}};
  worker.onerror=()=>finish(new Error('TIFF worker failed. Check the file and available device memory.'));worker.onmessageerror=()=>finish(new Error('Invalid TIFF worker message.'));
  try{worker.postMessage({blob,mode,options:settings});if(control.signal?.aborted)cancel();}catch(error){finish(error);}
 });
}
export const inspectTiffFile=(blob:Blob,control:TiffImportControl={})=>run(blob,'inspect',{},control);
export const decodeTiffFile=(blob:Blob,options:TiffDecodeOptions={},control:TiffImportControl={})=>run(blob,'decode',options,control);
