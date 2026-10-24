import {z} from 'zod';
import {inspectFontBytes,prepareFontBytes} from './parser';
import {fontInspectOptionsSchema,fontPrepareOptionsSchema} from './types';

let started=false;
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This font worker already owns a source.');started=true;
    const request=z.object({blob:z.instanceof(Blob),mode:z.enum(['inspect','prepare']),options:z.unknown(),timeoutMs:z.number().int().positive().max(0x7fffffff)}).strict().parse(event.data);
    const deadline=performance.now()+request.timeoutMs,check=()=>{if(performance.now()>deadline)throw new Error('Font source operation exceeded its time budget.');};
    self.postMessage({progress:{phase:'reading',fraction:null}});
    const bytes=new Uint8Array(await request.blob.arrayBuffer());check();
    if(request.mode==='inspect'){
      self.postMessage({progress:{phase:'inspecting',fraction:null}});
      const report=await inspectFontBytes(bytes,fontInspectOptionsSchema.parse(request.options),check);check();self.postMessage({report});
    }else{
      self.postMessage({progress:{phase:'extracting',fraction:null}});
      const prepared=await prepareFontBytes(bytes,fontPrepareOptionsSchema.parse(request.options),check);check();self.postMessage(prepared);
    }
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
