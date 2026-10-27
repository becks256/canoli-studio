import parse from 'css-tree/parser';
import {ident}from 'css-tree/utils';
import {svgCssUrl}from './svg-css-import';
import type {Element as XmlElement}from '@xmldom/xmldom';
import {AffineTransform}from './affine';
import {svgTransform,type SvgContour}from './svg-path-import';
import {bezierGeometryBounds}from './bezier-bounds';
import {calculateVectorBoolean}from './vector-boolean-kernel';
import type {PathAnchor,Rect}from './drawing';

export interface SvgClipGeometry{contours:PathAnchor[][];fillRule:'nonzero'|'evenodd'}
interface ClipStyle{rule:'nonzero'|'evenodd';visible:boolean;display:boolean;clip:string}
export interface SvgClipContext{
 ids:ReadonlyMap<string,XmlElement>;
 properties(element:XmlElement):Record<string,string>;
 inline(element:XmlElement):Record<string,string>;
 geometry(element:XmlElement,viewport?:{width:number;height:number}):SvgContour[];
 length(value:string,fallback?:number):number;
 viewport:{width:number;height:number};
}
const SVG='http://www.w3.org/2000/svg',shapes=new Set(['path','rect','circle','ellipse','line','polyline','polygon']);
const initial:ClipStyle={rule:'nonzero',visible:true,display:true,clip:'none'};
const empty=():SvgClipGeometry=>({contours:[],fillRule:'nonzero'});
const geometryKeys=new Set(['transform','x','y','dx','dy','width','height','rx','ry','cx','cy','r','x1','y1','x2','y2','d','points']);
const known=new Set(['id','class','style','transform','clip-rule','clip-path','display','visibility','clipPathUnits','xmlns','xmlns:xlink','role',
 'fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','opacity','color','color-interpolation','paint-order','vector-effect','pathLength',
 'x','y','width','height','rx','ry','cx','cy','r','x1','y1','x2','y2','points','d','href','xlink:href']);
export function svgClipProperty(value:string|undefined,parent='none'):string{
 const key=value?.trim().toLowerCase();return key==='inherit'?parent:key===undefined||key==='initial'||key==='unset'?'none':value!.trim();
}

/** Parse tokens rather than guessing around escaped CSS URLs or fallbacks. */
export function svgClipReference(value:string):string|null{
 const tree=parse(value,{context:'value',onParseError(error){throw error;}});
 if(tree.type!=='Value'||tree.children.size!==1)throw new Error('Unsupported SVG clipping value; choose flattened import.');
 const node=tree.children.first!;
 if(node.type==='Identifier'&&ident.decode(node.name).toLowerCase()==='none')return null;
 const url=svgCssUrl(node);
 if(!url?.startsWith('#')||url.length===1)throw new Error('SVG clipping requires a local fragment reference.');
 try{return decodeURIComponent(url.slice(1));}catch{throw new Error('Invalid SVG clipping fragment encoding.');}
}
export function transformClipGeometry(value:SvgClipGeometry,m:AffineTransform):SvgClipGeometry{
 return{fillRule:value.fillRule,contours:value.contours.map(points=>points.map(p=>({...m.point(p),in:m.point(p.in),out:m.point(p.out)})))};
}
function combine(values:SvgClipGeometry[],operation:'union'|'intersect'):SvgClipGeometry{
 if(operation==='intersect'&&values.some(value=>!value.contours.length))return empty();
 const actual=values.filter(value=>value.contours.length);if(!actual.length)return empty();if(actual.length===1)return actual[0];
 const result=calculateVectorBoolean({operation,paths:actual});return{contours:result.contours,fillRule:result.fillRule};
}
function bounds(value:SvgClipGeometry):Rect{return bezierGeometryBounds(value.contours.map(points=>({points,closed:true})));}

/** Readonly XML -> owned cubic silhouettes. Only the caller publishes OO masks.
 * A null result means no clipping; empty geometry preserves an empty region.
 * Percentages retain the definition's SVG viewport, independently of bbox units. */
