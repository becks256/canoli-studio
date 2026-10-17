import type {DocumentData,LayerData,TextLayerData} from '../core/model';
import type {LayerMaskData} from '../core/masks';
import type {AssetStore} from '../core/assets';
import {captureExportFonts} from './export-fonts';
import {checkExport,type ExportControl} from './export-control';

/** Pin visible native dependencies before callbacks, including reachable masters. */
export function captureRasterExportSources(document:DocumentData,assets:AssetStore,control?:ExportControl):()=>void{
 const ids=new Set<string>(),texts:TextLayerData[]=[],definitions=new Map((document.components??[]).map(d=>[d.id,d]));let visited=0;
 const mask=(value?:LayerMaskData|null)=>{if(value?.enabled&&value.density>0&&value.kind==='bitmap')ids.add(value.assetId);};
 const enter=(depth:number)=>{if(++visited>4096||depth>64)throw new Error('Component expansion exceeds the render-tree budget.');};
 function walk(nodes:LayerData[],depth=0){for(const layer of nodes){
  enter(depth);if(!layer.visible||layer.opacity===0)continue;mask(layer.mask);
  if(layer.kind==='raster')ids.add(layer.assetId);
  else if(layer.kind==='text'){if(layer.text)texts.push(layer);}
  else if(layer.kind==='adjustment'&&layer.adjustment.kind==='patch')ids.add(layer.adjustment.assetId);
  else if(layer.kind==='paint'){for(const stroke of layer.strokes)if(stroke.kind==='clone')for(const tile of stroke.tiles)ids.add(tile.assetId);}
  else if(layer.kind==='group')walk(layer.children,depth+1);
  else if(layer.kind==='smart-object'){
   if(layer.smartFilters?.some(filter=>filter.enabled))mask(layer.filterMask);
   const definition=definitions.get(layer.componentId);if(!definition)throw new Error(`Missing component: ${layer.componentId}`);
   if(definition.source.kind==='asset')ids.add(definition.source.assetId);else{enter(depth+1);walk(definition.source.document.children,depth+2);}
  }
 }}
 walk(document.children);
 const lifetime=assets.captureLifetime(),pinned=[...ids].map(id=>{const source=assets.get(id);return{source,bitmap:source.bitmap,blob:source.blob,width:source.width,height:source.height};});
 const fonts=captureExportFonts(texts.map(text=>text.fontFamily),'TIFF export');
 for(const text of texts){const requested=`${text.fontStyle??'normal'} ${text.fontWeight??'normal'} ${text.fontSize}px ${text.fontFamily}`;
  if(typeof globalThis.document!=='undefined'&&globalThis.document.fonts&&!globalThis.document.fonts.check(requested,text.text))throw new Error('A referenced text font is not loaded. Retry TIFF export after fonts are ready.');
 }
 const current=()=>{
  checkExport(control);lifetime();fonts();
  for(const entry of pinned){const s=entry.source;if(!assets.has(s.id)||assets.get(s.id)!==s||s.bitmap!==entry.bitmap||s.blob!==entry.blob||s.width!==entry.width||s.height!==entry.height||s.bitmap.width!==entry.width||s.bitmap.height!==entry.height)throw new Error('An image source changed during TIFF export. Retry with the current assets.');}
 };current();return current;
}
