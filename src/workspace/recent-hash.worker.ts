import {Sha256} from '../core/sha256';

export const RECENT_HASH_CHUNK=1024*1024;
let active=false;
self.onmessage=async(event:MessageEvent)=>{
 try{
  const request=event.data;if(active||!request||request.type!=='hash'||Object.keys(request).some(key=>!['type','blob'].includes(key))||!(request.blob instanceof Blob)||!Number.isSafeInteger(request.blob.size)||request.blob.size<0)throw new Error('Invalid recent-file hash request.');active=true;
  const hash=new Sha256();let chunks=0,maxChunk=0;self.postMessage({type:'started'});
  for(let offset=0;offset<request.blob.size;offset+=RECENT_HASH_CHUNK){const bytes=new Uint8Array(await request.blob.slice(offset,offset+RECENT_HASH_CHUNK).arrayBuffer());if(bytes.byteLength!==Math.min(RECENT_HASH_CHUNK,request.blob.size-offset))throw new Error('Incomplete recent-file bytes.');hash.update(bytes);chunks++;maxChunk=Math.max(maxChunk,bytes.byteLength);}
  self.postMessage({type:'complete',sha256:hash.digest(),size:request.blob.size,chunks,maxChunk});
 }catch(error){self.postMessage({type:'error',error:error instanceof Error?error.message:String(error)});}
};
