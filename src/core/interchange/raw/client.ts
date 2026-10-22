import {z} from 'zod';
import {rawDecodeOptionsSchema,rawImportReportSchema,type RawDecodeOptions,type RawImportControl,type RawImportReport} from './types';

const progressSchema=z.object({phase:z.enum(['inspecting','developing','encoding']),fraction:z.number().min(0).max(1).nullable()}).strict();
const inspectedSchema=z.object({report:rawImportReportSchema}).strict();
const decodedSchema=inspectedSchema.extend({png:z.instanceof(Blob)}).strict();
type Developed=z.infer<typeof decodedSchema>;
// RAW inspection also opens a native full-input buffer, so both modes share a
// FIFO lease. Waiting sources have no worker/native heap/decoded plane.
let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('RAW preparation cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}
function run(blob:Blob,mode:'inspect',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport>;
function run(blob:Blob,mode:'develop',options:RawDecodeOptions,control:RawImportControl):Promise<Developed>;
function run(blob:Blob,mode:'inspect'|'develop',options:RawDecodeOptions,control:RawImportControl):Promise<RawImportReport|Developed>{
  control.signal?.throwIfAborted();const settings=rawDecodeOptionsSchema.parse(options);
  if(mode==='develop'&&!settings.allowPrecisionLoss)return Promise.reject(new Error('RAW working output requires explicit 8-bit precision-loss consent.'));
  if(typeof Worker==='undefined')return Promise.reject(new Error('RAW preparation requires the browser worker host.'));
  return new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
    let settled=false,received=false,terminated=false;
    const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
    const cleanup=()=>{terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>fail(control.signal?.reason??new Error('RAW preparation cancelled.'));
    const finish=async(value:unknown)=>{
      if(settled||received)return;received=true;terminate();
      try{
        control.signal?.throwIfAborted();const parsed=mode==='inspect'?inspectedSchema.parse(value):decodedSchema.parse(value);
        if(parsed.report.image!==settings.development.image)throw new Error('RAW result selected a different source image.');
        if(mode==='develop'){
          const decoded=parsed as Developed,report=decoded.report;
          if(!report.canDevelop||decoded.png.type!=='image/png'||settings.development.whiteBalance==='camera'&&!report.hasCameraWhiteBalance&&report.channels>1)throw new Error('Invalid RAW developed result or unavailable camera white balance.');
          const buffer=await decoded.png.slice(0,46).arrayBuffer(),bytes=new Uint8Array(buffer),view=new DataView(buffer);
          if(bytes.length!==46||[137,80,78,71,13,10,26,10].some((value,i)=>bytes[i]!==value)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(16)!==report.displayWidth||view.getUint32(20)!==report.displayHeight||bytes[24]!==8||bytes[25]!==6||view.getUint32(33)!==1||view.getUint32(37)!==0x73524742||bytes[41]!==0||view.getUint32(42)!==0xaece1ce9)throw new Error('RAW PNG geometry, precision or sRGB identification differs from its contract.');
        }
        control.signal?.throwIfAborted();if(settled)return;settled=true;cleanup();resolve(mode==='inspect'?parsed.report:parsed as Developed);
      }catch(error){fail(error);}
    };
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>{if(settled||received)return;try{const data=event.data;if(data&&typeof data.error==='string')fail(new Error(data.error));else if(data&&'progress'in data){control.onProgress?.(progressSchema.parse(data.progress));control.signal?.throwIfAborted();}else void finish(data);}catch(error){fail(error);}};
    worker.onerror=()=>fail(new Error('RAW worker failed. Check the source, codec availability and device memory.'));
    worker.onmessageerror=()=>fail(new Error('Invalid RAW worker message.'));
    try{worker.postMessage({blob,mode,options:settings});if(control.signal?.aborted)cancel();}catch(error){fail(error);}
  });
}
export async function inspectRawFile(blob:Blob,image=0,control:RawImportControl={}){
  const options=rawDecodeOptionsSchema.parse({development:{image}}),release=await acquire(control.signal);
  try{return await run(blob,'inspect',options,control);}finally{release();}
}
export async function developRawFile(blob:Blob,options:RawDecodeOptions={},control:RawImportControl={}){
  const settings=rawDecodeOptionsSchema.parse(options);
  if(!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');
  const release=await acquire(control.signal);
  try{return await run(blob,'develop',settings,control);}finally{release();}
}
