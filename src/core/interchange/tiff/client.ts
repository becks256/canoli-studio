import {z} from 'zod';
import iccBuild from'../../color/codec/build.json' with{type:'json'};
import {tiffDecodeOptionsSchema,tiffPageReportSchema,tiffReportSchema,tiffFloatColorSchema,type TiffDecodeOptions,type TiffImportControl,type TiffImportReport} from './types';
const progressSchema=z.object({phase:z.enum(['inspecting','decoding']),fraction:z.number().min(0).max(1).nullable()}).strict();
import{TiffReader,inspectTiff}from'./inspect';
const decodedSchema=z.object({png:z.instanceof(Blob),page:tiffPageReportSchema,report:tiffReportSchema,color:tiffFloatColorSchema.optional()}).strict();
type Decoded=z.infer<typeof decodedSchema>;
function run(blob:Blob,mode:'inspect',options:TiffDecodeOptions,control:TiffImportControl):Promise<TiffImportReport>;
function run(blob:Blob,mode:'decode',options:TiffDecodeOptions,control:TiffImportControl):Promise<Decoded>;
function run(blob:Blob,mode:'inspect'|'decode',options:TiffDecodeOptions,control:TiffImportControl):Promise<TiffImportReport|Decoded>{
 control.signal?.throwIfAborted();const settings=tiffDecodeOptionsSchema.parse(options);if(typeof Worker==='undefined')return Promise.reject(new Error('TIFF image decoding requires the browser worker host.'));
 return new Promise((resolve,reject)=>{
  let worker:Worker;try{worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
  let settled=false,received=false,terminated=false;
  const terminate=()=>{if(!terminated){terminated=true;try{worker.terminate();}catch{/* Pending callers still release. */}}},cleanup=()=>{terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
  const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);},cancel=()=>fail(control.signal?.reason??new DOMException('TIFF import cancelled','AbortError'));
  const finish=async(value:unknown)=>{
   if(settled||received)return;received=true;terminate();
   try{
    control.signal?.throwIfAborted();let result:TiffImportReport|Decoded;
    if(mode==='inspect')result=tiffReportSchema.parse(value);
    else{
     const decoded=decodedSchema.parse(value);if(decoded.png.type!=='image/png'||decoded.page.index!==settings.page||JSON.stringify(decoded.page)!==JSON.stringify(decoded.report.pages[settings.page])||!decoded.page.canDecode||decoded.page.requiresPrecisionLoss&&!settings.allowPrecisionLoss)throw new Error('Invalid TIFF decoder result.');
     if(decoded.page.sampleFormat===3)await validateFloatResult(blob,decoded,settings,control.signal);else if(decoded.color)throw new Error('An integer TIFF result cannot claim float color conversion.');result=decoded;
    }
    control.signal?.throwIfAborted();if(settled)return;settled=true;cleanup();resolve(result);
   }catch(error){fail(error);}
  };
  control.signal?.addEventListener('abort',cancel,{once:true});
  worker.onmessage=event=>{if(settled||received)return;try{control.signal?.throwIfAborted();const data=event.data;if(data.error)fail(new Error(String(data.error)));else if(data.progress){control.onProgress?.(progressSchema.parse(data.progress));control.signal?.throwIfAborted();}else void finish(mode==='inspect'?data.report:data);}catch(error){fail(error);}};
  worker.onerror=()=>fail(new Error('TIFF worker failed. Check the file and available device memory.'));worker.onmessageerror=()=>fail(new Error('Invalid TIFF worker message.'));
  try{control.signal?.throwIfAborted();worker.postMessage({blob,mode,options:settings});}catch(error){fail(error);}
 });
}
export const inspectTiffFile=(blob:Blob,control:TiffImportControl={})=>run(blob,'inspect',{},control);
/** Only float pages reserve a native ICC owner. No decoding worker or pixel
 * buffers exist while waiting; ordinary integer TIFFs keep their old route. */
export async function decodeTiffFile(blob:Blob,options:TiffDecodeOptions={},control:TiffImportControl={}):Promise<Decoded>{
 const settings=tiffDecodeOptionsSchema.parse(options);control.signal?.throwIfAborted();const floating=await floatPage(blob,settings.page);control.signal?.throwIfAborted();
 if(!floating)return run(blob,'decode',settings,control);
 if(!settings.allowPrecisionLoss)throw new Error('TIFF float import requires explicit 8-bit precision-loss consent.');
 const{acquireIccOwner}=await import('../../color/icc-client');control.onProgress?.({phase:'inspecting',fraction:null});control.signal?.throwIfAborted();const release=await acquireIccOwner(control.signal);
 try{control.signal?.throwIfAborted();control.onProgress?.({phase:'inspecting',fraction:null});control.signal?.throwIfAborted();const result=await run(blob,'decode',settings,control);if(result.page.sampleFormat!==3)throw new Error('A float TIFF result cannot be relabeled as integer pixels.');return result;}finally{release();}
}
async function floatPage(blob:Blob,page:number){
 const reader=new TiffReader(blob),seen=new Set<number>();let at=await reader.header();
 for(let index=0;at&&index<256;index++){if(seen.has(at))throw new Error('Cyclic TIFF page directories.');seen.add(at);const directory=await reader.directory(at);if(index===page)return await directory.fields.get(339)?.value()===3&&await directory.fields.get(258)?.value()===32;at=directory.next;}
 throw new Error('TIFF page does not exist.');
}
async function validateFloatResult(blob:Blob,decoded:Decoded,settings:ReturnType<typeof tiffDecodeOptionsSchema.parse>,signal?:AbortSignal){
 if(!decoded.color||!decoded.page.requiresPrecisionLoss)throw new Error('Float TIFF output needs a native color conversion record.');
 const inspection=await inspectTiff(blob),source=inspection.pages[settings.page];signal?.throwIfAborted();if(!source||source.report.sampleFormat!==3||JSON.stringify(source.report)!==JSON.stringify(decoded.page))throw new Error('Float TIFF source metadata differs from its result.');
 const{iccTarget}=await import('../../color/profile-source');
 if(decoded.color.wasmSha256!==iccBuild.artifacts['canoli_icc.wasm'].sha256||decoded.color.source.kind!==(source.icc?'icc':'assumed')||!source.icc&&(!settings.floatColorSpace||decoded.color.source.kind!=='assumed'||decoded.color.source.id!==settings.floatColorSpace))throw new Error('Float TIFF native color identity differs from its source choices.');
 const bytes=source.icc??new Uint8Array(await iccTarget(settings.floatColorSpace!).source.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==decoded.color.source.sha256)throw new Error('Float TIFF source ICC differs from its conversion record.');
 const header=new Uint8Array(await decoded.png.slice(0,46).arrayBuffer()),view=new DataView(header.buffer);if(header.length!==46||[137,80,78,71,13,10,26,10].some((n,i)=>header[i]!==n)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(16)!==decoded.page.width||view.getUint32(20)!==decoded.page.height||header[24]!==8||header[25]!==6||view.getUint32(33)!==1||view.getUint32(37)!==0x73524742||header[41]!==0||view.getUint32(42)!==0xaece1ce9)throw new Error('Float TIFF proxy has invalid geometry, precision or sRGB identification.');signal?.throwIfAborted();
}
