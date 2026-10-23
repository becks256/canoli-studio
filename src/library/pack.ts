import {z} from 'zod';
import {Sha256} from '../core/sha256';
import {readProject} from '../core/project';
import {allLayers} from '../core/model';
import {artworkMetadataSchema,artworkContentSchema,type PreparedArtwork} from './model';
const MAGIC=new TextEncoder().encode('CANOART1'),MANIFEST_BYTES=16*1024*1024;
export async function hashArtworkBlob(blob:Blob){const hash=new Sha256();for(let offset=0;offset<blob.size;offset+=1024*1024)hash.update(new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer()));return hash.digest();}
export async function inspectArtwork(blob:Blob){
 const project=await readProject(blob);if(project.history&&(project.history.past.length||project.history.future.length))throw new Error('Library artwork must not include unrelated undo/redo history.');
 return artworkContentSchema.parse({sha256:await hashArtworkBlob(blob),bytes:blob.size,width:project.document.width,height:project.document.height,layers:allLayers(project.document.children).length});
}
const manifestSchema=z.object({format:z.literal('canoli-artwork-pack'),version:z.literal(1),entries:z.array(z.object({metadata:artworkMetadataSchema,content:artworkContentSchema,offset:z.number().int().nonnegative().safe()}).strict()).min(1)}).strict();
/** Data-only native projects. No image surfaces or third-party commands execute on install. */
export async function encodeArtworkPack(input:PreparedArtwork[]):Promise<Blob>{
 let offset=0;const entries=[];
 for(const item of input){const content=await inspectArtwork(item.blob);if(JSON.stringify(content)!==JSON.stringify(artworkContentSchema.parse(item.content)))throw new Error('Artwork changed before pack export.');entries.push({metadata:artworkMetadataSchema.parse(item.metadata),content,offset});offset+=content.bytes;if(!Number.isSafeInteger(offset))throw new Error('Artwork pack exceeds representable offsets.');}
 const manifest=manifestSchema.parse({format:'canoli-artwork-pack',version:1,entries}),json=new TextEncoder().encode(JSON.stringify(manifest));if(json.byteLength>MANIFEST_BYTES)throw new Error('Artwork pack metadata exceeds 16 MiB. Export smaller selections of library entries.');
 const header=new Uint8Array(48);header.set(MAGIC);new DataView(header.buffer).setBigUint64(8,BigInt(json.byteLength),true);header.set(Uint8Array.from((await hashArtworkBlob(new Blob([json]))).match(/../g)!,byte=>parseInt(byte,16)),16);
 return new Blob([header,json,...input.map(item=>item.blob)],{type:'application/x-canoli-artwork-pack'});
}
export async function readArtworkPack(blob:Blob):Promise<PreparedArtwork[]>{
 if(!(blob instanceof Blob)||blob.size<48)throw new Error('Invalid artwork pack header.');const header=new Uint8Array(await blob.slice(0,48).arrayBuffer());if(!MAGIC.every((byte,index)=>header[index]===byte))throw new Error('Unsupported artwork pack format.');
 const length=Number(new DataView(header.buffer).getBigUint64(8,true));if(!Number.isSafeInteger(length)||length<=0||length>MANIFEST_BYTES||length>blob.size-48)throw new Error('Invalid artwork pack metadata extent.');
 const body=blob.slice(48,48+length),expected=Array.from(header.slice(16),byte=>byte.toString(16).padStart(2,'0')).join('');if(await hashArtworkBlob(body)!==expected)throw new Error('Artwork pack metadata failed its integrity check.');const manifest=manifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await body.arrayBuffer()))),result:PreparedArtwork[]=[],seen=new Set<string>();let offset=0;
 for(const entry of manifest.entries){if(entry.offset!==offset||!Number.isSafeInteger(offset+entry.content.bytes)||48+length+offset+entry.content.bytes>blob.size||seen.has(entry.content.sha256))throw new Error('Artwork pack entries overlap, repeat or have invalid extents.');seen.add(entry.content.sha256);const project=blob.slice(48+length+offset,48+length+offset+entry.content.bytes,'application/x-luma'),content=await inspectArtwork(project);if(JSON.stringify(content)!==JSON.stringify(entry.content))throw new Error('Artwork pack content failed its integrity or geometry check.');result.push({metadata:entry.metadata,content,blob:project});offset+=entry.content.bytes;}
 if(48+length+offset!==blob.size)throw new Error('Artwork pack has unclaimed trailing bytes.');return result;
}
