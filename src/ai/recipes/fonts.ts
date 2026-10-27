import {z} from 'zod';
import {fontFileSchema,type FontFileData} from '../../core/font-files';
import {fontFamilyNames} from '../../core/font-families';
import type {Recipe} from './types';

export const recipeFontFilesSchema=z.array(fontFileSchema).min(1).refine(files=>new Set(files.map(file=>file.id)).size===files.length,'Duplicate recipe font identity.');

/** Resource identities are content based, never source document identities. */
export function recipeFontFiles(recipe:Pick<Recipe,'schemaVersion'|'fontFiles'>):FontFileData[]{
  if(recipe.fontFiles===undefined){if(recipe.schemaVersion===2)throw new Error('Font recipe version 2 requires fontFiles.');return[];}
  if(recipe.schemaVersion!==2&&recipe.schemaVersion!==3)throw new Error('Font resources require recipe version 2 or 3.');
  return recipeFontFilesSchema.parse(recipe.fontFiles);
}

/** Only typography fields carry family references; ordinary text/name strings
 * that happen to resemble a generated family are never dependencies. */
export function recipeFontIds(value:unknown):Set<string>{
  const ids=new Set<string>(),family=(value:unknown)=>{if(typeof value!=='string')return;for(const name of fontFamilyNames(value)){const match=/^CanoliFont_([a-f0-9]{64})$/i.exec(name);if(match)ids.add(match[1].toLowerCase());}};
  const visit=(value:unknown)=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const child of value)visit(child);return;}
    const node=value as Record<string,unknown>;
    if(typeof node.type==='string'&&node.type.startsWith('font.file.')){if(typeof node.id==='string')ids.add(node.id);const file=node.file as FontFileData|undefined;if(file)ids.add(file.id);family(node.replaceWith);}
    if(node.type==='document.font.replace'){family(node.from);family(node.to);}
    for(const[key,child]of Object.entries(node)){if(key==='fontFamily')family(child);else if(key!=='resource'&&key!=='fontFiles')visit(child);}
  };visit(value);return ids;
}
