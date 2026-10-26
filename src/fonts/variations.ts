import {parseFontVariations,formatFontVariations,assertFontVariationRanges,type FontAxisSetting} from '../core/font-variations';
import {replaceFontFamilyToken,fontFamilyNames} from '../core/font-families';
import type {FontFaceInfo} from './types';

export interface NativeVariationSet {add(face:FontFace):void;delete(face:FontFace):boolean;has(face:FontFace):boolean}
interface Variant {family:string;faces:FontFace[];states:string[];pins:number}
interface Source {bytes:ArrayBuffer;info:FontFaceInfo;check:()=>void;variants:Map<string,Variant>}
const sources=new WeakMap<object,Map<string,Source>>();let serial=0;
const state=(face:FontFace)=>JSON.stringify(['family','style','weight','stretch','unicodeRange','status','variationSettings','featureSettings','ascentOverride','descentOverride','lineGapOverride','display','sizeAdjust'].map(key=>(face as unknown as Record<string,unknown>)[key]));
const currentSet=():NativeVariationSet|null=>globalThis.document?.fonts??(globalThis as typeof globalThis&{fonts?:FontFaceSet}).fonts??null;
/** Read-only native ownership/validation for shared typography measurement. */
export function isOwnedNativeFontFamily(family:string):boolean{
 const set=currentSet(),source=set?sources.get(set)?.get(family.toLowerCase()):undefined;if(source)source.check();return !!source;
}
export function assertNativeFontVariations(family:string,settings='normal'):void{
 if(!parseFontVariations(settings).length)return;
 const set=currentSet();if(!set||typeof FontFace==='undefined'||!('variationSettings'in FontFace.prototype))throw new Error('This browser cannot render native font variations.');
 const source=fontFamilyNames(family).map(name=>sources.get(set)?.get(name)).find(Boolean);
 if(!source)throw new Error('Styled font variations require an owned embedded source.');source.check();assertFontVariationRanges(settings,source.info.axes);
}
// A native-face cache budget, independent of source/font/document admission.
// Captured operations may retain additional instances until their lease ends.
function trim(set:NativeVariationSet,source:Source){
 let unpinned=[...source.variants.values()].filter(value=>!value.pins).length;
 for(const[key,value]of source.variants){if(unpinned<=64)break;if(value.pins)continue;source.variants.delete(key);for(const face of value.faces)set.delete(face);unpinned--;}
}
function checkVariant(set:NativeVariationSet,variant:Variant){
 if(variant.faces.some((face,index)=>face.status!=='loaded'||!set.has(face)||state(face)!==variant.states[index]))throw new Error('An owned variable-font instance changed.');
 if(Symbol.iterator in set){const actual=[...(set as NativeVariationSet&Iterable<FontFace>)].filter(face=>face.family===variant.family);if(actual.length!==variant.faces.length||actual.some(face=>!variant.faces.includes(face)))throw new Error('An owned variable-font family changed.');}
}
/** Private host registration. Bytes never enter the public DOM or script API. */
export function registerFontVariationSource(set:NativeVariationSet,bytes:ArrayBuffer,info:FontFaceInfo,check:()=>void):()=>void{
 let registry=sources.get(set);if(!registry){registry=new Map();sources.set(set,registry);}
 const key=info.cssFamily.toLowerCase();if(registry.has(key))throw new Error('Duplicate native variable-font source registration.');
 const source:Source={bytes,info,check,variants:new Map()};registry.set(key,source);
 return()=>{if(registry!.get(key)!==source)return;registry!.delete(key);for(const variant of source.variants.values())for(const face of variant.faces)set.delete(face);source.variants.clear();};
}
export function checkFontVariationSource(set:NativeVariationSet,family:string):void{
 const source=sources.get(set)?.get(family.toLowerCase());if(!source)return;source.check();for(const variant of source.variants.values())checkVariant(set,variant);
}
export function captureNativeFontVariations(styles:readonly {fontFamily:string;fontVariationSettings?:string}[]):{families:string[];check():void;release():void}{
 const set=currentSet(),pinned:{source:Source;variant:Variant}[]=[],families:string[]=[];
 let released=false;
 const release=()=>{if(released)return;released=true;for(const{variant}of pinned)variant.pins--;if(set)for(const source of new Set(pinned.map(value=>value.source)))trim(set,source);};
 try{
  for(const style of styles){
   const axes=parseFontVariations(style.fontVariationSettings??'normal');if(!axes.length){families.push(style.fontFamily);continue;}
   families.push(nativeVariationFamily(style.fontFamily,style.fontVariationSettings));
   const registry=set?sources.get(set):undefined;
   for(const source of new Set(fontFamilyNames(style.fontFamily).map(name=>registry?.get(name)).filter((value):value is Source=>!!value))){
    const effective=fallbackAxes(source,axes);if(!effective.length)continue;const variant=source.variants.get(formatFontVariations(effective));
    if(!variant||!set)throw new Error('The native font variation instance is missing.');checkVariant(set,variant);variant.pins++;pinned.push({source,variant});
   }
  }
  return{families,release,check:()=>{if(released)throw new Error('The native font variation capture ended.');if(set)for(const{source,variant}of pinned){source.check();checkVariant(set,variant);}}};
 }catch(error){release();throw error;}
}
/** Each axis tuple gets separate native faces: two layers never mutate one
 * another's font. Binary faces must be ready before synchronous measurement. */
