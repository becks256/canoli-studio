import type {Element as XmlElement} from '@xmldom/xmldom';
import type {TextStyle} from './text-style';
import {fontVariantCapsSchema,fontStretchSchema,fontVariationSettingsSchema} from './font-features';
import {svgTextFontFamily} from './svg-css-import';

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

/** Uniform tspans retain a whole shaped line; character styling/position lists
 * need a richer public text model and are reported rather than discarded. */
export function svgTextImportContent(element:XmlElement,style:SvgTextImportStyle):string{
 const collect=(element:XmlElement):string=>{let value='';for(let node=element.firstChild;node;node=node.nextSibling){
  if(node.nodeType===3||node.nodeType===4)value+=node.nodeValue??'';
  else if(node.nodeType===1){
   const span=node as XmlElement;if(span.localName!=='tspan')throw new Error('SVG text paths and foreign text require flattened import.');
   for(let i=0;i<span.attributes.length;i++){const key=span.attributes.item(i)!.name;if(key!=='id'&&!key.startsWith('data-')&&!key.startsWith('aria-'))throw new Error('Styled or individually positioned SVG text runs require flattened import.');}
   value+=collect(span);
  }
 }return value;};const value=collect(element);
 if(style.whiteSpace==='pre'||style.whiteSpace===undefined&&style.xmlSpace==='preserve'){
  if(/[\n\r]/.test(value))throw new Error('Preserved SVG line breaks require explicitly positioned text lines.');
  if(/\t/.test(value))throw new Error('SVG preformatted tabs require flattened import.');
  return value;
 }
 return value.replace(/[\t\n\r ]+/g,' ').trim();
}
