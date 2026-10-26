import {fontFamilyNames as familyNames} from '../core/font-families';

/** Pin only referenced families: unrelated UI web-font loads cannot invalidate output. */
export function captureExportFonts(families:readonly string[],operation='SVG export'):()=>void{
  if(typeof globalThis.document==='undefined')return()=>{};
  const names=new Set(families.flatMap(familyNames));
  const descriptors=['family','style','weight','stretch','unicodeRange','status','ascentOverride','descentOverride','lineGapOverride','featureSettings','variationSettings','display','sizeAdjust'];
  const entries=()=>new Map([...globalThis.document.fonts??[]].filter(face=>familyNames(face.family).some(name=>names.has(name))).map(face=>[face,JSON.stringify(descriptors.map(key=>(face as unknown as Record<string,unknown>)[key]))]));
  const pinned=entries();
  return()=>{const now=entries();if(now.size!==pinned.size||[...pinned].some(([face,value])=>now.get(face)!==value))throw new Error(`A referenced font family changed during ${operation}. Retry after fonts are ready.`);};
}
