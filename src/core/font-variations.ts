import {z} from 'zod';
import parse from 'css-tree/parser';
import {fontFamilyNames} from './font-families';
import type {DocumentData,LayerData} from './model';

export interface FontAxisSetting {tag:string;value:number}
/** A bounded authored CSS value, independent of image/source geometry budgets. */
export function parseFontVariations(value:string):FontAxisSetting[]{
 if(value.length>65536)throw new Error('Font variation settings exceed the text-field budget.');
 if(value.trim().toLowerCase()==='normal')return[];
 const tree=parse(value,{context:'value'});if(tree.type!=='Value')throw new Error('Invalid font variation settings.');
 const nodes=tree.children.toArray(),result:FontAxisSetting[]=[],seen=new Set<string>();
 if(nodes.length===1&&nodes[0].type==='Identifier'&&nodes[0].name.toLowerCase()==='normal')return[];
 for(let index=0;index<nodes.length;index+=3){
  const tag=nodes[index],number=nodes[index+1],comma=nodes[index+2];
  if(tag?.type!=='String'||!/^([\x20-\x7e]){4}$/.test(tag.value)||number?.type!=='Number'||!Number.isFinite(Number(number.value))||comma&&(comma.type!=='Operator'||comma.value!==',')||index+3===nodes.length)
   throw new Error('Use normal or comma-separated four-character axis tags and finite numbers.');
  if(seen.has(tag.value))throw new Error('Font variation axis tags must be unique.');seen.add(tag.value);result.push({tag:tag.value,value:Number(number.value)});
 }
 if(!result.length)throw new Error('Font variation settings cannot be empty.');
 return result.sort((a,b)=>a.tag<b.tag?-1:a.tag>b.tag?1:0);
}
export function formatFontVariations(settings:readonly FontAxisSetting[]):string{
 return settings.length?settings.map(({tag,value})=>`${JSON.stringify(tag)} ${value}`).join(', '):'normal';
}
export const fontVariationSettingsSchema=z.string().max(65536).superRefine((value,context)=>{
 try{parseFontVariations(value);}catch(error){context.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid font variation settings.'});}
});
export function assertFontVariationRanges(settings:string,declared:readonly {tag:string;min:number;max:number}[]):void{
 const ranges=new Map(declared.map(value=>[value.tag,value]));
 for(const axis of parseFontVariations(settings)){const range=ranges.get(axis.tag);if(!range||axis.value<range.min||axis.value>range.max)throw new Error(`Font axis ${JSON.stringify(axis.tag)} is missing or outside its declared range.`);}
}
/** Headless/shared validation uses authenticated declared source metadata too.
 * Missing native sources remain a separate host readiness error; detached
 * constructors and estimated headless formatting cannot access browser faces. */
export function validateDeclaredFontVariations(document:DocumentData):void{
 const files=document.fontFiles??[];if(!files.length)return;
 const check=(format:{fontFamily:string;fontVariationSettings?:string})=>{
  if(format.fontVariationSettings===undefined)return;const names=fontFamilyNames(format.fontFamily),file=names.map(name=>files.find(value=>value.resource.report.faces[0].cssFamily.toLowerCase()===name)).find(Boolean);
  if(file)assertFontVariationRanges(format.fontVariationSettings,file.resource.report.faces[0].axes);
 };
 const walk=(nodes:readonly LayerData[])=>{for(const node of nodes)if(node.kind==='text')check(node);else if(node.kind==='group')walk(node.children);};walk(document.children);
 for(const style of document.paragraphStyles??[])check(style.format);
}
