import type {Element as XmlElement} from '@xmldom/xmldom';
import {AffineTransform} from './affine';
import {svgTransform} from './svg-path-import';
import {vectorGradientSchema,type VectorGradientData} from './vector-gradient';
import type {Rect} from './drawing';

interface Color {color:string;alpha:number}
interface GradientImportContext {
 ids:Map<string,XmlElement>;
 properties(element:XmlElement):Record<string,string>;
 color(value:string):Color|null;
 length(value:string,fallback?:number):number;
 viewport:{width:number;height:number;offset:boolean};
}
/** Inert paint-server conversion. Unsupported paint is never silently substituted. */
export function importSvgGradient(reference:string,bounds:Rect,context:GradientImportContext):VectorGradientData|null{
 const match=/^url\(\s*(['"]?)#([^\s'"()]+)\1\s*\)$/.exec(reference.trim());
 if(!match)throw new Error('Unsupported SVG gradient reference/fallback requires flattened import.');
 const chain:XmlElement[]=[],seen=new Set<string>();let key=match[2];
 while(key){
  if(seen.has(key)||chain.length>=64)throw new Error('Cyclic or excessively deep SVG gradient reference.');seen.add(key);
  const element=context.ids.get(key);if(!element||(element.namespaceURI&&element.namespaceURI!=='http://www.w3.org/2000/svg')||!['linearGradient','radialGradient'].includes(element.localName??''))throw new Error('Missing or unsupported SVG gradient paint server.');
  chain.push(element);const href=element.getAttribute('href')||element.getAttribute('xlink:href')||'';
  if(href&&!href.startsWith('#'))throw new Error('External gradient references are not loaded.');key=href.slice(1);
 }
 const attributes=new Set(['gradientUnits','gradientTransform','spreadMethod','x1','x2','y1','y2','cx','cy','r','fx','fy','fr']);
 const values:Record<string,string>={},known=new Set(['id','href','xlink:href','style','class','color','stop-color','stop-opacity','color-interpolation','gradientUnits','gradientTransform','spreadMethod','x1','x2','y1','y2','cx','cy','r','fx','fy','fr']);
 for(const element of chain){if(/(?:^|;)\s*(?:gradientTransform|gradientUnits|spreadMethod|x1|x2|y1|y2|cx|cy|r|fx|fy|fr)\s*:/i.test(element.getAttribute('style')??''))throw new Error('CSS gradient geometry requires flattened import.');}
 for(const element of chain.slice().reverse())for(const [name,value] of Object.entries(context.properties(element))){
  if(!known.has(name)&&!name.startsWith('xmlns')&&!name.startsWith('data-')&&!name.startsWith('aria-'))throw new Error(`Unsupported SVG gradient attribute/style: ${name}.`);
  if(attributes.has(name))values[name]=value;
 }
 const computed=(element:XmlElement,name:string,initial:string,inherits:boolean):string=>{
  const nodes:XmlElement[]=[];for(let node:XmlElement|null=element;node;node=node.parentNode?.nodeType===1?node.parentNode as XmlElement:null)nodes.push(node);
  let value=initial;for(const node of nodes.reverse()){
   const next=context.properties(node)[name]?.trim(),keyword=next?.toLowerCase();
   if(keyword==='inherit'||name==='color'&&keyword==='currentcolor')continue;
   if(next===undefined||keyword==='unset'){if(!inherits)value=initial;}
   else value=keyword==='initial'?initial:keyword==='currentcolor'?'currentColor':next;
  }return value;
 };
 if((values.spreadMethod??'pad')!=='pad')throw new Error('Repeated/reflected SVG gradients require flattened import.');
 if(!['srgb','auto'].includes(computed(chain[0],'color-interpolation','sRGB',true).toLowerCase()))throw new Error('Only encoded-sRGB SVG gradients import as editable fills.');
 const units=values.gradientUnits??'objectBoundingBox';if(!['objectBoundingBox','userSpaceOnUse'].includes(units))throw new Error('Unsupported SVG gradient units.');
 if(units==='objectBoundingBox'&&(!bounds.width||!bounds.height))return null;
 const coordinate=(value:string,axis:'x'|'y'|'radius')=>{
  value=value.trim();
  if(value.endsWith('%')){
   const number=Number(value.slice(0,-1));if(!Number.isFinite(number))throw new Error('Invalid SVG gradient percentage.');
   if(units==='objectBoundingBox')return number/100;
   if(context.viewport.offset)throw new Error('Viewport-relative gradient lengths with an offset viewBox require flattened import.');
   return number/100*(axis==='x'?context.viewport.width:axis==='y'?context.viewport.height:Math.hypot(context.viewport.width,context.viewport.height)/Math.SQRT2);
  }
  if(units==='objectBoundingBox'&&!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))throw new Error('Absolute-unit object-bounding-box gradients require flattened import.');
  return context.length(value);
 };
 let stopElements:XmlElement[]=[];
 for(const element of chain){
  const found:XmlElement[]=[];for(let child=element.firstChild;child;child=child.nextSibling)if(child.nodeType===1){const e=child as XmlElement;if(e.localName==='stop'&&(!e.namespaceURI||e.namespaceURI==='http://www.w3.org/2000/svg'))found.push(e);else if(!['title','desc','metadata'].includes(e.localName??''))throw new Error('Unsupported SVG gradient child.');}
  if(found.length){stopElements=found;break;}
 }
 if(!stopElements.length)return null;
 if(stopElements.length>32)throw new Error('SVG gradient exceeds the native 32-stop editing budget.');
 let previous=0;
 const stops=stopElements.map(element=>{
  const p=context.properties(element);for(const name of Object.keys(p))if(!['id','class','style','offset','color','stop-color','stop-opacity'].includes(name)&&!name.startsWith('data-')&&!name.startsWith('aria-'))throw new Error(`Unsupported SVG gradient-stop attribute/style: ${name}.`);
  const raw=p.offset??'0';if(!raw.trim())throw new Error('Invalid SVG gradient stop offset.');const offset=raw.trim().endsWith('%')?Number(raw.trim().slice(0,-1))/100:Number(raw);if(!Number.isFinite(offset))throw new Error('Invalid SVG gradient stop offset.');
  previous=Math.max(previous,Math.max(0,Math.min(1,offset)));
  // Geometry follows href templates; properties are computed in the chosen
  // definition tree. stop-color/opacity do not inherit without explicit inherit.
  const colorText=computed(element,'stop-color','black',false),current=computed(element,'color','black',true),resolved=context.color(colorText==='currentColor'?current:colorText);
  const opacityText=computed(element,'stop-opacity','1',false),alpha=opacityText.trim().endsWith('%')?Number(opacityText.trim().slice(0,-1))/100:Number(opacityText);if(!resolved||!opacityText.trim()||!Number.isFinite(alpha))throw new Error('Invalid SVG gradient stop color/opacity.');
  return{position:previous,color:resolved.color,opacity:resolved.alpha*Math.max(0,Math.min(1,alpha))};
 });
 if(stops.length===1)stops.push({...stops[0],position:1});
 const base=units==='objectBoundingBox'?AffineTransform.translation(bounds.x,bounds.y).multiply(AffineTransform.scale(bounds.width,bounds.height)):new AffineTransform(),transform=base.multiply(svgTransform(values.gradientTransform??'')).toJSON();
 if(chain[0].localName==='linearGradient')return vectorGradientSchema.parse({kind:'linear',start:{x:coordinate(values.x1??'0%','x'),y:coordinate(values.y1??'0%','y')},end:{x:coordinate(values.x2??'100%','x'),y:coordinate(values.y2??'0%','y')},stops,transform});
 const x=coordinate(values.cx??'50%','x'),y=coordinate(values.cy??'50%','y');
 return vectorGradientSchema.parse({kind:'radial',start:{x:coordinate(values.fx??values.cx??'50%','x'),y:coordinate(values.fy??values.cy??'50%','y'),radius:coordinate(values.fr??'0','radius')},end:{x,y,radius:coordinate(values.r??'50%','radius')},stops,transform});
}
