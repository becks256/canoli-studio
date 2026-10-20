import {z} from 'zod';

const magic=new TextEncoder().encode('CANBLOB1');
const extent=z.number().int().nonnegative().safe();
const entrySchema=z.object({type:z.string(),size:extent,offset:extent,sha256:z.string().regex(/^[a-f0-9]{64}$/),file:z.object({name:z.string(),lastModified:z.number().finite()}).strict().optional()}).strict();
const envelopeSchema=z.object({format:z.literal('canoli-brush-container'),version:z.literal(1),data:z.unknown(),blobs:z.array(entrySchema)}).strict();
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer),n=>n.toString(16).padStart(2,'0')).join('');
export async function hashBrushBlob(blob:Blob,signal?:AbortSignal){
  signal?.throwIfAborted();const bytes=await blob.arrayBuffer();signal?.throwIfAborted();
  const hash=hex(await crypto.subtle.digest('SHA-256',bytes));signal?.throwIfAborted();return hash;
}
/** Source blobs are concatenated without source-sized JSON/base64 copies. */
export async function encodeBrushContainer(data:unknown,blobs:readonly Blob[],type:string,signal?:AbortSignal){
  let offset=0;const entries:z.infer<typeof entrySchema>[]=[];
  for(const blob of blobs){
    signal?.throwIfAborted();const file=typeof File!=='undefined'&&blob instanceof File?{name:blob.name,lastModified:blob.lastModified}:undefined;
    if(typeof File!=='undefined'&&blob instanceof File&&blob.webkitRelativePath)throw new Error('File directory metadata cannot be archived safely. Original browser data was preserved.');
    const entry={type:blob.type,size:blob.size,offset,sha256:await hashBrushBlob(blob,signal),...(file?{file}:{})};entrySchema.parse(entry);entries.push(entry);offset+=blob.size;if(!Number.isSafeInteger(offset))throw new Error('Brush container exceeds numeric addressing precision.');
  }
  const json=new TextEncoder().encode(JSON.stringify({format:'canoli-brush-container',version:1,data,blobs:entries}));
  const digest=await crypto.subtle.digest('SHA-256',json);signal?.throwIfAborted();
  if(!Number.isSafeInteger(48+json.length+offset))throw new Error('Brush container exceeds numeric addressing precision.');
  const header=new Uint8Array(48);header.set(magic);new DataView(header.buffer).setBigUint64(8,BigInt(json.length),true);header.set(new Uint8Array(digest),16);
  return {blob:new Blob([header,json,...blobs],{type}),fingerprint:hex(digest)};
}
/** Null identifies a legacy JSON file. Binary metadata and every blob must verify. */
export async function readBrushContainer(file:Blob,signal?:AbortSignal){
  signal?.throwIfAborted();const header=new Uint8Array(await file.slice(0,48).arrayBuffer());signal?.throwIfAborted();
  if(!magic.every((n,i)=>header[i]===n))return null;
  if(header.length!==48)throw new Error('Truncated brush container header.');
  const wide=new DataView(header.buffer).getBigUint64(8,true);if(wide>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Brush manifest exceeds numeric addressing precision.');
  const length=Number(wide),start=48+length;if(!Number.isSafeInteger(start)||start>file.size)throw new Error('Truncated brush container manifest.');
  const json=await file.slice(48,start).arrayBuffer(),fingerprint=hex(await crypto.subtle.digest('SHA-256',json));signal?.throwIfAborted();
  if(fingerprint!==hex(header.slice(16).buffer))throw new Error('Brush manifest checksum mismatch.');
  const envelope=envelopeSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json)));
  let offset=0;const blobs:Blob[]=[];
  for(const entry of envelope.blobs){
    if(entry.offset!==offset||!Number.isSafeInteger(start+offset+entry.size)||start+offset+entry.size>file.size)throw new Error('Invalid brush source extent.');
    let blob=file.slice(start+offset,start+offset+entry.size,entry.type);
    if(blob.type!==entry.type)throw new Error('Invalid brush source MIME type.');
    if(entry.file){
      if(typeof File==='undefined')throw new Error('Original file metadata requires the native File host.');
      blob=new File([blob],entry.file.name,{type:entry.type,lastModified:entry.file.lastModified});
      if((blob as File).name!==entry.file.name||(blob as File).lastModified!==entry.file.lastModified)throw new Error('Invalid original file metadata.');
    }
    if(await hashBrushBlob(blob,signal)!==entry.sha256)throw new Error('Brush source checksum mismatch.');
    blobs.push(blob);offset+=entry.size;
  }
  if(start+offset!==file.size)throw new Error('Unexpected trailing brush container data.');
  signal?.throwIfAborted();return {data:envelope.data,blobs,fingerprint};
}
