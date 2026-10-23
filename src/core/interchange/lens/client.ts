import {z} from 'zod';
import {lensCorrectionSchema,type LensCorrectionData} from '../raw/lens';
import {rawImportReportSchema,type RawImportReport} from '../raw/types';
import build from './codec/build.json';
import {lensCatalogSchema,type LensCatalog} from './catalog';

/** Trusted host only: inert XML parsing/hashing in a disposable private worker. */
export async function parseLensDatabaseFile(blob:Blob,name:string,signal?:AbortSignal):Promise<LensCatalog>{
  signal?.throwIfAborted();z.instanceof(Blob).parse(blob);z.string().min(1).max(1024).parse(name);
  return new Promise<LensCatalog>((resolve,reject)=>{
    const worker=new Worker(new URL('./database-worker.ts',import.meta.url),{type:'module'});let settled=false;
    const cleanup=()=>{worker.terminate();worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;signal?.removeEventListener('abort',abort);};
    const fail=(cause:unknown)=>{if(settled)return;settled=true;cleanup();reject(cause);};
    const abort=()=>fail(signal?.reason??new Error('Lens database import cancelled.'));
    worker.onmessage=event=>{if(settled)return;try{
      signal?.throwIfAborted();if(typeof event.data?.error==='string')throw new Error(event.data.error);
      const {catalog}=z.object({catalog:lensCatalogSchema}).strict().parse(event.data);
      if(catalog.source.name!==name||catalog.source.type!==blob.type||catalog.source.byteLength!==blob.size)throw new Error('Lens database result differs from its original file.');
      settled=true;cleanup();resolve(catalog);
    }catch(cause){fail(cause);}};
    worker.onerror=()=>fail(new Error('Lens database worker failed. Check the XML, parser availability and device memory.'));
    worker.onmessageerror=()=>fail(new Error('Invalid lens database worker reply.'));
    signal?.addEventListener('abort',abort,{once:true});try{if(signal?.aborted)abort();else worker.postMessage({kind:'parse-database',blob,name});}catch(cause){fail(cause);}
  });
}

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
