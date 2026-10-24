import {z} from 'zod';
import {fontResourceDescriptorSchema,sameFontResource} from '../fonts/resources';
import type {DocumentData} from './model';
import {isImmutable} from './immutable';
import {documentFontUsage} from './font-management';
import {fontFamilyNames} from './font-families';

/** Serialized declaration; public mutation uses FontFile and DocumentFonts. */
export const fontFileSchema=z.object({id:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().min(1).max(240).refine(value=>value.trim().length>0,'A font file needs a name.'),resource:fontResourceDescriptorSchema}).strict().refine(value=>value.id===value.resource.report.faces[0].id,'Font file identity differs from its resource.');
export type FontFileData=z.infer<typeof fontFileSchema>;
const cachedFiles=new WeakMap<DocumentData,readonly FontFileData[]>();

export function visitFontFileScopes(document:DocumentData,visit:(scope:DocumentData)=>void):void{
  const pending=[document],seen=new Set<DocumentData>();
  while(pending.length){const scope=pending.pop()!;if(seen.has(scope))continue;seen.add(scope);visit(scope);for(const definition of scope.components??[])if(definition.source.kind==='document')pending.push(definition.source.document);}
}

/** Every stored scope, including unused masters, keeps its original sources. */
export function documentFontFiles(document:DocumentData):FontFileData[]{
  const cached=isImmutable(document)?cachedFiles.get(document):undefined;if(cached)return[...cached];
  const values=new Map<string,FontFileData>();
  visitFontFileScopes(document,scope=>{for(const value of scope.fontFiles??[]){const previous=values.get(value.id);if(previous&&!sameFontResource(previous.resource,value.resource))throw new Error('Conflicting font resources share an identity.');if(!previous)values.set(value.id,value);}});
  const result=[...values.values()];if(isImmutable(document))cachedFiles.set(document,Object.freeze(result));return[...result];
}
export const referencedFontFiles=(document:DocumentData)=>new Set(documentFontFiles(document).map(value=>value.id));

/** Bind inherited source families when artwork leaves its owning document. */
export function fontFilesForArtwork(source:DocumentData,artwork:DocumentData):FontFileData[]{
  const files=new Map(documentFontFiles(artwork).map(value=>[value.id,value]));
  const requests=new Set(documentFontUsage(artwork).flatMap(value=>fontFamilyNames(value.family)));
  for(const file of documentFontFiles(source))if(requests.has(file.resource.report.faces[0].cssFamily.toLowerCase()))files.set(file.id,file);
  return[...files.values()];
}
