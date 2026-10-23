import {artworkContentSchema,artworkMetadataSchema,type PreparedArtwork} from './model';
export type ArtworkWorkerRequest={type:'inspect'|'import';blob:Blob}|{type:'export';entries:PreparedArtwork[]};
export async function artworkWorker(request:ArtworkWorkerRequest,signal?:AbortSignal):Promise<unknown>{
 signal?.throwIfAborted();const worker=new Worker(new URL('./library.worker.ts',import.meta.url),{type:'module'});let cancel=()=>{};
 try{return await new Promise((resolve,reject)=>{let settled=false;
  const fail=(error:unknown)=>{if(settled)return;settled=true;reject(error);},abort=()=>fail(signal?.reason??new DOMException('Artwork operation cancelled.','AbortError'));
  cancel=abort;worker.onmessage=event=>{if(settled)return;try{signal?.throwIfAborted();const data=event.data;if(data?.ok!==true)throw new Error(typeof data?.error==='string'?data.error:'Artwork library preparation failed.');let value:unknown;
   if(request.type==='inspect')value=artworkContentSchema.parse(data.value);
   else if(request.type==='export'){if(!(data.value instanceof Blob))throw new Error('Invalid artwork pack result.');value=data.value;}
   else{if(!Array.isArray(data.value))throw new Error('Invalid artwork import result.');value=data.value.map((item:PreparedArtwork)=>{const content=artworkContentSchema.parse(item.content),metadata=artworkMetadataSchema.parse(item.metadata);if(!(item.blob instanceof Blob)||item.blob.size!==content.bytes)throw new Error('Invalid artwork payload extent.');return{metadata,content,blob:item.blob};});}
   settled=true;resolve(value);
  }catch(error){fail(error);}};worker.onerror=event=>{event.preventDefault();fail(new Error('Artwork preparation worker failed. Retry the operation.'));};worker.onmessageerror=()=>fail(new Error('Invalid artwork worker message.'));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{worker.postMessage(request);}catch(error){fail(error);}
 });}finally{signal?.removeEventListener('abort',cancel);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();}
}
