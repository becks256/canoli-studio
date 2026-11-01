import {z} from 'zod';
import {encodeFontRun} from './shaping-types';
let started=false;
self.onmessage=async(event:MessageEvent)=>{
 try{if(started)throw new Error('This shaping worker already owns a source.');started=true;
  const request=z.object({bytes:z.instanceof(Uint8Array),input:z.unknown(),settings:z.string(),timeoutMs:z.number().int().positive().max(0x7fffffff)}).strict().parse(event.data),deadline=performance.now()+request.timeoutMs,check=()=>{if(performance.now()>deadline)throw new Error('Font shaping exceeded its time budget.');};
  // Install the message handler before asynchronous WASM initialization.
  const {shapeFontRun}=await import('./shaping');check();
  const result=shapeFontRun(request.bytes,request.input as Parameters<typeof shapeFontRun>[1],request.settings,check);check();const encoded=encodeFontRun(result);self.postMessage(encoded,{transfer:[encoded.data.buffer]});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