export function nativeVariationFamily(family:string,settings='normal'):string{
 const axes=parseFontVariations(settings);if(!axes.length)return family;
 const set=currentSet();if(!set||typeof FontFace==='undefined'||!('variationSettings'in FontFace.prototype))throw new Error('This browser cannot render native font variations. Reset variable axes to continue.');
 const registry=sources.get(set),names=fontFamilyNames(family);const source=names.map(name=>registry?.get(name)).find(Boolean);
 if(!source)throw new Error('Variable axes require an embedded font source. Embed the selected variable font or reset variable axes.');
 assertFontVariationRanges(settings,source.info.axes);
 let result=family;
 for(const candidate of new Set(names.map(name=>registry?.get(name)).filter((value):value is Source=>!!value))){
  candidate.check();const effective=fallbackAxes(candidate,axes);if(effective.length)result=replaceFontFamilyToken(result,candidate.info.cssFamily,instanceFamily(set,candidate,effective));
 }
 return result;
}
/** CSS ignores unknown fallback axes and clamps values to each fallback face. */
function fallbackAxes(source:Source,axes:readonly FontAxisSetting[]):FontAxisSetting[]{
 const ranges=new Map(source.info.axes.map(axis=>[axis.tag,axis]));
 return axes.flatMap(axis=>{const range=ranges.get(axis.tag);return range?[{tag:axis.tag,value:Math.max(range.min,Math.min(range.max,axis.value))}]:[];});
}
function instanceFamily(set:NativeVariationSet,source:Source,axes:readonly FontAxisSetting[]):string{
 const key=formatFontVariations(axes),cached=source.variants.get(key);if(cached){checkVariant(set,cached);source.variants.delete(key);source.variants.set(key,cached);return cached.family;}
 const alias=`CanoliVariation_${source.info.id}_${++serial}`,faces:FontFace[]=[];
 try{
  for(const descriptor of source.info.descriptors){const face=new FontFace(alias,source.bytes,{...descriptor,variationSettings:key});if(face.status!=='loaded'||formatFontVariations(parseFontVariations(face.variationSettings))!==key)throw new Error('The browser could not prepare the requested native font variations.');set.add(face);faces.push(face);}
  const variant={family:alias,faces,states:faces.map(state),pins:0};checkVariant(set,variant);source.variants.set(key,variant);trim(set,source);return alias;
 }catch(error){for(const face of faces)set.delete(face);throw error;}
}
