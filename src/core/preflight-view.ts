import type {DocumentData,LayerData,LayerBaseData,RasterLayerData,TextLayerData,PaintLayerData,VectorLayerData} from './model';
import type {SmartObjectInstanceData} from './smart/types';
type Placement=Pick<LayerBaseData,'id'|'name'|'visible'|'opacity'|'x'|'y'|'transform'>;
/** @internal Compact worker metadata, never a render tree or a public mutation model. */
export type PreflightLayerView=Placement&(
  {kind:'group';children:PreflightLayerView[]}|
  Pick<RasterLayerData,'kind'|'assetId'|'width'|'height'>|
  Pick<TextLayerData,'kind'|'text'|'fontFamily'|'width'|'height'>|
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
/** Exclude selections, channels, LUTs, effects, masks, erasures and clone tiles.
 * References to authored path/point arrays stay shared until postMessage copies
 * the compact view; never deep-clone the entire document on the UI thread. */
export function preflightDocumentView(document:DocumentData,checkBounds=true):PreflightDocumentView {
  const layer=(node:LayerData):PreflightLayerView=>{
    const placement:Placement={id:node.id,name:node.name,visible:node.visible,opacity:node.opacity,x:node.x,y:node.y,transform:node.transform};
    switch(node.kind){
      case 'group':return{...placement,kind:node.kind,children:node.children.map(layer)};
      case 'raster':return{...placement,kind:node.kind,assetId:node.assetId,width:node.width,height:node.height};
      case 'text':return{...placement,kind:node.kind,text:node.text,fontFamily:node.fontFamily,width:node.width,height:node.height};
      case 'paint':return{...placement,kind:node.kind,strokes:checkBounds?node.strokes.map(stroke=>stroke.kind==='fill'?{...stroke,clip:null}:{...stroke,clip:null,tiles:[]}):[]};
      case 'vector':return{...placement,kind:node.kind,paths:checkBounds?node.paths:[]};
      case 'smart-object':return{...placement,kind:node.kind,componentId:node.componentId,width:node.width,height:node.height};
      case 'adjustment':return{...placement,kind:node.kind};
    }
  };
  return{id:document.id,width:document.width,height:document.height,children:document.children.map(layer),components:document.components?.map(component=>({id:component.id,source:component.source.kind==='asset'?{kind:'asset',assetId:component.source.assetId,width:component.source.width,height:component.source.height}:{kind:'document',document:preflightDocumentView(component.source.document,checkBounds)}}))};
}
