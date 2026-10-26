import type {Element as XmlElement} from '@xmldom/xmldom';
import type {TextStyle} from './text-style';
import {fontVariantCapsSchema,fontStretchSchema,fontVariationSettingsSchema} from './font-features';
import {svgTextFontFamily} from './svg-css-import';
import {characterFormatSchema,DEFAULT_CHARACTER_FORMAT,type CharacterFormat} from './character-format';
import {normalizeCharacterRanges,type CharacterRangeData} from './text-ranges';

export interface SvgTextImportStyle extends TextStyle {
  anchor:'start'|'middle'|'end';
  xmlSpace:'default'|'preserve';
  whiteSpace?:'normal'|'pre';
}
export const SVG_TEXT_ATTRIBUTES=['font-family','font-size','font-weight','font-style','font-stretch','font-variation-settings','font-variant-caps','font-kerning','letter-spacing','word-spacing','direction','text-anchor','dominant-baseline','alignment-baseline','baseline-shift','white-space','xml:space','unicode-bidi','writing-mode','text-decoration'];

export function svgTextLength(value:string,base:number):number{
 const match=/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc|em|%)?$/i.exec(value.trim());
 if(!match)throw new Error('Unsupported SVG text length.');
 const factors:Record<string,number>={px:1,in:96,cm:96/2.54,mm:96/25.4,q:96/101.6,pt:96/72,pc:16,em:base,'%':base/100};
 const result=Number(match[1])*factors[(match[2]??'px').toLowerCase()];if(!Number.isFinite(result))throw new Error('SVG text lengths must be finite.');return result;
}
export function svgTextImportStyle(p:Record<string,string>,parent?:SvgTextImportStyle):SvgTextImportStyle{
 p={...p};for(const key of ['font-weight','font-style','font-stretch','font-variant-caps','font-kerning','direction','text-anchor','white-space'])if(p[key]!==undefined)p[key]=p[key].toLowerCase();
 const previous=parent??{fontSize:16,fontFamily:'serif',anchor:'start',xmlSpace:'default'},get=(key:string,fallback:string)=>p[key]===undefined||['inherit','unset'].includes(p[key].toLowerCase())?fallback:p[key];
 const fontSize=svgTextLength(get('font-size',String(previous.fontSize)),previous.fontSize),family=get('font-family',previous.fontFamily);
 if(['revert','revert-layer'].includes(family.toLowerCase()))throw new Error('Reverted SVG font families require flattened import.');
 const fontFamily=svgTextFontFamily(family.toLowerCase()==='initial'?'serif':family);
 if(fontSize<1)throw new Error('SVG font sizes below the native text minimum require flattened import.');
 let fontWeight=get('font-weight',previous.fontWeight??'normal');
 const parentWeight=previous.fontWeight==='bold'?700:previous.fontWeight==='normal'||previous.fontWeight===undefined?400:Number(previous.fontWeight);
 if(fontWeight==='bolder')fontWeight=String(parentWeight<350?400:parentWeight<550?700:900);
 if(fontWeight==='lighter')fontWeight=String(parentWeight<550?100:parentWeight<750?400:700);
 if(!['normal','bold'].includes(fontWeight)&&(!/^\d+(?:\.\d+)?$/.test(fontWeight)||Number(fontWeight)<1||Number(fontWeight)>1000))throw new Error('Unsupported SVG font weight.');
 const fontStyle=get('font-style',previous.fontStyle??'normal');if(!['normal','italic'].includes(fontStyle))throw new Error('Oblique SVG text requires flattened import.');
 const direction=get('direction',previous.direction??'ltr'),anchor=get('text-anchor',previous.anchor),xmlSpace=get('xml:space',previous.xmlSpace),whiteSpace=p['white-space']===undefined||p['white-space']==='inherit'||p['white-space']==='unset'?previous.whiteSpace:p['white-space'];
 if(!['ltr','rtl'].includes(direction)||!['start','middle','end'].includes(anchor)||!['default','preserve'].includes(xmlSpace)||whiteSpace!==undefined&&!['normal','pre'].includes(whiteSpace))throw new Error('Unsupported SVG text direction, anchor or whitespace layout.');
 for(const[key,allowed]of Object.entries({'dominant-baseline':['auto','alphabetic'],'alignment-baseline':['auto','baseline','alphabetic'],'baseline-shift':['baseline','0','0px'],'unicode-bidi':['normal'],'writing-mode':['horizontal-tb','lr','lr-tb'],'text-decoration':['none']}))if(p[key]!==undefined&&!['inherit','unset',...allowed].includes(p[key]))throw new Error(`SVG text ${key} requires flattened import.`);
 const spacing=(key:string,fallback:number)=>{const value=get(key,String(fallback));if(value.includes('%'))throw new Error('Percentage SVG text spacing requires flattened import.');return value==='normal'?0:svgTextLength(value,fontSize);};
 const fontKerning=get('font-kerning',previous.fontKerning??'auto');if(!['auto','normal','none'].includes(fontKerning))throw new Error('Unsupported SVG font kerning.');
 return{fontSize,fontFamily,fontWeight,fontStyle:fontStyle as 'normal'|'italic',direction:direction as 'ltr'|'rtl',anchor:anchor as SvgTextImportStyle['anchor'],xmlSpace:xmlSpace as SvgTextImportStyle['xmlSpace'],...(whiteSpace!==undefined?{whiteSpace:whiteSpace as 'normal'|'pre'}:{}),letterSpacing:spacing('letter-spacing',previous.letterSpacing??0),wordSpacing:spacing('word-spacing',previous.wordSpacing??0),fontKerning:fontKerning as TextStyle['fontKerning'],fontVariantCaps:fontVariantCapsSchema.parse(get('font-variant-caps',previous.fontVariantCaps??'normal')),fontStretch:fontStretchSchema.parse(get('font-stretch',previous.fontStretch??'normal')),fontVariationSettings:fontVariationSettingsSchema.parse(get('font-variation-settings',previous.fontVariationSettings??'normal'))};
}

