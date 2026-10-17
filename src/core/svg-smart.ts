import {allLayers,type DocumentData,type LayerData,type TextLayerData} from './model';
import {ComponentRegistry} from './smart/manager';
import {resolveSmartDocument} from './smart/resolve';
import type {LayerMaskData} from './masks';

export interface SvgSmartPlan {
  document:DocumentData;
  expanded:number;
  filtered:number;
  filteredAssets:ReadonlySet<string>;
  filteredTexts:readonly TextLayerData[];
}
/** Ephemeral export view; component/master identity remains in the project. */
export function planSvgSmart(document:DocumentData):SvgSmartPlan{
  const filteredAssets=new Set<string>(),filteredTexts:TextLayerData[]=[];
  if(!document.components?.length){
    if(allLayers(document.children).some(layer=>layer.kind==='smart-object'))throw new Error('Missing SVG component registry.');
    return{document,expanded:0,filtered:0,filteredAssets,filteredTexts};
  }
  const registry=new ComponentRegistry(document.components);
  const view=resolveSmartDocument(document,registry,{preserveFiltered:true,retainImmutable:true,vectorCanvasClips:true});
  const definitions=new Map(document.components.map(value=>[value.id,value]));
  let expanded=0,filtered=0;
  function mask(value?:LayerMaskData|null){if(value?.enabled&&value.density>0&&value.kind==='bitmap')filteredAssets.add(value.assetId);}
  function walk(nodes:LayerData[],baked=false){for(const layer of nodes){
    if(!layer.visible||layer.opacity===0)continue;
    if(baked){
      mask(layer.mask);
      if(layer.kind==='raster')filteredAssets.add(layer.assetId);
      else if(layer.kind==='text')filteredTexts.push(layer);
      else if(layer.kind==='paint'){for(const stroke of layer.strokes)if(stroke.kind==='clone')for(const tile of stroke.tiles)filteredAssets.add(tile.assetId);}
      else if(layer.kind==='adjustment'&&layer.adjustment.kind==='patch')filteredAssets.add(layer.adjustment.assetId);
    }
    if(layer.kind==='group')walk(layer.children,baked);
    else if(layer.kind==='smart-object'){
      const render=!!layer.smartFilters?.some(filter=>filter.enabled);
      if(!baked){if(render)filtered++;else expanded++;}
      if(render)mask(layer.filterMask);
      const source=definitions.get(layer.componentId)?.source;
      if(!source)throw new Error(`Missing SVG component: ${layer.componentId}`);
      if(source.kind==='asset'){if(baked||render)filteredAssets.add(source.assetId);}
      else walk(source.document.children,baked||render);
    }
  }}
  // resolveSmartDocument already enforces the logical 4096-node/64-depth budget,
  // including descendants of retained filtered instances, before this traversal.
  walk(document.children);
  return{document:{...view,components:document.components},expanded,filtered,filteredAssets,filteredTexts};
}
