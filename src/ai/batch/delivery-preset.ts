import {z} from 'zod';
import {deliveryVariantSpecSchema} from './schema';
import type {DeliveryVariantSpec} from './types';
import {computeSha256} from './manifest';
const magic=new TextEncoder().encode('CANDELV1');
const extent=z.number().int().nonnegative().safe();
const blobSchema=z.object({sha256:z.string().regex(/^[a-f0-9]{64}$/),size:extent.positive(),offset:extent}).strict();
const envelope=z.object({format:z.literal('canoli-delivery'),version:z.literal(1),name:z.string().trim().min(1).max(120),variants:z.array(z.unknown()).min(1),profiles:z.array(blobSchema)}).strict();
export interface DeliveryPreset {name:string;variants:DeliveryVariantSpec[]}
export function validateDeliveryVariants(input:unknown):DeliveryVariantSpec[]{
 const variants=z.array(deliveryVariantSpecSchema).min(1).parse(input);
 if(new Set(variants.map(v=>v.id)).size!==variants.length)throw new Error('Delivery variant IDs must be unique.');
 return variants;
}
/** Inert transport: validate the entire byte graph. Native admission belongs to the host. */
export async function encodeDeliveryPreset(input:DeliveryPreset,signal?:AbortSignal):Promise<Blob>{
 const name=z.string().trim().min(1).max(120).parse(input.name),variants=validateDeliveryVariants(input.variants);
 const profiles:z.infer<typeof blobSchema>[]=[],blobs:Blob[]=[],indices=new Map<string,number>();let offset=0;
 const records=[];
 for(const variant of variants){
  signal?.throwIfAborted();if(!variant.color){records.push(variant);continue;}
  const{source,...profile}=variant.color.profile,sha256=await computeSha256(await source.arrayBuffer());signal?.throwIfAborted();
  if(sha256!==profile.sha256)throw new Error('Delivery ICC source checksum mismatch.');
  let index=indices.get(sha256);
  if(index===undefined){index=profiles.length;indices.set(sha256,index);profiles.push({sha256,size:source.size,offset});blobs.push(new Blob([source],{type:'application/vnd.iccprofile'}));offset+=source.size;if(!Number.isSafeInteger(offset))throw new Error('Delivery sources exceed numeric addressing precision.');}
  records.push({...variant,color:{...variant.color,profile:{...profile,source:index}}});
 }
 const data=new TextEncoder().encode(JSON.stringify({format:'canoli-delivery',version:1,name,variants:records,profiles}));envelope.parse(JSON.parse(new TextDecoder().decode(data)));
 const header=new Uint8Array(48);header.set(magic);new DataView(header.buffer).setBigUint64(8,BigInt(data.length),true);header.set(Uint8Array.from((await computeSha256(data)).match(/../g)!,v=>parseInt(v,16)),16);signal?.throwIfAborted();
 return new Blob([header,data,...blobs],{type:'application/x-canoli-delivery'});
}
export async function readDeliveryPreset(file:Blob,signal?:AbortSignal):Promise<DeliveryPreset>{
 signal?.throwIfAborted();const header=new Uint8Array(await file.slice(0,48).arrayBuffer());
 if(header.length!==48||!magic.every((value,i)=>header[i]===value))throw new Error('Invalid delivery preset header.');
 const wide=new DataView(header.buffer).getBigUint64(8,true);if(wide>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Delivery manifest exceeds numeric addressing precision.');
 const start=48+Number(wide);if(!Number.isSafeInteger(start)||start>file.size)throw new Error('Truncated delivery manifest.');
 const data=new Uint8Array(await file.slice(48,start).arrayBuffer()),digest=await computeSha256(data);signal?.throwIfAborted();
 if(digest!==Array.from(header.slice(16),n=>n.toString(16).padStart(2,'0')).join(''))throw new Error('Delivery manifest checksum mismatch.');
 const manifest=envelope.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data))),blobs:Blob[]=[],seen=new Set<string>();let offset=0;
 for(const entry of manifest.profiles){
  if(entry.offset!==offset||seen.has(entry.sha256)||!Number.isSafeInteger(start+offset+entry.size)||start+offset+entry.size>file.size)throw new Error('Invalid delivery profile extent or duplicate source.');
  const blob=file.slice(start+offset,start+offset+entry.size,'application/vnd.iccprofile');if(await computeSha256(await blob.arrayBuffer())!==entry.sha256)throw new Error('Delivery ICC source checksum mismatch.');signal?.throwIfAborted();blobs.push(blob);seen.add(entry.sha256);offset+=entry.size;
 }
 if(start+offset!==file.size)throw new Error('Unexpected trailing delivery preset data.');
 const referenced=new Set<number>();
 const variants=manifest.variants.map(value=>{
  const item=z.object({color:z.unknown().optional()}).passthrough().parse(value);if(item.color===undefined)return item;
  const color=z.object({profile:z.object({name:z.string(),sha256:z.string(),source:extent}).strict()}).passthrough().parse(item.color),index=color.profile.source,source=blobs[index];
  if(!source||manifest.profiles[index].sha256!==color.profile.sha256)throw new Error('Missing or mismatched delivery ICC source.');referenced.add(index);
  return{...item,color:{...color,profile:{...color.profile,source}}};
 });
 if(referenced.size!==blobs.length)throw new Error('Unreferenced delivery ICC source.');
 return{name:manifest.name,variants:validateDeliveryVariants(variants)};
}
