import {z} from 'zod';
import {parseLensDatabaseXml} from './xml';

const requestSchema=z.object({kind:z.literal('parse-database'),blob:z.instanceof(Blob),name:z.string().min(1).max(1024)}).strict();
let started=false;
// Data admission has no dependency on the native correction module or its URL.
self.onmessage=async(event:MessageEvent)=>{
  try{
    if(started)throw new Error('This lens database worker already owns a request.');started=true;
    const {blob,name}=requestSchema.parse(event.data),bytes=await blob.arrayBuffer();
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const catalog=parseLensDatabaseXml(new TextDecoder('utf-8',{fatal:true}).decode(bytes),{name,type:blob.type,byteLength:blob.size,sha256});
    self.postMessage({catalog});
  }catch(cause){self.postMessage({error:cause instanceof Error?cause.message:String(cause)});}
};
