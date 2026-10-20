import type {LayerData,PaintLayerData} from './model';
import type {BrushStrokeData,PaintOperationData,Rect} from './drawing';
import type {SvgDocument} from './svg-masks';
import type {SvgImages} from './svg-images';
import {AffineTransform} from './affine';
import {localTransform} from './spatial';
import {strokeStamps,paintStampSize,paintStampAlpha,paintStampGeometry} from './paint-stamps';
import {svgNumber as n} from './svg-path';
import {svgEffectRegion} from './svg-styles';

// Virtual lookup keys cannot collide with successful XML layer identifiers:
// actual layer IDs containing NUL are rejected by SVG attribute serialization.
export const svgPaintClipKey=(layerId:string,index:number)=>'\0paint-clip:'+JSON.stringify([layerId,index]);
export const svgPaintCloneKey=(layerId:string,index:number,tile:number)=>'\0paint-clone:'+JSON.stringify([layerId,index,tile]);
export const svgPaintTextureKey=(layerId:string,index:number)=>'\0paint-texture:'+JSON.stringify([layerId,index]);
export interface SvgPaintPlan {layer:PaintLayerData;world:AffineTransform;id:string;visible:Rect;support:Rect}
export function planSvgPaint(document:SvgDocument):SvgPaintPlan[]{
 const result:SvgPaintPlan[]=[],support=svgEffectRegion(document);
 function walk(nodes:LayerData[],parent:AffineTransform){for(const layer of nodes){
  if(!layer.visible||layer.opacity===0)continue;const world=parent.multiply(localTransform(layer));
  if(layer.kind==='paint'&&layer.strokes.length)result.push({layer,world,id:`canoli-paint-${result.length+1}`,visible:world.inverse().bounds(support),support});
  if(layer.kind==='group')walk(layer.children,world);
 }}walk(document.children,new AffineTransform());return result;
}
const erase=(stroke:PaintOperationData)=>stroke.kind==='eraser'||(stroke.kind==='fill'&&stroke.erase);
const id=(plan:SvgPaintPlan,i:number,suffix:string)=>`${plan.id}-${i+1}-${suffix}`;
function bounds(rect:Rect){return`x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.width)}" height="${n(rect.height)}"`;}
function* dabs(plan:SvgPaintPlan,stroke:BrushStrokeData,i:number,coverage=false,images?:SvgImages):Generator<string>{
 const color=coverage?'#ffffff':stroke.color;
 const fill=stroke.kind==='pencil'||stroke.hardness>=0.999?color:`url(#${id(plan,i,'gradient')})`;
 const texture=stroke.texture?` mask="url(#${id(plan,i,'texture')})"`:'';
 if(stroke.texture&&!images?.has(svgPaintTextureKey(plan.layer.id,i)))throw new Error('Textured paint requires host image preparation for SVG export.');
 for(const point of strokeStamps(stroke,plan.visible)){
  const size=paintStampSize(stroke,point),alpha=paintStampAlpha(stroke,point);
  if(size<=0||alpha<=0)continue;
  if(stroke.tip||point.copy||stroke.texture){
   const geometry=paintStampGeometry(stroke,point,!!stroke.texture),matrix=`matrix(${n(geometry.a)} ${n(geometry.b)} ${n(geometry.c)} ${n(geometry.d)} ${n(geometry.cx)} ${n(geometry.cy)})`;
   if(stroke.kind==='pencil')yield `<rect x="${n(-geometry.rx)}" y="${n(-geometry.ry)}" width="${n(geometry.rx*2)}" height="${n(geometry.ry*2)}" transform="${matrix}" fill="${fill}" opacity="${n(alpha)}"${texture} />\n`;
   else yield `<ellipse cx="0" cy="0" rx="${n(geometry.rx)}" ry="${n(geometry.ry)}" transform="${matrix}" fill="${fill}" opacity="${n(alpha)}"${texture} />\n`;
  }
  else if(stroke.kind==='pencil'){const width=Math.max(1,Math.round(size));yield `<rect x="${n(Math.floor(point.x-width/2))}" y="${n(Math.floor(point.y-width/2))}" width="${n(width)}" height="${n(width)}" fill="${fill}" opacity="${n(alpha)}" />\n`;}
  else yield `<circle cx="${n(point.x)}" cy="${n(point.y)}" r="${n(size/2)}" fill="${fill}" opacity="${n(alpha)}" />\n`;
 }
}
function* strokeContent(plan:SvgPaintPlan,stroke:PaintOperationData,i:number,clips:ReadonlyMap<string,string>,images?:SvgImages,coverage=false):Generator<string>{
 if(stroke.kind==='wet'&&stroke.opacity===0)return;
 if(stroke.kind==='wet')throw new Error('Wet paint requires host native-prefix preparation for SVG export.');
 const clip=clips.get(svgPaintClipKey(plan.layer.id,i));
 yield `<g opacity="${n(stroke.opacity)}" style="isolation:isolate"${clip?` mask="url(#${clip})"`:''}>\n`;
 if(stroke.kind==='fill')yield `<rect ${bounds(stroke.bounds)} fill="${coverage?'#ffffff':stroke.color}" />\n`;
 else if(stroke.kind==='clone'&&!coverage){
  yield `<g mask="url(#${id(plan,i,'clone')})">\n`;
  for(let t=0;t<stroke.tiles.length;t++){
   const tile=stroke.tiles[t],image=images?.get(svgPaintCloneKey(plan.layer.id,i,t));
   if(!image)throw new Error('Clone paint requires host image preparation for SVG export.');
   yield `<use href="#${image.id}" transform="translate(${n(tile.x)} ${n(tile.y)}) scale(${n(tile.width/image.width)} ${n(tile.height/image.height)})" />\n`;
  }
  yield '</g>\n';
 }else yield* dabs(plan,stroke,i,coverage,images);
 yield '</g>\n';
}
export function* svgPaintDefinitions(plans:readonly SvgPaintPlan[],clips:ReadonlyMap<string,string>,images?:SvgImages):Generator<string>{
 if(!plans.length)return;yield '<defs>\n';
 for(const plan of plans)for(let i=0;i<plan.layer.strokes.length;i++){
  const stroke=plan.layer.strokes[i];if(stroke.kind==='wet'&&stroke.opacity===0)continue;if(stroke.kind==='wet')throw new Error('Wet paint requires host native-prefix preparation for SVG export.');if(!/^#[0-9a-fA-F]{6}$/.test(stroke.color))throw new Error('SVG paint requires a six-digit hex color.');
  if(stroke.kind!=='fill'&&stroke.texture){
   const image=images?.get(svgPaintTextureKey(plan.layer.id,i));
   if(!image)throw new Error('Textured paint requires host image preparation for SVG export.');
   yield `<mask id="${id(plan,i,'texture')}" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1" style="mask-type:alpha"><use href="#${image.id}" transform="scale(${n(1/image.width)} ${n(1/image.height)})"${stroke.kind==='pencil'?' style="image-rendering:pixelated"':''} /></mask>\n`;
  }
  if(stroke.kind!=='fill'&&stroke.kind!=='pencil'&&stroke.hardness<0.999){
   const color=stroke.kind==='eraser'||stroke.kind==='clone'?'#ffffff':stroke.color;
   yield `<radialGradient id="${id(plan,i,'gradient')}" cx="0.5" cy="0.5" r="0.5" gradientUnits="objectBoundingBox" color-interpolation="sRGB"><stop offset="${n(stroke.hardness)}" stop-color="${color}" /><stop offset="1" stop-color="${color}" stop-opacity="0" /></radialGradient>\n`;
  }
  const b=bounds(plan.visible);
  if(erase(stroke)){
   yield `<filter id="${id(plan,i,'invert')}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" ${b}><feComponentTransfer ${b}><feFuncA type="linear" slope="-1" intercept="1" /></feComponentTransfer></filter>\n`;
   yield `<mask id="${id(plan,i,'erase')}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${b} style="mask-type:alpha"><g filter="url(#${id(plan,i,'invert')})"><rect ${b} fill="#ffffff" opacity="0" />\n`;
   yield* strokeContent(plan,stroke,i,clips,images,true);yield '</g></mask>\n';
  }else if(stroke.kind==='clone'){
   yield `<mask id="${id(plan,i,'clone')}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${b} style="mask-type:alpha">\n`;
   yield* dabs(plan,stroke,i,true,images);yield '</mask>\n';
  }
 }
 yield '</defs>\n';
}
export function* svgPaintElements(plan:SvgPaintPlan,clips:ReadonlyMap<string,string>,images?:SvgImages):Generator<string>{
 // Each eraser masks exactly the accumulated prefix, never later paint.
 for(let i=plan.layer.strokes.length-1;i>=0;i--)if(erase(plan.layer.strokes[i]))yield `<g mask="url(#${id(plan,i,'erase')})">\n`;
 for(let i=0;i<plan.layer.strokes.length;i++){
  const stroke=plan.layer.strokes[i];
  if(erase(stroke))yield '</g>\n';else yield* strokeContent(plan,stroke,i,clips,images);
 }
}
