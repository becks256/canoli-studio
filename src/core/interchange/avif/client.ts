import {z} from 'zod';
import {avifDecodeOptionsSchema,avifImportReportSchema,type AvifDecodeOptions,type AvifImportControl,type AvifImportReport} from './types';

const progressSchema=z.object({phase:z.enum(['inspecting','decoding']),fraction:z.number().min(0).max(1).nullable()}).strict();
const inspectedSchema=z.object({report:avifImportReportSchema}).strict();
const decodedSchema=inspectedSchema.extend({png:z.instanceof(Blob)}).strict();
type Decoded=z.infer<typeof decodedSchema>;
// Full-frame decoding is admitted once per application context. Queued imports
// retain immutable source Blobs, without allocating a worker or decoded plane.
let active=false;
const waiting:{start():void}[]=[];
const pump=()=>{if(!active)waiting.shift()?.start();};
function acquire(signal?:AbortSignal):Promise<()=>void>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const cancel=()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);signal?.removeEventListener('abort',cancel);reject(signal?.reason??new Error('AVIF import cancelled.'));pump();};
    const entry={start(){if(signal?.aborted){cancel();return;}active=true;signal?.removeEventListener('abort',cancel);let released=false;resolve(()=>{if(released)return;released=true;active=false;pump();});}};
    waiting.push(entry);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();else pump();
  });
}
function run(blob:Blob,mode:'inspect',options:AvifDecodeOptions,control:AvifImportControl):Promise<AvifImportReport>;
function run(blob:Blob,mode:'decode',options:AvifDecodeOptions,control:AvifImportControl):Promise<Decoded>;
function run(blob:Blob,mode:'inspect'|'decode',options:AvifDecodeOptions,control:AvifImportControl):Promise<AvifImportReport|Decoded>{
  control.signal?.throwIfAborted();const settings=avifDecodeOptionsSchema.parse(options);
  if(typeof Worker==='undefined')return Promise.reject(new Error('AVIF import requires the browser worker host.'));
  return new Promise((resolve,reject)=>{
    let worker:Worker;try{worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});}catch(error){reject(error);return;}
    let settled=false,received=false,terminated=false;
    const terminate=()=>{if(!terminated){terminated=true;worker.terminate();}};
    const cleanup=()=>{terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;control.signal?.removeEventListener('abort',cancel);};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const cancel=()=>fail(control.signal?.reason??new Error('AVIF import cancelled.'));
    const finish=async(value:unknown)=>{
      if(settled||received)return;received=true;terminate();
      try{
        control.signal?.throwIfAborted();let result:AvifImportReport|Decoded;
        if(mode==='inspect')result=inspectedSchema.parse(value).report;
        else{
          const decoded=decodedSchema.parse(value),report=decoded.report;
          if(decoded.png.type!=='image/png'||!report.canDecode||report.requiresPrecisionLoss&&!settings.allowPrecisionLoss||report.requiresColorAssumption&&!settings.assumeSrgb)throw new Error('Invalid AVIF decoder result.');
          // Check the actual PNG header and native geometry before a caller can install it.
          const buffer=await decoded.png.slice(0,33).arrayBuffer(),bytes=new Uint8Array(buffer),view=new DataView(buffer);
          if(bytes.length!==33||[137,80,78,71,13,10,26,10].some((value,i)=>bytes[i]!==value)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(16)!==report.displayWidth||view.getUint32(20)!==report.displayHeight||bytes[24]!==8||bytes[25]!==6)throw new Error('AVIF decoder PNG geometry or pixel format differs from its report.');
          result=decoded;
        }
        control.signal?.throwIfAborted();if(settled)return;settled=true;cleanup();resolve(result);
      }catch(cause){fail(cause);}
    };
    control.signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=event=>{
      if(settled||received)return;
      try{const data=event.data;if(data&&typeof data.error==='string')fail(new Error(data.error));else if(data&&'progress'in data){control.onProgress?.(progressSchema.parse(data.progress));control.signal?.throwIfAborted();}else void finish(data);}catch(error){fail(error);}
    };
    worker.onerror=()=>fail(new Error('AVIF worker failed. Check the source, codec availability and device memory.'));
    worker.onmessageerror=()=>fail(new Error('Invalid AVIF worker message.'));
    try{worker.postMessage({blob,mode,options:settings});if(control.signal?.aborted)cancel();}catch(error){fail(error);}
  });
}
export const inspectAvifFile=async(blob:Blob,control:AvifImportControl={})=>run(blob,'inspect',{},control);
export const decodeAvifFile=async(blob:Blob,options:AvifDecodeOptions={},control:AvifImportControl={})=>{
  const settings=avifDecodeOptionsSchema.parse(options),release=await acquire(control.signal);
  try{return await run(blob,'decode',settings,control);}finally{release();}
};
