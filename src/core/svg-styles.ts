import type {LayerData} from './model';
import type {LayerStyleData} from './drawing';
import type {SvgDocument} from './svg-masks';
import {AffineTransform} from './affine';
import {localTransform} from './spatial';
import {svgNumber} from './svg-path';

export interface SvgStylePlan {id:string;layerId:string;world:AffineTransform;style:LayerStyleData;fillOpacity:number}
export function svgArtwork(layer:LayerData):boolean{
  return layer.visible&&layer.opacity>0&&(layer.kind==='raster'||layer.kind==='smart-object'||layer.kind==='adjustment'||(layer.kind==='paint'?layer.strokes.length>0:layer.kind==='text'?!!layer.text:layer.kind==='vector'?layer.paths.length>0:layer.kind==='group'&&layer.children.some(svgArtwork)));
}
function shadowActive(style?:LayerStyleData){return !!style?.dropShadow.enabled&&style.dropShadow.opacity>0;}
export function planSvgStyles(document:SvgDocument):SvgStylePlan[]{
  const plans:SvgStylePlan[]=[];
  function walk(nodes:LayerData[],parent:AffineTransform){
    for(const layer of nodes){
      if(!svgArtwork(layer))continue;
      const world=parent.multiply(localTransform(layer)),style=layer.styles;
      if(style&&(shadowActive(style)||(style.colorOverlay.enabled&&style.colorOverlay.opacity>0)))
        plans.push({id:`canoli-style-${plans.length+1}`,layerId:layer.id,world,style,fillOpacity:layer.fillOpacity??1});
      if(layer.kind==='group')walk(layer.children,world);
    }
  }
  walk(document.children,new AffineTransform());return plans;
}

/** Conservative root-plane support for all ancestor/descendant shadow chains. */
export function svgEffectRegion(document:SvgDocument){
  if(document.svgSupport)return document.svgSupport;
  let x=0,y=0;
  function walk(nodes:LayerData[],px:number,py:number){
    for(const layer of nodes){
      if(!svgArtwork(layer))continue;
      const shadow=layer.styles?.dropShadow;
      const hx=px+(shadowActive(layer.styles)?Math.ceil(shadow!.blur*3+Math.abs(shadow!.x))+2:0);
      const hy=py+(shadowActive(layer.styles)?Math.ceil(shadow!.blur*3+Math.abs(shadow!.y))+2:0);
      x=Math.max(x,hx);y=Math.max(y,hy);
      if(layer.kind==='group')walk(layer.children,hx,hy);
    }
  }
  walk(document.children,0,0);return{x:-x,y:-y,width:document.width+2*x,height:document.height+2*y};
}

export function svgMatrix(matrix:AffineTransform){return[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].map(svgNumber).join(' ');}

/** Filters operate in the root document plane, not an affine-scaled layer plane. */
export function* svgStyleDefinitions(document:SvgDocument,plans:SvgStylePlan[]):Generator<string>{
  if(!plans.length)return;
  const r=svgEffectRegion(document),bounds=`x="${svgNumber(r.x)}" y="${svgNumber(r.y)}" width="${svgNumber(r.width)}" height="${svgNumber(r.height)}"`;
  yield '<defs>\n';
  for(const plan of plans){
    const {style}=plan,shadow=style.dropShadow,overlay=style.colorOverlay;
    for(const color of [shadow.color,overlay.color])if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('SVG effect paint must be a six-digit hex color.');
    yield `<filter id="${plan.id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${bounds} color-interpolation-filters="sRGB">\n`;
    if(shadowActive(style)){
      yield `<feFlood ${bounds} flood-color="${shadow.color}" flood-opacity="1" result="shadow-color" />\n`;
      yield `<feComposite ${bounds} in="shadow-color" in2="SourceAlpha" operator="in" result="shadow-source" />\n`;
      let source='shadow-source';
      if(shadow.blur>0){yield `<feGaussianBlur ${bounds} in="shadow-source" stdDeviation="${svgNumber(shadow.blur)}" result="soft-shadow" />\n`;source='soft-shadow';}
      yield `<feOffset ${bounds} in="${source}" dx="${svgNumber(shadow.x)}" dy="${svgNumber(shadow.y)}" result="offset-shadow" />\n`;
      yield `<feComponentTransfer ${bounds} in="offset-shadow" result="shadow"><feFuncA type="linear" slope="${svgNumber(shadow.opacity)}" /></feComponentTransfer>\n`;

    }
    const amount=overlay.enabled?overlay.opacity:0,k=1-amount;
    const rgb=[1,3,5].map(at=>parseInt(overlay.color.slice(at,at+2),16)/255*amount);
    const matrix=[k,0,0,0,rgb[0],0,k,0,0,rgb[1],0,0,k,0,rgb[2],0,0,0,plan.fillOpacity,0].map(svgNumber).join(' ');
    yield `<feColorMatrix ${bounds} in="SourceGraphic" type="matrix" values="${matrix}" result="content" />\n`;
    yield `<feMerge ${bounds}>`;
    if(shadowActive(style))yield '<feMergeNode in="shadow" />';
    yield '<feMergeNode in="content" /></feMerge>\n</filter>\n';
  }
  yield '</defs>\n';
}