export function importSvgClip(reference:string,targetBounds:()=>Rect,context:SvgClipContext):SvgClipGeometry|null{
 function fields(element:XmlElement){
  if(element.namespaceURI&&element.namespaceURI!==SVG)throw new Error('Foreign SVG clipping geometry requires flattened import.');
  let viewports=0;for(let node:XmlElement|null=element;node;node=node.parentNode?.nodeType===1?node.parentNode as XmlElement:null)if(node.localName==='svg'&&++viewports>1)throw new Error('Nested SVG clipping viewports require flattened import.');
  const p=context.properties(element);
  for(const key of Object.keys(p))if(!known.has(key)&&!key.startsWith('xmlns:')&&!key.startsWith('aria-')&&!key.startsWith('data-'))throw new Error(`Unsupported SVG clipping attribute/style: ${key}.`);
  if(Object.keys(context.inline(element)).some(key=>geometryKeys.has(key)))throw new Error('CSS clipping geometry requires flattened import.');
  return p;
 }
 function style(p:Record<string,string>,parent:ClipStyle):ClipStyle{
  const inherited=(key:string,prior:string,initial:string)=>p[key]===undefined||p[key]==='inherit'||p[key]==='unset'?prior:p[key]==='initial'?initial:p[key];
  const rule=inherited('clip-rule',parent.rule,'nonzero').trim().toLowerCase(),visible=inherited('visibility',parent.visible?'visible':'hidden','visible').trim().toLowerCase();
  if(rule!=='nonzero'&&rule!=='evenodd')throw new Error('Unsupported SVG clip rule.');
  if(!['visible','hidden','collapse'].includes(visible))throw new Error('Unsupported SVG clip visibility.');
  const clip=svgClipProperty(p['clip-path'],parent.clip);
  return{rule,visible:visible==='visible',display:p.display==='inherit'?parent.display:p.display!=='none',clip};
 }
 function ancestors(element:XmlElement):ClipStyle{
  const chain:XmlElement[]=[];for(let parent=element.parentNode;parent?.nodeType===1;parent=parent.parentNode)chain.push(parent as XmlElement);
  let value=initial;for(const parent of chain.reverse())value=style(context.properties(parent),value);return value;
 }
 function clipped(value:SvgClipGeometry,settings:ClipStyle,seen:Set<string>,viewport:{width:number;height:number}):SvgClipGeometry{
  const key=svgClipReference(settings.clip);if(key===null)return value;
  const other=server(key,()=>bounds(value),seen,viewport);return other===null?value:combine([value,other],'intersect');
 }
 function child(element:XmlElement,parent:ClipStyle,seen:Set<string>,viewport:{width:number;height:number}):SvgClipGeometry{
  const p=fields(element),settings=style(p,parent);
  if(!settings.visible||!settings.display)return empty();
  let value:SvgClipGeometry,offset=new AffineTransform();
  if(shapes.has(element.localName??''))value={contours:context.geometry(element,viewport).map(c=>c.points),fillRule:settings.rule};
  else if(element.localName==='use'){
   const href=(p.href??p['xlink:href']??'').trim();if(!href.startsWith('#'))throw new Error('SVG clip use requires a local shape reference.');
   const key=decodeURIComponent(href.slice(1)),target=context.ids.get(key);
   if(!target||!shapes.has(target.localName??'')||seen.has(key))throw new Error('SVG clip use must directly reference a non-cyclic geometric shape.');
   const next=new Set([...seen,key]),targetFields=fields(target),targetStyle=style(targetFields,settings);
   const original=targetStyle.visible&&targetStyle.display?{contours:context.geometry(target,viewport).map(c=>c.points),fillRule:targetStyle.rule}:empty();
   value=transformClipGeometry(clipped(original,targetStyle,next,viewport),svgTransform(targetFields.transform??''));
   const axis=(raw:string|undefined,size:number)=>raw?.trim().endsWith('%')?Number(raw.trim().slice(0,-1))*size/100:context.length(raw??'');
   offset=AffineTransform.translation(axis(p.x,viewport.width),axis(p.y,viewport.height));
  }else throw new Error('SVG clipping text or non-geometric children require flattened import.');
  return transformClipGeometry(clipped(value,settings,seen,viewport),svgTransform(p.transform??'').multiply(offset));
 }
 function server(key:string,target:()=>Rect,seen:Set<string>,viewport:{width:number;height:number}):SvgClipGeometry|null{
  if(seen.has(key)||seen.size>=32)throw new Error('Cyclic or excessively deep SVG clipping reference.');
  const element=context.ids.get(key);if(!element||element.localName!=='clipPath')throw new Error('Missing or unsupported SVG clipPath definition.');
  const p=fields(element),settings=style(p,ancestors(element)),unit=p.clipPathUnits??'userSpaceOnUse';
  if(unit!=='userSpaceOnUse'&&unit!=='objectBoundingBox')throw new Error('Unsupported SVG clipPathUnits.');
  const transform=svgTransform(p.transform??'');let content=new AffineTransform();
  if(unit==='objectBoundingBox'){
   const box=target();if(!box.width||!box.height)return empty();
   content=AffineTransform.translation(box.x,box.y).multiply(AffineTransform.scale(box.width,box.height));
  }
  const next=new Set([...seen,key]),parts:SvgClipGeometry[]=[];
  for(let node=element.firstChild;node;node=node.nextSibling)if(node.nodeType===1){const item=node as XmlElement;if(['title','desc','metadata'].includes(item.localName??''))continue;parts.push(child(item,settings,next,viewport));}
  const value=transformClipGeometry(combine(parts,'union'),content);return transformClipGeometry(clipped(value,settings,next,viewport),transform);
 }
 const key=svgClipReference(reference);return key===null?null:server(key,targetBounds,new Set(),context.viewport);
}
