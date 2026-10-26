import type {PaintOperationData} from './drawing';
import {isActiveWetPaint} from './wet-operation';
import type {DocumentData,LayerData,LayerBaseData,RasterLayerData,TextLayerData,PaintLayerData,VectorLayerData} from './model';
import type {SmartObjectInstanceData} from './smart/types';
import {characterFontFamilies} from './character-layout';
type Placement=Pick<LayerBaseData,'id'|'name'|'visible'|'opacity'|'x'|'y'|'transform'>;
/** @internal Compact worker metadata, never a render tree or a public mutation model. */
export type PreflightLayerView=Placement&(
  {kind:'group';children:PreflightLayerView[]}|
  Pick<RasterLayerData,'kind'|'assetId'|'width'|'height'|'erasures'>|
  (Pick<TextLayerData,'kind'|'text'|'fontFamily'|'characterRanges'|'textPathOrigin'|'textFrameOrigin'|'width'|'height'>&{fontFamilies?:readonly string[]})|
  Pick<PaintLayerData,'kind'|'strokes'>|
  Pick<VectorLayerData,'kind'|'paths'>|
  Pick<SmartObjectInstanceData,'kind'|'componentId'|'width'|'height'>|
  {kind:'adjustment'}
);
export interface PreflightComponentView {
  id:string;
  source:{kind:'asset';assetId:string;width:number;height:number}|{kind:'document';document:PreflightDocumentView};
}
export interface PreflightDocumentView {
  id:string;width:number;height:number;children:PreflightLayerView[];components?:PreflightComponentView[];
}
const geometryStroke=(stroke:PaintOperationData):PaintOperationData=>stroke.kind==='wet'?{...stroke,clip:null,brush:{...stroke.brush,clip:null,tiles:[]}}:stroke.kind==='fill'?{...stroke,clip:null}:{...stroke,clip:null,tiles:[]};
/** Exclude selections, channels, LUTs, effects, masks and clone pixels.
 * Keep active wet-replacement extent metadata (not source pixels) for shared bounds.
 * References to authored path/point arrays stay shared until postMessage copies
 * the compact view; never deep-clone the entire document on the UI thread. */
export function preflightDocumentView(document:DocumentData,checkBounds=true,alignmentIds:ReadonlySet<string>=new Set()):PreflightDocumentView {
  const layer=(node:LayerData,parentGeometry=false):PreflightLayerView=>{
    const geometry=checkBounds||parentGeometry||alignmentIds.has(node.id);
    const placement:Placement={id:node.id,name:node.name,visible:node.visible,opacity:node.opacity,x:node.x,y:node.y,transform:node.transform};
    switch(node.kind){
      case 'group':return{...placement,kind:node.kind,children:node.children.map(child=>layer(child,geometry))};
      case 'raster':return{...placement,kind:node.kind,assetId:node.assetId,width:node.width,height:node.height,...(geometry&&node.erasures?.some(entry=>isActiveWetPaint(entry.stroke))?{erasures:node.erasures.filter(entry=>isActiveWetPaint(entry.stroke)).map(entry=>({width:entry.width,height:entry.height,stroke:geometryStroke(entry.stroke)}))}:{})};
      case 'text':return{...placement,kind:node.kind,text:node.text,fontFamily:node.fontFamily,...(node.textPathOrigin?{textPathOrigin:{...node.textPathOrigin}}:{}),...(node.textFrameOrigin?{textFrameOrigin:{...node.textFrameOrigin}}:{}),width:node.width,height:node.height,...(node.characterRanges===undefined?{}:{fontFamilies:characterFontFamilies(node)})};
      case 'paint':return{...placement,kind:node.kind,strokes:geometry?node.strokes.map(geometryStroke):[]};
      case 'vector':return{...placement,kind:node.kind,paths:geometry?node.paths:[]};
      case 'smart-object':return{...placement,kind:node.kind,componentId:node.componentId,width:node.width,height:node.height};
      case 'adjustment':return{...placement,kind:node.kind};
    }
  };
  return{id:document.id,width:document.width,height:document.height,children:document.children.map(child=>layer(child)),components:document.components?.map(component=>({id:component.id,source:component.source.kind==='asset'?{kind:'asset',assetId:component.source.assetId,width:component.source.width,height:component.source.height}:{kind:'document',document:preflightDocumentView(component.source.document,checkBounds)}}))};
}
