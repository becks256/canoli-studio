import {z} from 'zod';
import {decodeCompressedFont,validateDecodedFontSteps} from './compressed-font';
import {fontDigest} from './types';
let started=false;
self.onmessage=async(event:MessageEvent)=>{
 try{
  if(started)throw new Error('This decoder worker already owns a source.');started=true;
  const {bytes,identity,timeoutMs}=z.object({bytes:z.instanceof(Uint8Array),identity:z.object({unitsPerEm:z.number().int().positive().max(65535),glyphCount:z.number().int().positive().max(65535)}).strict(),timeoutMs:z.number().int().positive().max(0x7fffffff)}).strict().parse(event.data),deadline=performance.now()+timeoutMs,check=()=>{if(performance.now()>deadline)throw new Error('Font decoding exceeded its time budget.');};
  const decoded=await decodeCompressedFont(bytes,check);for(const _ of validateDecodedFontSteps(bytes,decoded,identity)){check();void _;}
  const sourceSha256=await fontDigest(bytes),decodedSha256=await fontDigest(decoded);check();self.postMessage({version:1,bytes:decoded,sourceSha256,decodedSha256},{transfer:[decoded.buffer]});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