/** Preserve the existing uniform-text path. Styled sources use the inert
 * character projection below and acquire native geometry only in the host. */
export function svgTextImportContent(element:XmlElement,style:SvgTextImportStyle):string{
 const collect=(element:XmlElement):string=>{let value='';for(let node=element.firstChild;node;node=node.nextSibling){
  if(node.nodeType===3||node.nodeType===4)value+=node.nodeValue??'';
  else if(node.nodeType===1){
   const span=node as XmlElement;if(span.localName!=='tspan')throw new Error('SVG text paths and foreign text require flattened import.');
   for(let i=0;i<span.attributes.length;i++){const key=span.attributes.item(i)!.name;if(key!=='id'&&!key.startsWith('data-')&&!key.startsWith('aria-'))throw new Error('Styled or individually positioned SVG text runs require flattened import.');}
   value+=collect(span);
  }
 }return value;};const value=collect(element);
 if(style.whiteSpace==='pre'){
  if(/[\n\r]/.test(value))throw new Error('Preserved SVG line breaks require explicitly positioned text lines.');
  if(/\t/.test(value))throw new Error('SVG preformatted tabs require flattened import.');
  return value;
 }
 if(style.whiteSpace===undefined&&style.xmlSpace==='preserve')return value.replace(/[\t\n\r]/g,' ');
 return value.replace(/[\t\n\r ]+/g,' ').trim();
}

/** Inert source projection. Font declarations remain outside the public model
 * until the trusted host resolves and owns every selected native face. */
export function svgTextImportRuns<T extends {text:SvgTextImportStyle}>(element:XmlElement,root:T,resolve:(span:XmlElement,parent:T)=>T,format:(value:T)=>CharacterFormat):{text:string;ranges:readonly CharacterRangeData[];styled:boolean}{
 const base=characterFormatSchema.parse(format(root)),ranges:CharacterRangeData[]=[];let text='',pending:CharacterFormat|undefined,styled=false;
 const mode=(value:T)=>value.text.whiteSpace??(value.text.xmlSpace==='preserve'?'preserve-spaces':'normal');
 const append=(value:string,style:CharacterFormat)=>{
  if(text.length+value.length>10000)throw new Error('SVG text exceeds the 10,000 UTF-16-unit text budget.');
  const start=text.length;text+=value;
  const patch=Object.fromEntries(Object.keys(characterFormatSchema.shape).filter(key=>style[key as keyof CharacterFormat]!==base[key as keyof CharacterFormat]).map(key=>[key,style[key as keyof CharacterFormat]]));
  if(Object.keys(patch).length)ranges.push({start,end:text.length,format:patch});
 };
 const literal=(value:string,current:T)=>{
  const style=characterFormatSchema.parse(format(current)),space=mode(current);
  for(let point of value){
   if(space==='pre'&&/[\n\r\t]/u.test(point))throw new Error('SVG preformatted tabs or unpositioned line breaks require flattened import.');
   if(/[\u2028\u2029]/u.test(point))throw new Error('SVG forced text lines require explicit positioned line reconstruction.');
   if(space==='preserve-spaces'&&/[\n\r\t]/u.test(point))point=' ';
   const collapsible=space!=='pre'&&space!=='preserve-spaces';
   if(collapsible&&/[\t\r\n\f ]/u.test(point)){if(text&&!pending)pending=style;continue;}
   if(pending){append(' ',pending);pending=undefined;}append(point,style);
  }
 };
 const collect=(node:XmlElement,current:T)=>{for(let child=node.firstChild;child;child=child.nextSibling){
  if(child.nodeType===3||child.nodeType===4)literal(child.nodeValue??'',current);
  else if(child.nodeType===1){
   const span=child as XmlElement;if(span.localName!=='tspan')throw new Error('SVG text paths and foreign text require flattened import.');
   for(const key of ['x','y','dx','dy','rotate','textLength','lengthAdjust','transform'])if(span.hasAttribute(key))throw new Error('Individually positioned SVG text runs require flattened import.');
   for(let i=0;i<span.attributes.length;i++){const key=span.attributes.item(i)!.name;if(key!=='id'&&!key.startsWith('data-')&&!key.startsWith('aria-'))styled=true;}
   const next=resolve(span,current);if(next.text.direction!==root.text.direction||next.text.anchor!==root.text.anchor)throw new Error('Inline SVG direction or anchor changes require flattened import.');
   collect(span,next);
  }
 }};collect(element,root);
 return{text,ranges:normalizeCharacterRanges(text,ranges),styled};
}

export function svgCharacterFormat(style:SvgTextImportStyle,color:string):CharacterFormat{
 return characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...Object.fromEntries(Object.keys(characterFormatSchema.shape).filter(key=>key!=='color'&&(style as unknown as Record<string,unknown>)[key]!==undefined).map(key=>[key,(style as unknown as Record<string,unknown>)[key]])),color});
}
