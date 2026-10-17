import type {LayerData,RasterLayerData} from './model';
import type {SvgDocument} from './svg-masks';
import {AffineTransform} from './affine';
import {localTransform} from './spatial';
import {svgNumber} from './svg-path';
import type {SmartObjectInstanceData} from './smart/types';
import {svgPaintCloneKey} from './svg-paint';

export interface SvgRasterPlan {layer:RasterLayerData|SmartObjectInstanceData;world:AffineTransform;rendered:boolean;prefix?:readonly LayerData[]}
export interface SvgImage {id:string;dataUrl:string;width:number;height:number;x:number;y:number;space:'source'|'document'}
export type SvgImages=ReadonlyMap<string,SvgImage>;
export function planSvgImages(document:SvgDocument):SvgRasterPlan[]{
 const plans:SvgRasterPlan[]=[];
 function walk(nodes:LayerData[],parent:AffineTransform){for(const layer of nodes){
  if(!layer.visible||layer.opacity===0)continue;
  const world=parent.multiply(localTransform(layer));
  if(layer.kind==='raster'){const prefix=document.svgNativePrefixes?.get(layer.id);plans.push({layer,world,prefix,rendered:!!prefix||!!layer.erasures?.length||layer.effects.some(effect=>effect.enabled&&(effect.exposure!==0||effect.contrast!==0||effect.saturation!==0))});}
  if(layer.kind==='smart-object')plans.push({layer,world,rendered:true});
  if(layer.kind==='paint')for(let s=0;s<layer.strokes.length;s++){
   const stroke=layer.strokes[s];if(stroke.kind!=='clone')continue;
   for(let t=0;t<stroke.tiles.length;t++){
    const tile=stroke.tiles[t],image:RasterLayerData={...layer,kind:'raster',id:svgPaintCloneKey(layer.id,s,t),assetId:tile.assetId,x:tile.x,y:tile.y,width:tile.width,height:tile.height,effects:[],mask:null,styles:undefined,opacity:1,fillOpacity:1,blendMode:'normal',transform:undefined};
    plans.push({layer:image,world:world.multiply(AffineTransform.translation(tile.x,tile.y)),rendered:false});
   }
  }
  if(layer.kind==='group')walk(layer.children,world);
 }}
 walk(document.children,new AffineTransform());return plans;
}
export function* svgImageDefinitions(images?:SvgImages):Generator<string>{
 if(!images?.size)return;
 yield '<defs>\n';const emitted=new Set<string>();
 for(const image of images.values()){
  if(emitted.has(image.id))continue;
  if(!/^canoli-image-\d+$/.test(image.id)||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))throw new Error('SVG image must be a prepared embedded PNG.');
  if(image.space!=='source'&&image.space!=='document')throw new Error('Invalid SVG image coordinate plane.');
  emitted.add(image.id);
  yield `<image id="${image.id}" x="0" y="0" width="${svgNumber(image.width)}" height="${svgNumber(image.height)}" preserveAspectRatio="none" href="`;
  for(let at=0;at<image.dataUrl.length;at+=65536)yield image.dataUrl.slice(at,at+65536);
  yield '" />\n';
 }
 yield '</defs>\n';
}
