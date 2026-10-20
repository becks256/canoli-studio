import type { LayerData } from './model';
import type { PaintOperationData } from './drawing';
import type { LayerMaskData } from './masks';

export type AssetReference={assetId:string};
export type AssetVisitor=(reference:AssetReference,role:'image'|'texture')=>void;
export function visitBrushAssets(stroke:PaintOperationData,visit:AssetVisitor){
  if(stroke.kind==='fill')return;
  if(stroke.kind==='wet'){visitBrushAssets(stroke.brush,visit);for(const tile of stroke.tiles){visit(tile,'image');visit(tile.coverage,'image');}return;}
  if(stroke.texture)visit(stroke.texture,'texture');
  if(stroke.kind==='clone')for(const tile of stroke.tiles)visit(tile,'image');
}
export function visitMaskAssets(mask:LayerMaskData|null|undefined,visit:AssetVisitor){
  if(!mask)return;
  if(mask.kind==='bitmap')visit(mask,'image');
  if(mask.kind==='raster-erasures')for(const entry of mask.erasures)visitBrushAssets(entry.stroke,visit);
  for(const entry of mask.strokes??[])visitBrushAssets(entry.stroke,visit);
}
export function visitAdjustmentAssets(adjustment:Extract<LayerData,{kind:'adjustment'}>['adjustment'],visit:AssetVisitor){
  if(adjustment.kind==='patch')visit(adjustment,'image');
  if(adjustment.kind==='tonal')for(const entry of adjustment.strokes)visitBrushAssets(entry.brush,visit);
}
/** One layer only; callers traversing a tree visit each group/child once. */
export function visitLayerAssets(layer:LayerData,visit:AssetVisitor){
  if(layer.kind==='raster')visit(layer,'image');
  visitMaskAssets(layer.mask,visit);
  if(layer.kind==='smart-object')visitMaskAssets(layer.filterMask,visit);
  if(layer.kind==='raster'){
    for(const entry of layer.erasures??[])visitBrushAssets(entry.stroke,visit);
  }
  if(layer.kind==='paint')for(const stroke of layer.strokes)visitBrushAssets(stroke,visit);
  if(layer.kind==='adjustment')visitAdjustmentAssets(layer.adjustment,visit);
}
export function remapLayerAssets(layer:LayerData,ids:ReadonlyMap<string,string>){
  visitLayerAssets(layer,reference=>{
    const replacement=ids.get(reference.assetId);
    if(replacement===undefined)throw new Error('Artwork source mapping is incomplete.');
    reference.assetId=replacement;
  });
}
/** Validated partial layer records used by commands and recipe snapshots. */
export function visitLayerPatchAssets(value:unknown,visit:AssetVisitor){
  if(!value||typeof value!=='object')return;
  const patch=value as Record<string,unknown>;
  visitMaskAssets(patch.mask as LayerMaskData|undefined,visit);
  visitMaskAssets(patch.filterMask as LayerMaskData|undefined,visit);
  if(patch.adjustment)visitAdjustmentAssets(patch.adjustment as Extract<LayerData,{kind:'adjustment'}>['adjustment'],visit);
  if(Array.isArray(patch.strokes))for(const stroke of patch.strokes)visitBrushAssets(stroke,visit);
  if(Array.isArray(patch.erasures))for(const entry of patch.erasures)visitBrushAssets(entry.stroke,visit);
}

/** Recipe templates may omit constructor-default fields; they are not full layer DTOs. */
export function visitLayerTemplateAssets(value:unknown,visit:AssetVisitor){
  if(!value||typeof value!=='object')return;
  const template=value as Record<string,unknown>;
  if(template.kind==='raster')visit(template as AssetReference,'image');
  visitLayerPatchAssets(template,visit);
}
