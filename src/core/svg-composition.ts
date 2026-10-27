import { isActiveWetPaint } from './wet-operation';
import type {DocumentData,LayerData,RasterLayerData,TextLayerData} from './model';
import {visitLayerAssets} from './asset-references';
import type {SvgDocument} from './svg-masks';
import {svgEffectRegion} from './svg-styles';

export interface SvgCompositionPlan {
 document:DocumentData&SvgDocument;
 prefixes:number;
 adjustments:number;
 wetPaint:number;
 blendIf:number;
 stacks:readonly string[];
 nativeAssets:ReadonlySet<string>;
 nativeTexts:readonly TextLayerData[];
}

/** Each isolated sibling stack has its own backdrop. Keep later artwork live;
 * native prefixes retain all original kernels/masks/blends without inventing a
 * vector equivalent or changing the source document/commands. Smart expansion
 * and its logical graph validation must run before this private planning step.
 */
export function planSvgComposition(document:DocumentData):SvgCompositionPlan{
 const prefixes=new Map<string,readonly LayerData[]>(),nativeAssets=new Set<string>(),nativeTexts:TextLayerData[]=[],stacks:string[]=[];
 let adjustments=0,blendIf=0,wetPaint=0;
 function inspect(nodes:readonly LayerData[],native:boolean){for(const layer of nodes){
  if(!layer.visible||layer.opacity===0)continue;
  if(native){
   visitLayerAssets(layer,reference=>nativeAssets.add(reference.assetId));
   if(layer.kind==='text')nativeTexts.push(layer);
  }else{
   if(layer.kind==='adjustment')adjustments++;
   if(layer.kind==='paint'&&layer.strokes.some(isActiveWetPaint))wetPaint++;
   if(layer.styles?.blendIf.enabled)blendIf++;
  }
  if(layer.kind==='group')inspect(layer.children,native);
 }}
 function walk(nodes:LayerData[],path:string[]=[]):LayerData[]{
  let through=-1;
  nodes.forEach((layer,i)=>{if(layer.visible&&layer.opacity>0&&(layer.clipped||layer.mask?.kind==='raster-erasures'||layer.kind==='adjustment'||(layer.blendMode==='linear-light'||layer.blendMode==='linear-burn')||layer.styles?.blendIf.enabled||(layer.kind==='group'&&layer.blendMode==='pass-through')||(layer.kind==='paint'&&layer.strokes.some(isActiveWetPaint))))through=i;});
  const output:LayerData[]=[];
  if(through>=0){
   const prefix=nodes.slice(0,through+1),last=nodes[through];
   prefixes.set(last.id,prefix);inspect(prefix,true);
   stacks.push([...path,last.name].join(' / '));
   const image:RasterLayerData={id:last.id,name:'Native backdrop',kind:'raster',visible:true,locked:false,opacity:1,fillOpacity:1,blendMode:'normal',x:0,y:0,width:document.width,height:document.height,assetId:'svg-native-prefix',effects:[],mask:null};
   output.push(image);
  }
  for(const layer of nodes.slice(through+1))output.push(layer.kind==='group'&&layer.visible&&layer.opacity>0?{...layer,children:walk(layer.children,[...path,layer.name])}:layer);
  return output;
 }
 inspect(document.children,false);
 const children=walk(document.children);
 return{document:prefixes.size?{...document,children,svgNativePrefixes:prefixes,svgSupport:svgEffectRegion(document)}:document,prefixes:prefixes.size,adjustments,wetPaint,blendIf,stacks,nativeAssets,nativeTexts};
}
