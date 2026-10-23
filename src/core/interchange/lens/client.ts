import {z} from 'zod';
import {lensCorrectionSchema,type LensCorrectionData} from '../raw/lens';
import {rawImportReportSchema,type RawImportReport} from '../raw/types';
import build from './codec/build.json';

/** Trusted browser preflight owns no image bytes and publishes no assets/settings. */
export async function validateRawLensProfile(lens:LensCorrectionData|undefined,report:RawImportReport,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();if(!lens?.enabled||!lens.profile)return;
  const request={lens:lensCorrectionSchema.parse(lens),report:rawImportReportSchema.parse(report)};
  const reply=z.object({ok:z.literal(true),identity:z.literal(build.artifacts['canoli_lens_correction.wasm'].sha256)}).strict();
  await new Promise<void>((resolve,reject)=>{
    const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});let settled=false;
    const finish=(error?:unknown)=>{if(settled)return;settled=true;worker.terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(signal?.reason??new Error('Lens validation cancelled.'));
    worker.onmessage=event=>{try{signal?.throwIfAborted();if(typeof event.data?.error==='string')throw new Error(event.data.error);reply.parse(event.data);finish();}catch(cause){finish(cause);}};
    worker.onerror=()=>finish(new Error('Lens validation worker failed. Check native availability and device memory.'));
    worker.onmessageerror=()=>finish(new Error('Invalid lens validation worker reply.'));
    signal?.addEventListener('abort',abort,{once:true});try{if(signal?.aborted)abort();else worker.postMessage(request);}catch(cause){finish(cause);}
  });
  signal?.throwIfAborted();
}
