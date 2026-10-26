import {captureNativeFontVariations} from '../fonts/variations';
import {nativeTextFont} from '../core/text-style';
import type {DocumentData,LayerData,TextLayerData} from '../core/model';
import {isActiveSmartFilter} from '../core/smart/filters';
import type {LayerMaskData} from '../core/masks';
import type {AssetStore} from '../core/assets';
import {captureExportFonts,captureOwnedExportFonts} from './export-fonts';
import type {FontSourceCapture} from './export-fonts';
import {checkExport,type ExportControl} from './export-control';
import {visitMaskAssets,visitBrushAssets,visitAdjustmentAssets} from '../core/asset-references';

/** Pin visible native dependencies before callbacks, including reachable masters. */
export function captureRasterExportSources(document:DocumentData,assets:AssetStore,control?:ExportControl,operation='TIFF export'):FontSourceCapture{
 return captureRasterExportDocuments([document],assets,control,operation);
}

/** Independent Photoshop planes may render otherwise hidden top-level artwork. */
export function captureRasterExportDocuments(documents:readonly DocumentData[],assets:AssetStore,control?:ExportControl,operation='raster export'):FontSourceCapture{
 const ids=new Set<string>(),texts:TextLayerData[]=[];
 const mask=(value?:LayerMaskData|null)=>{if(value?.enabled&&value.density>0)visitMaskAssets(value,reference=>ids.add(reference.assetId));};
 for(const document of documents){
 const definitions=new Map((document.components??[]).map(d=>[d.id,d]));let visited=0;
 const enter=(depth:number)=>{if(++visited>4096||depth>64)throw new Error('Component expansion exceeds the render-tree budget.');};
 function walk(nodes:LayerData[],depth=0){for(const layer of nodes){
  enter(depth);if(!layer.visible||layer.opacity===0)continue;mask(layer.mask);
  if(layer.kind==='raster'){ids.add(layer.assetId);for(const entry of layer.erasures??[])visitBrushAssets(entry.stroke,reference=>ids.add(reference.assetId));}
  else if(layer.kind==='text'){if(layer.text)texts.push(layer);}
  else if(layer.kind==='adjustment')visitAdjustmentAssets(layer.adjustment,reference=>ids.add(reference.assetId));
  else if(layer.kind==='paint'){for(const stroke of layer.strokes)visitBrushAssets(stroke,reference=>ids.add(reference.assetId));}
  else if(layer.kind==='group')walk(layer.children,depth+1);
  else if(layer.kind==='smart-object'){
   if(layer.smartFilters?.some(isActiveSmartFilter))mask(layer.filterMask);
   const definition=definitions.get(layer.componentId);if(!definition)throw new Error(`Missing component: ${layer.componentId}`);
   if(definition.source.kind==='asset')ids.add(definition.source.assetId);else{enter(depth+1);walk(definition.source.document.children,depth+2);}
  }
 }}
 walk(document.children);
 }
 const lifetime=assets.captureLifetime(),pinned=[...ids].map(id=>{const source=assets.get(id);return{source,bitmap:source.bitmap,blob:source.blob,width:source.width,height:source.height};});
 const variations=captureNativeFontVariations(texts);let ownedFonts:FontSourceCapture|undefined;
 try{
 const fonts=captureExportFonts([...texts.map(text=>text.fontFamily),...variations.families],operation);
 ownedFonts=captureOwnedExportFonts(documents,texts.map(text=>text.fontFamily),assets);
 for(const text of texts){const requested=nativeTextFont(text);
  if(typeof globalThis.document!=='undefined'&&globalThis.document.fonts&&!globalThis.document.fonts.check(requested,text.text))throw new Error(`A referenced text font is not loaded. Retry ${operation} after fonts are ready.`);
 }
 const current=()=>{
  checkExport(control);lifetime();fonts();ownedFonts!();variations.check();
  for(const entry of pinned){const s=entry.source;if(!assets.has(s.id)||assets.get(s.id)!==s||s.bitmap!==entry.bitmap||s.blob!==entry.blob||s.width!==entry.width||s.height!==entry.height||s.bitmap.width!==entry.width||s.bitmap.height!==entry.height)throw new Error(`An image source changed during ${operation}. Retry with the current assets.`);}
 };current();return Object.assign(current,{release:()=>{ownedFonts?.release();variations.release();}});}catch(error){ownedFonts?.release();variations.release();throw error;}
}
