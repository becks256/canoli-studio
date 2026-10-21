import type {DocumentData,LayerData,PaintLayerData,RasterLayerData} from '../core/model';
import type {SmartObjectInstanceData} from '../core/smart/types';
import type {ComponentRegistry} from '../core/smart/manager';
import type {AssetStore} from '../core/assets';
import type {Rect} from '../core/drawing';
import {localBounds} from '../core/spatial';

const identity=(value?:{a:number;b:number;c:number;d:number;e:number;f:number})=>!value||(value.a===1&&value.b===0&&value.c===0&&value.d===1&&value.e===0&&value.f===0);
const neutral=(layer:LayerData)=>layer.visible&&layer.opacity===1&&(layer.fillOpacity??1)===1&&layer.x===0&&layer.y===0&&identity(layer.transform)&&!layer.mask&&!layer.styles?.dropShadow.enabled&&!layer.styles?.colorOverlay.enabled&&!layer.styles?.blendIf.enabled;

/** Exact native RGB8 reconstruction outside retouch ink, never an approximate preview.
 * The strict shape deliberately declines altered filters, transforms, masks or styles.
 * The returned raster is private render data; authored bands/strokes remain untouched. */
export function frequencyIdentitySource(master:Pick<DocumentData,'width'|'height'|'children'>,registry:ComponentRegistry,assets:AssetStore):{raster:RasterLayerData;samplingHalo:number;unchanged(region:Rect):boolean}|null{
  if(master.children.length!==1)return null;
  const group=master.children[0];
  if(group.kind!=='group'||group.children.length!==3||group.blendMode!=='normal'||!group.visible||group.opacity!==1||(group.fillOpacity??1)!==1||group.x!==0||group.y!==0||!identity(group.transform)||group.styles?.dropShadow.enabled||group.styles?.colorOverlay.enabled||group.styles?.blendIf.enabled)return null;
  const alpha=group.mask;
  if(alpha?.kind!=='bitmap'||!alpha.enabled||alpha.inverted||alpha.density!==1||(alpha.feather??0)!==0||(alpha.x??0)!==0||(alpha.y??0)!==0||alpha.linked===false||!identity(alpha.basis)||alpha.strokes?.length)return null;
  const sources:SmartObjectInstanceData[]=[],retouches:PaintLayerData[]=[];
  for(const [index,mode] of ['normal','linear-light'].entries()){
    const stack=group.children[index];
    if(stack.kind!=='group'||stack.blendMode!==mode||!neutral(stack)||stack.frequencyRadius!=null||stack.children.length!==2)return null;
    const [source,paint]=stack.children;
    if(source.kind!=='smart-object'||paint.kind!=='paint'||paint.blendMode!=='normal'||!neutral(paint))return null;
    sources.push(source);retouches.push(paint);
  }
  const correction=group.children[2];if(correction.kind!=='smart-object')return null;sources.push(correction);
  let sigma:number|undefined;
  for(const [index,band] of ['low','high','correction'].entries()){
    const source=sources[index];
    if(!neutral(source)||source.blendMode!==(index===2?'linear-burn':'normal')||source.width!==master.width||source.height!==master.height||source.componentId!==sources[0].componentId||source.filterMask||source.smartFilters?.length!==1)return null;
    const filter=source.smartFilters[0];if(filter.kind!=='frequency-band'||filter.band!==band||!filter.enabled)return null;
    const radius=group.frequencyRadius??filter.sigma;if(sigma!==undefined&&sigma!==radius)return null;sigma=radius;
  }
  // Keep genuine sampling-budget errors visible even when unchanged RGB could be elided.
  if(sigma===undefined||!Number.isFinite(sigma)||sigma<0||sigma>4096/3)return null;
  const halo=2*Math.ceil(3*sigma),w=Math.min(256,master.width)+4+halo,h=Math.min(256,master.height)+4+halo;
  if(w*h>4_000_000||Math.max(w,h)>8192)return null;
  const source=registry.get(sources[0].componentId).source;
  let raster:RasterLayerData;
  if(source.kind==='asset'){
    if(source.width!==master.width||source.height!==master.height||source.assetId!==alpha.assetId)return null;
    raster={id:'frequency-identity-source',kind:'raster',name:'Captured frequency source',assetId:source.assetId,width:master.width,height:master.height,x:0,y:0,visible:true,locked:false,opacity:1,blendMode:'normal',effects:[]};
  }else{
    if(source.document.width!==master.width||source.document.height!==master.height||source.document.children.length!==1)return null;
    const image=source.document.children[0];
    if(image.kind!=='raster'||image.blendMode!=='normal'||!neutral(image)||image.width!==master.width||image.height!==master.height||image.assetId!==alpha.assetId||image.effects.length||image.erasures?.length)return null;
    raster=image;
  }
  const asset=assets.get(raster.assetId);
  if(asset.width!==master.width||asset.height!==master.height||asset.bitmap.width!==master.width||asset.bitmap.height!==master.height)return null;
  const ink=retouches.filter(paint=>paint.strokes.length).map(paint=>localBounds(paint));
  if(ink.some(bounds=>!bounds))return null;
  return{raster,samplingHalo:halo/2,unchanged(region){return ink.every(bounds=>bounds!.x+bounds!.width+2<region.x||bounds!.y+bounds!.height+2<region.y||bounds!.x-2>region.x+region.width||bounds!.y-2>region.y+region.height);}};
}


/** A literal native pixel plane, without resampling, appearance or authored
 * replacements. Larger band sampling must not change arbitrary master canvas
 * bounds: native bitmap edge coverage can depend on those bounds. */
export function nativeFrequencyRasterSource(master:Pick<DocumentData,'width'|'height'|'children'>,assets:Pick<AssetStore,'get'>):RasterLayerData|null {
  if(master.children.length!==1)return null;
  const raster=master.children[0];
  if(raster.kind!=='raster'||raster.blendMode!=='normal'||!neutral(raster)||raster.width!==master.width||raster.height!==master.height||raster.effects.length||raster.erasures?.length)return null;
  const asset=assets.get(raster.assetId);
  return asset.width===master.width&&asset.height===master.height&&asset.bitmap.width===master.width&&asset.bitmap.height===master.height?raster:null;
}
