const CHUNK=1024*1024;
/** Clone an immutable Blob handle, never allocate or transfer a source-sized host buffer. */
export function hashRecentBlob(blob:Blob,signal?:AbortSignal):Promise<string>{
 signal?.throwIfAborted();if(!(blob instanceof Blob)||!Number.isSafeInteger(blob.size)||blob.size<0)throw new Error('Invalid recent-file bytes.');
 const worker=new Worker(new URL('./recent-hash.worker.ts',import.meta.url),{type:'module'});
 return new Promise((resolve,reject)=>{
  let settled=false,started=false;
  const cleanup=()=>{signal?.removeEventListener('abort',abort);worker.removeEventListener('messageerror',messageError);worker.onmessage=null;worker.onerror=null;worker.terminate();};
  const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
  const abort=()=>fail(signal?.reason??new DOMException('Recent-file operation cancelled.','AbortError'));
  const messageError=()=>fail(new Error('Invalid recent-file worker message.'));
  worker.addEventListener('messageerror',messageError);signal?.addEventListener('abort',abort,{once:true});worker.onerror=event=>{event.preventDefault();fail(new Error('Recent-file integrity checking failed. Try again.'));};
  worker.onmessage=(event:MessageEvent)=>{if(settled)return;const value=event.data;if(value?.type==='started'&&Object.keys(value).length===1&&!started){started=true;return;}if(value?.type==='error'&&typeof value.error==='string'){fail(new Error(value.error));return;}
   if(value?.type!=='complete'||Object.keys(value).some(key=>!['type','sha256','size','chunks','maxChunk'].includes(key))||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||value.size!==blob.size||value.chunks!==Math.ceil(blob.size/CHUNK)||value.maxChunk!==Math.min(blob.size,CHUNK)){fail(new Error('Invalid recent-file integrity result.'));return;}
   if(signal?.aborted){abort();return;}settled=true;cleanup();resolve(value.sha256);
  };
  try{signal?.throwIfAborted();worker.postMessage({type:'hash',blob});}catch(error){fail(error);}
 });
}
