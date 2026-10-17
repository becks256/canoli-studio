import type {DocumentData,RasterLayerData,LayerData} from '../core/model';
import {AffineTransform} from '../core/affine';
import {localTransform} from '../core/spatial';
import type {AssetStore} from '../core/assets';
import {planSvgImages,type SvgImage,type SvgImages,type SvgRasterPlan} from '../core/svg-images';
import {planSvgMasks,type SvgDocument} from '../core/svg-masks';
import type {Rect} from '../core/drawing';
import type {LayerMaskData} from '../core/masks';
import {svgEffectRegion} from '../core/svg-styles';
import {exportPng} from './png';
import {release} from './canvas';
import type {DocumentRenderer} from './renderer';
import {checkExport,type ExportControl} from './export-control';

/** Pin every image dependency across both raster and mask preparation/encoding. */
export function captureSvgSources(document:DocumentData,assets:AssetStore,control?:ExportControl,additional:Iterable<string>=[]):()=>void{
 const ids=new Set([...planSvgImages(document).flatMap(plan=>plan.layer.kind==='raster'&&!plan.prefix?[plan.layer.assetId]:[]),...additional]);
 for(const plan of planSvgMasks(document))if(plan.mask.kind==='bitmap')ids.add(plan.mask.assetId);
 const pinned=[...ids].map(id=>{const source=assets.get(id);return{source,bitmap:source.bitmap,blob:source.blob,width:source.width,height:source.height};});
 const alive=ids.size?assets.captureLifetime():()=>{};
 return()=>{
  checkExport(control);alive();
  for(const entry of pinned){const {source}=entry;
   if(!assets.has(source.id)||assets.get(source.id)!==source||source.bitmap!==entry.bitmap||source.blob!==entry.blob||source.width!==entry.width||source.height!==entry.height)
    throw new Error('An image source changed during SVG export. Retry with the current assets.');
  }
 };
}
async function dataUrl(blob:Blob):Promise<string>{
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error??new Error('Cannot read an SVG image.'));reader.onabort=()=>reject(new DOMException('Image encoding aborted','AbortError'));reader.readAsDataURL(blob);});
}

/** Global output rebasing changes only unlinked masks in the expanded root
 * scope. Masks inside retained component definitions keep their master plane.
 */
function prefixFrame(document:DocumentData,plan:SvgRasterPlan,region:Rect):DocumentData{
 const mask=(value?:LayerMaskData|null)=>value?.linked===false?{...value,x:(value.x??0)-region.x,y:(value.y??0)-region.y}:value;
 function rebase(layer:LayerData):LayerData{
  if(layer.kind==='group')return{...layer,mask:mask(layer.mask),children:layer.children.map(rebase)};
  if(layer.kind==='smart-object')return{...layer,mask:mask(layer.mask),filterMask:mask(layer.filterMask)};
  return{...layer,mask:mask(layer.mask)};
 }
 // Rebase each sibling root directly, preserving the original isolated stack
 // and logical node/depth budget without adding a synthetic wrapper group.
 const parent=AffineTransform.translation(-region.x,-region.y).multiply(plan.world);
 const children=plan.prefix!.map(layer=>{const moved=rebase(layer),world=parent.multiply(localTransform(layer));return{...moved,x:world.e,y:world.f,transform:{a:world.a,b:world.b,c:world.c,d:world.d,e:0,f:0}};});
 const frame:DocumentData&SvgDocument={...document,id:'svg-native-backdrop',width:region.width,height:region.height,children,layerComps:undefined};
 delete frame.svgNativePrefixes;delete frame.svgSupport;return frame;
}

/** Sanitized PNG pixels, never source-file metadata; no new source-resolution cap. */
export async function prepareSvgImages(document:DocumentData,assets:AssetStore,renderer:DocumentRenderer,control?:ExportControl,check:()=>void=()=>{}):Promise<SvgImages>{
 const plans=planSvgImages(document),output=new Map<string,SvgImage>(),shared=new Map<string,SvgImage>();
 const current=()=>{checkExport(control);check();};current();
 const guarded:DocumentRenderer={
  async render(...args){current();const canvas=await renderer.render(...args);try{current();return canvas;}catch(error){release(canvas);throw error;}},
  clearCache(){renderer.clearCache();},dispose(){},
 };
 for(let i=0;i<plans.length;i++){
  const plan=plans[i],layer=plan.layer,cached=layer.kind==='raster'&&!plan.rendered?shared.get(layer.assetId):undefined;
  current();if(cached){output.set(layer.id,cached);control?.onProgress?.({phase:'rendering',fraction:(i+1)/plans.length});current();continue;}
  const source=layer.kind==='raster'&&!plan.prefix?assets.get(layer.assetId):undefined;
  if(source&&(source.width!==source.bitmap.width||source.height!==source.bitmap.height))throw new Error('Raster source dimensions do not match the decoded image.');
  const region=plan.rendered?svgEffectRegion(document):{x:0,y:0,width:source!.width,height:source!.height};
  const placement={visible:true,opacity:1,fillOpacity:1,blendMode:'normal' as const,styles:undefined,mask:null,
   x:plan.rendered?plan.world.e-region.x:0,y:plan.rendered?plan.world.f-region.y:0,
   width:plan.rendered?layer.width:source!.width,height:plan.rendered?layer.height:source!.height,
   transform:plan.rendered?{a:plan.world.a,b:plan.world.b,c:plan.world.c,d:plan.world.d,e:0,f:0}:undefined,
  };
  const neutral=layer.kind==='raster'?{...layer,...placement,effects:plan.rendered?layer.effects:[],erasures:plan.rendered?layer.erasures:[]} satisfies RasterLayerData:{...layer,...placement,id:'svg-filtered-image',filterMask:layer.filterMask?.linked===false?{...layer.filterMask,x:(layer.filterMask.x??0)-region.x,y:(layer.filterMask.y??0)-region.y}:layer.filterMask};
  const frame=plan.prefix?prefixFrame(document,plan,region):{...document,width:region.width,height:region.height,children:[neutral],components:layer.kind==='smart-object'?document.components:[],layerComps:undefined};
  const blob=await exportPng(frame,assets,guarded,{signal:control?.signal,onProgress:p=>{
   current();if(p.phase==='rendering'&&p.fraction!==null)control?.onProgress?.({phase:'rendering',fraction:(i+p.fraction)/plans.length});
  }});current();
  const encoded=await dataUrl(blob);current();
  const image:SvgImage={id:`canoli-image-${i+1}`,dataUrl:encoded,width:region.width,height:region.height,x:region.x,y:region.y,space:plan.rendered?'document':'source'};
  output.set(layer.id,image);if(layer.kind==='raster'&&!plan.rendered)shared.set(layer.assetId,image);
 }
 return output;
}
