import {fontFamilyNames as familyNames} from '../core/font-families';
import {documentFontFiles} from '../core/font-files';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {sameFontResource} from '../fonts/resources';
import type {FontSourceLease} from '../fonts/store';
export interface FontSourceCapture {():void;release():void}

/** Shared native handles can outlive a source store. Pin owned bytes as well. */
export function captureOwnedExportFonts(documents:readonly DocumentData[],families:readonly string[],assets:AssetStore):FontSourceCapture{
  const names=new Set(families.flatMap(familyNames)),leases:FontSourceLease[]=[],seen=new Set<string>();
  try{
  for(const document of documents)for(const file of documentFontFiles(document)){
    if(seen.has(file.id)||!names.has(file.resource.report.faces[0].cssFamily.toLowerCase()))continue;seen.add(file.id);
    const source=assets.fonts.get(file.id);if(!sameFontResource(file.resource,source.descriptor))throw new Error('An export font declaration differs from its owned source.');
    leases.push(assets.fonts.retain(file.id));
  }
  const check=()=>{for(const value of leases)value.check();};check();return Object.assign(check,{release:()=>{for(const value of leases)value.release();}});
  }catch(error){for(const value of leases)value.release();throw error;}
}

/** Pin only referenced families: unrelated UI web-font loads cannot invalidate output. */
export function captureExportFonts(families:readonly string[],operation='SVG export'):()=>void{
  if(typeof globalThis.document==='undefined')return()=>{};
  const names=new Set(families.flatMap(familyNames));
  const descriptors=['family','style','weight','stretch','unicodeRange','status','ascentOverride','descentOverride','lineGapOverride','featureSettings','variationSettings','display','sizeAdjust'];
  const entries=()=>new Map([...globalThis.document.fonts??[]].filter(face=>familyNames(face.family).some(name=>names.has(name))).map(face=>[face,JSON.stringify(descriptors.map(key=>(face as unknown as Record<string,unknown>)[key]))]));
  const pinned=entries();
  return()=>{const now=entries();if(now.size!==pinned.size||[...pinned].some(([face,value])=>now.get(face)!==value))throw new Error(`A referenced font family changed during ${operation}. Retry after fonts are ready.`);};
}
