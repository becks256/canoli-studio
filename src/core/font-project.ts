import {z} from 'zod';
import type {DocumentData} from './model';
import {documentFontFiles,type FontFileData} from './font-files';
import {fontResourceDescriptorSchema,ownFontResource,sameFontResource,type FontResourceInput} from '../fonts/resources';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const payloadSchema=z.object({sha256:digest,size:z.number().int().positive().safe(),offset:z.number().int().nonnegative().safe()}).strict();
const resourceSchema=z.object({descriptor:fontResourceDescriptorSchema,originalIndex:z.number().int().nonnegative().safe(),renderIndex:z.number().int().nonnegative().safe()}).strict();
export const projectFontsSchema=z.object({payloads:z.array(payloadSchema).min(1),resources:z.array(resourceSchema).min(1)}).strict();
export type ProjectFonts=z.infer<typeof projectFontsSchema>;
export interface ProjectFontSource {get(id:string):Readonly<FontResourceInput>}

/** The complete retained graph, including unused embedded masters. */
export function retainedFontFiles(documents:readonly DocumentData[]):FontFileData[]{
  const files=new Map<string,FontFileData>();
  for(const document of documents)for(const file of documentFontFiles(document)){
    const previous=files.get(file.id);
    if(previous&&!sameFontResource(previous.resource,file.resource))throw new Error('Conflicting retained font declarations.');
    if(!previous)files.set(file.id,file);
  }
  return[...files.values()];
}

/** Snapshot every source synchronously before any encoding/transport await. */
export function captureProjectFonts(documents:readonly DocumentData[],source?:ProjectFontSource):FontResourceInput[]{
  return retainedFontFiles(documents).map(file=>{
    if(!source)throw new Error(`Missing project font source: ${file.name}`);
    const resource=source.get(file.id);
    if(!sameFontResource(resource.descriptor,file.resource))throw new Error(`Project font declaration differs from its source: ${file.name}`);
    return{descriptor:fontResourceDescriptorSchema.parse(resource.descriptor),original:resource.original,renderBlob:resource.renderBlob};
  });
}

export async function encodeProjectFonts(inputs:readonly FontResourceInput[],startOffset:number):Promise<{manifest?:ProjectFonts;blobs:Blob[];endOffset:number}>{
  if(!inputs.length)return{blobs:[],endOffset:startOffset};
  const payloads:ProjectFonts['payloads']=[],resources:ProjectFonts['resources']=[],blobs:Blob[]=[],indices=new Map<string,number>();
  let offset=startOffset;
  const add=(blob:Blob,sha256:string)=>{
    const key=`${sha256}:${blob.size}`,existing=indices.get(key);if(existing!==undefined)return existing;
    const index=payloads.length;indices.set(key,index);payloads.push({sha256,size:blob.size,offset});blobs.push(blob);offset+=blob.size;
    if(!Number.isSafeInteger(offset))throw new Error('Project size exceeds safely representable offsets.');return index;
  };
  for(const input of inputs){
    const value=await ownFontResource(input);
    resources.push({descriptor:value.descriptor,originalIndex:add(value.original,value.descriptor.report.sha256),renderIndex:add(value.renderBlob,value.descriptor.render.sha256)});
  }
  return{manifest:{payloads,resources},blobs,endOffset:offset};
}

export async function decodeProjectFonts(input:unknown,documents:readonly DocumentData[],file:Blob,payloadStart:number,startOffset:number):Promise<{fonts:FontResourceInput[];endOffset:number}>{
  const declarations=retainedFontFiles(documents);
  if(input===undefined){if(declarations.length)throw new Error('Missing embedded font records.');return{fonts:[],endOffset:startOffset};}
  const manifest=projectFontsSchema.parse(input),blobs:Blob[]=[],used=new Set<number>(),keys=new Set<string>();
  let offset=startOffset;
  for(const payload of manifest.payloads){
    const key=`${payload.sha256}:${payload.size}`;
    if(payload.offset!==offset||!Number.isSafeInteger(offset+payload.size)||offset+payload.size>file.size-payloadStart||keys.has(key))throw new Error('Invalid, duplicate or truncated font payload.');
    keys.add(key);blobs.push(file.slice(payloadStart+offset,payloadStart+offset+payload.size));offset+=payload.size;
  }
  const files=new Map(declarations.map(value=>[value.id,value])),seen=new Set<string>(),fonts:FontResourceInput[]=[];
  for(const entry of manifest.resources){
    const id=entry.descriptor.report.faces[0].id,fileEntry=files.get(id);
    if(seen.has(id)||!fileEntry||!sameFontResource(fileEntry.resource,entry.descriptor))throw new Error('Unused, duplicate or conflicting project font resource.');
    seen.add(id);
    const original=manifest.payloads[entry.originalIndex],render=manifest.payloads[entry.renderIndex];
    if(!original||!render||original.sha256!==entry.descriptor.report.sha256||original.size!==entry.descriptor.report.byteLength||render.sha256!==entry.descriptor.render.sha256||render.size!==entry.descriptor.render.byteLength)throw new Error('Font payload reference differs from its descriptor.');
    used.add(entry.originalIndex);used.add(entry.renderIndex);
    const resource=await ownFontResource({descriptor:entry.descriptor,original:blobs[entry.originalIndex],renderBlob:blobs[entry.renderIndex].slice(0,render.size,`font/${entry.descriptor.render.format}`)});
    fonts.push(resource);
  }
  if(seen.size!==files.size||used.size!==blobs.length)throw new Error('Missing font resources or unused font payloads.');
  return{fonts,endOffset:offset};
}
