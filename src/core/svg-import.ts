import {textPathSchema,type TextPathData} from './text-path';
import {importSvgGradient} from './svg-gradient-import';
import {bezierGeometryBounds} from './bezier-bounds';
import {DOMParser,XMLSerializer,type Element as XmlElement,type Node as XmlNode} from '@xmldom/xmldom';
import {Document,LayerGroup,VectorLayer,VectorPath,VectorContour,RasterLayer,TextLayer,Layer,AffineTransform} from '../dom';
import {svgStyleDeclarations,svgFontStylesheet,svgCheckCssValue,type SvgFontSource} from './svg-css-import';
import {svgTextImportStyle,svgTextImportContent,svgTextImportRuns,svgCharacterFormat,svgTextLength,SVG_TEXT_ATTRIBUTES,type SvgTextImportStyle} from './svg-text-import';
import type {CharacterRangeData} from './text-ranges';
import type {DocumentData} from './model';
import {parseSvgContours,svgNumbers,svgTransform,svgViewBox,type SvgContour} from './svg-path-import';
export {svgTransform,svgViewBox} from './svg-path-import';

const SVG='http://www.w3.org/2000/svg';
export interface SvgImportReport {
 version:1;width:number;height:number;canImportEditable:boolean;
 featuresPreserved:string[];featuresDegraded:string[];unsupportedFeatures:string[];additionalIssues:number;
 elements:number;layers:number;images:number;fonts:number;texts:number;
}
export interface SvgImagePlacement {layerId:string;assetId:string;viewportWidth:number|null;viewportHeight:number|null;aspect:string}
export interface SvgTextPlacement {layerId:string;x:number;y:number;characterRanges?:readonly CharacterRangeData[];path?:TextPathData}
/** Worker transport only; public document mutation still uses OO constructors. */
export interface SvgInspection {report:SvgImportReport;document?:DocumentData;assets:{id:string;name:string;blob:Blob}[];images:SvgImagePlacement[];fonts:SvgFontSource[];texts:SvgTextPlacement[];flat:Blob}
export interface SvgImportControl {signal?:AbortSignal;onProgress?:(progress:{phase:'reading'|'inspecting'|'decoding'|'rendering';fraction:number|null})=>void}
export interface SvgImportOptions {mode?:'editable'|'flatten'}
interface Paint {color:string;alpha:number}
type Colors=(value:string)=>Paint|null;
interface Style {fill:string;stroke:string;color:string;fillOpacity:number;strokeOpacity:number;strokeWidth:number;cap:string;join:string;miter:number;dash:number[];offset:number;rule:'evenodd'|'nonzero';visibility:boolean;opacity:number;display:boolean;text:SvgTextImportStyle}
const basic:Record<string,string>={black:'#000000',white:'#ffffff',red:'#ff0000',green:'#008000',blue:'#0000ff',yellow:'#ffff00',gray:'#808080',grey:'#808080',silver:'#c0c0c0',maroon:'#800000',purple:'#800080',fuchsia:'#ff00ff',lime:'#00ff00',olive:'#808000',navy:'#000080',teal:'#008080',aqua:'#00ffff',orange:'#ffa500',rebeccapurple:'#663399',transparent:'#00000000'};
const hex=(n:number)=>Math.round(n).toString(16).padStart(2,'0');

/** Native worker Canvas resolves the same CSS colors as the browser renderer. */
export function svgColorResolver(preserveStopRgb=false):Colors{
 const canvas=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(1,1):undefined,c=canvas?.getContext('2d',{willReadFrequently:true});
 return value=>{
  value=basic[value.toLowerCase()]??value;
  if(/^#[\da-f]{3,8}$/i.test(value)){
   let digits=value.slice(1);if(digits.length===3||digits.length===4)digits=[...digits].map(c=>c+c).join('');
   if(digits.length===6||digits.length===8)return{color:'#'+digits.slice(0,6).toLowerCase(),alpha:digits.length===8?parseInt(digits.slice(6),16)/255:1};
  }
  if(!c)return null;
  c.fillStyle='#010203';c.fillStyle=value;const a=c.fillStyle;c.fillStyle='#040506';c.fillStyle=value;if(a!==c.fillStyle)return null;
  if(preserveStopRgb){
   // A transparent rendered pixel cannot recover its unpremultiplied RGB.
   // Ask native CSS conversion for an unpremultiplied sRGB value instead.
   const relative=`color(from ${value} srgb r g b / alpha)`;
   c.fillStyle='#010203';c.fillStyle=relative;const first=c.fillStyle;
   c.fillStyle='#040506';c.fillStyle=relative;
   const canonical=first===c.fillStyle?first:a;
   if(/^#[\da-f]{6}$/i.test(canonical))return{color:canonical.toLowerCase(),alpha:1};
   const number='([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)';
   const srgb=new RegExp(`^color\\(srgb\\s+${number}\\s+${number}\\s+${number}(?:\\s*/\\s*${number})?\\s*\\)$`,'i').exec(canonical);
   const rgb=new RegExp(`^rgba?\\(\\s*${number}\\s*,\\s*${number}\\s*,\\s*${number}(?:\\s*,\\s*${number})?\\s*\\)$`,'i').exec(canonical);
   const found=srgb??rgb;if(!found)return null;
   const channels=found.slice(1,4).map(Number).map(n=>srgb?n:n/255),alpha=found[4]===undefined?1:Number(found[4]);
   // Wide-gamut/HDR stops cannot be represented by native six-digit sRGB.
   if(!channels.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||!Number.isFinite(alpha)||alpha<0||alpha>1)return null;
   return{color:'#'+channels.map(n=>hex(n*255)).join(''),alpha};
  }
  c.clearRect(0,0,1,1);c.fillRect(0,0,1,1);const p=c.getImageData(0,0,1,1).data;return{color:'#'+hex(p[0])+hex(p[1])+hex(p[2]),alpha:p[3]/255};
 };
}
function length(value:string,fallback=0):number{
 if(!value.trim())return fallback;const found=/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(px|in|cm|mm|q|pt|pc)?$/i.exec(value.trim());
 if(!found)throw new Error('Relative or unsupported SVG length units require flattened import.');const factors:Record<string,number>={px:1,in:96,cm:96/2.54,mm:96/25.4,q:96/101.6,pt:96/72,pc:16},result=Number(found[1])*(factors[(found[2]??'px').toLowerCase()]);if(!Number.isFinite(result))throw new Error('SVG lengths must be finite.');return result;
}
const unescapeCss=(value:string)=>value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\\r?\n/g,'').replace(/\\([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|\\([^\n\r\f])/gi,(_,n:string,c:string)=>n?String.fromCodePoint(Math.min(0x10ffff,parseInt(n,16))):c);
function allowedReference(value:string){
 if(value.startsWith('#'))return true;
 const match=/^data:image\/(png|jpeg|webp);base64,([\s\S]*)$/i.exec(value);if(!match)return false;
 // Image-mode SVG can animate embedded APNG/WebP too. Admit static sources only;
 // the host never relies on the decoder's timing to select an animation frame.
 const binary=atob(match[2].replace(/\s/g,''));
 const u32=(at:number,little=false)=>{const a=binary.charCodeAt(at),b=binary.charCodeAt(at+1),c=binary.charCodeAt(at+2),d=binary.charCodeAt(at+3);return little?(a+b*256+c*65536+d*16777216):(a*16777216+b*65536+c*256+d);};
 if(match[1].toLowerCase()==='png')for(let at=8;at+12<=binary.length;){const size=u32(at),tag=binary.slice(at+4,at+8);if(tag==='acTL')throw new Error('Animated embedded images are not admitted. Export a static frame first.');if(size>binary.length-at-12)break;at+=size+12;}
 if(match[1].toLowerCase()==='webp')for(let at=12;at+8<=binary.length;){const tag=binary.slice(at,at+4),size=u32(at+4,true);if(tag==='ANIM'||tag==='ANMF'||tag==='VP8X'&&!!(binary.charCodeAt(at+8)&2))throw new Error('Animated embedded images are not admitted. Export a static frame first.');if(size>binary.length-at-8)break;at+=8+size+(size%2);}
 return true;
}
function properties(element:XmlElement,inline=svgStyleDeclarations(element.getAttribute('style')??'',allowedReference)):Record<string,string>{
 const values:Record<string,string>=Object.create(null);for(let i=0;i<element.attributes.length;i++){const a=element.attributes.item(i)!;values[a.name]=a.value;}
 Object.assign(values,inline);
 return values;
}

/** Inert XML inspection/conversion, called only in a terminable host worker. */
export function inspectSvgSource(source:string,name='Imported SVG',resolveColor:Colors=svgColorResolver(),resolveGradientColor:Colors=svgColorResolver(true)):SvgInspection{
 const xml=new DOMParser({onError:(_level,message)=>{throw new Error(message);}}).parseFromString(source,'image/svg+xml'),root=xml.documentElement;
 if(xml.doctype)throw new Error('SVG DOCTYPE/entity declarations are not admitted.');
 if(!root||root.localName!=='svg'||(root.namespaceURI&&root.namespaceURI!==SVG))throw new Error('Choose an SVG XML document.');
 const unsupported=new Set<string>(),preserved=new Set<string>(),degraded=new Set<string>(['Original SVG XML, identifiers, CSS rules and editor-specific metadata are not archived or round-tripped.','Native Canvas and SVG curve, clip-edge and image sampling can differ. Choose flattened import for the browser SVG image rendering.']),ids=new Map<string,XmlElement>();let elements=0,additionalIssues=0;
 const issue=(value:string)=>{value=value.slice(0,1000);if(unsupported.has(value))return;if(unsupported.size<256)unsupported.add(value);else additionalIssues++;};
 const fonts:SvgFontSource[]=[],stack:XmlNode[]=[xml];
 while(stack.length){const node=stack.pop()!;if(node.nodeType===7&&node.nodeName!=='xml')throw new Error('SVG processing instructions are not admitted.');
  if(node.nodeType===1){const e=node as XmlElement;elements++;if(['script','foreignObject','animate','animateMotion','animateTransform','set','mpath','discard','handler','listener'].includes(e.localName??''))throw new Error('Executable, foreign HTML and animated SVG content are not admitted.');
   const key=e.getAttribute('id');if(key&&!ids.has(key))ids.set(key,e);
   if(e.localName==='style'){const sheet=svgFontStylesheet(e.textContent??'',allowedReference,issue);fonts.push(...sheet.fonts);if(sheet.otherRules)issue('Stylesheet selectors and conditional rules require flattened import.');}
   for(let i=0;i<e.attributes.length;i++){const a=e.attributes.item(i)!;if(/^on/i.test(a.localName??'')||a.name==='xml:base')throw new Error('SVG event handlers and xml:base are not admitted.');if(a.localName==='href'&&!allowedReference(a.value.trim()))throw new Error('External SVG resources are not loaded. Embed static PNG/JPEG/WebP pixels first.');if(a.name==='style')svgStyleDeclarations(a.value,allowedReference);else if(/url\(/i.test(unescapeCss(a.value)))svgCheckCssValue(a.value,allowedReference);}
  }
  for(let child=node.lastChild;child;child=child.previousSibling)stack.push(child);
 }
 const rootValues=properties(root),box=root.getAttribute('viewBox')?svgNumbers(root.getAttribute('viewBox')!):undefined;
 let w:number,h:number;
 try{w=length(rootValues.width??'',box?.[2]??300);h=length(rootValues.height??'',box?.[3]??150);}
 catch{w=box?.[2]??300;h=box?.[3]??150;degraded.add('Relative SVG viewport sizes use viewBox dimensions, or 300×150 when absent.');}
 if(!rootValues.width||!rootValues.height)degraded.add('Missing viewport dimensions use viewBox geometry, or 300×150 when absent.');
 const width=Math.ceil(w),height=Math.ceil(h);if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw new Error('SVG viewport dimensions must resolve to positive safe integer pixels.');
 if(width!==w||height!==h)degraded.add('Fractional viewport dimensions are rounded up to native integer canvas pixels.');
 const document=new Document({name:name.slice(0,240)||'Imported SVG',width,height}),viewport=document.layers.add(new LayerGroup({name:'SVG viewport'}));
 const assets:SvgInspection['assets']=[],images:SvgImagePlacement[]=[],texts:SvgTextPlacement[]=[],imageSources=new Map<string,string>();let layers=1;
 const initial:Style={fill:'#000000',stroke:'none',color:'#000000',fillOpacity:1,strokeOpacity:1,strokeWidth:1,cap:'butt',join:'miter',miter:4,dash:[],offset:0,rule:'nonzero',visibility:true,opacity:1,display:true,text:svgTextImportStyle({})};
 const known=new Set([...SVG_TEXT_ATTRIBUTES,'dx','dy','id','class','style','transform','fill','stroke','color','fill-opacity','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','fill-rule','clip-rule','opacity','display','visibility','vector-effect','paint-order','isolation','mix-blend-mode','color-interpolation','overflow','version','xmlns','xmlns:xlink','viewBox','preserveAspectRatio','width','height','x','y','rx','ry','cx','cy','r','x1','y1','x2','y2','points','d','href','xlink:href','role','inkscape:label']);
 function style(e:XmlElement,parent:Style):Style{
  const inline=svgStyleDeclarations(e.getAttribute('style')??'',allowedReference),p=properties(e,inline);if(Object.keys(inline).some(key=>['transform','x','y','dx','dy','width','height','rx','ry','cx','cy','r','x1','y1','x2','y2','d','points'].includes(key)))issue('CSS transforms and geometry properties require flattened import.');for(const key of Object.keys(p))if(!known.has(key)&&!(e.localName==='textPath'&&['startOffset','method','spacing','side'].includes(key))&&!key.startsWith('xmlns:')&&!key.startsWith('data-')&&!key.startsWith('aria-'))issue(`Unsupported SVG attribute/style: ${key}.`);
  const inherited=(key:string,fallback:string)=>p[key]===undefined||p[key]==='inherit'||p[key]==='unset'?fallback:p[key];
  const alpha=(key:string,fallback:number)=>{const raw=inherited(key,String(fallback));if(!raw.trim())throw new Error(`Invalid SVG ${key}.`);const n=raw.endsWith('%')?Number(raw.slice(0,-1))/100:Number(raw);if(!Number.isFinite(n))throw new Error(`Invalid SVG ${key}.`);return Math.max(0,Math.min(1,n));};
  if(p['mix-blend-mode']&&p['mix-blend-mode']!=='normal')issue('Non-normal SVG blending requires flattened import.');
  if(p.isolation&&!['auto','isolate'].includes(p.isolation))issue('Unsupported SVG isolation value.');
  if(p.overflow&&!(e===root&&['hidden','clip'].includes(p.overflow)))issue('SVG overflow clipping requires flattened import.');
  if(p['vector-effect']&&p['vector-effect']!=='none')issue('Non-scaling strokes require flattened import.');
  if(p['paint-order']&&p['paint-order']!=='normal'&&p['paint-order']!=='fill stroke markers')issue('Custom paint ordering requires flattened import.');
  const dashText=inherited('stroke-dasharray',parent.dash.length?parent.dash.join(' '):'none').trim();
  if(!dashText||/^,|,$|,\s*,/.test(dashText))throw new Error('Invalid SVG stroke dash separators.');
  const dash=dashText.toLowerCase()==='none'?[]:dashText.split(/\s*,\s*|\s+/).map(value=>{const n=length(value);if(n<0)throw new Error('Negative SVG dash lengths.');return n;});

  if(length(inherited('stroke-width',String(parent.strokeWidth)))<0)throw new Error('Negative SVG stroke width.');
  if(!['visible','hidden','collapse'].includes(inherited('visibility',parent.visibility?'visible':'hidden')))issue('Unsupported SVG visibility value.');
  const color=inherited('color',parent.color);
  return{fill:inherited('fill',parent.fill),stroke:inherited('stroke',parent.stroke),color:color.toLowerCase()==='currentcolor'?parent.color:color,fillOpacity:alpha('fill-opacity',parent.fillOpacity),strokeOpacity:alpha('stroke-opacity',parent.strokeOpacity),strokeWidth:length(inherited('stroke-width',String(parent.strokeWidth))),cap:inherited('stroke-linecap',parent.cap).trim().toLowerCase(),join:inherited('stroke-linejoin',parent.join).trim().toLowerCase(),miter:Number(inherited('stroke-miterlimit',String(parent.miter))),dash,offset:length(inherited('stroke-dashoffset',String(parent.offset))),rule:inherited('fill-rule',parent.rule) as Style['rule'],visibility:inherited('visibility',parent.visibility?'visible':'hidden')==='visible',opacity:alpha('opacity',p.opacity==='inherit'?parent.opacity:1),display:p.display!=='none',text:svgTextImportStyle(p,parent.text)};
 }
 function paint(value:string,currentColor:string):Paint|null{value=value.trim();if(value.toLowerCase()==='none')return null;const color=resolveColor(value.toLowerCase()==='currentcolor'?currentColor:value);if(!color)throw new Error('Unsupported SVG paint/color; gradients and paint servers require flattened import.');return color;}
 function geometry(e:XmlElement):SvgContour[]{
  const get=(key:string,fallback=0)=>length(e.getAttribute(key)??'',fallback),tag=e.localName??'';let d='';
  if(tag==='path')d=e.getAttribute('d')??'';
  else if(tag==='rect'){const x=get('x'),y=get('y'),w=get('width'),h=get('height'),rx=Math.min(w/2,get('rx',get('ry'))),ry=Math.min(h/2,get('ry',get('rx')));if(w<0||h<0||rx<0||ry<0)throw new Error('Negative SVG shape dimensions.');if(!w||!h)return[];d=rx&&ry?`M${x+rx} ${y}H${x+w-rx}A${rx} ${ry} 0 0 1 ${x+w} ${y+ry}V${y+h-ry}A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h}H${x+rx}A${rx} ${ry} 0 0 1 ${x} ${y+h-ry}V${y+ry}A${rx} ${ry} 0 0 1 ${x+rx} ${y}Z`:`M${x} ${y}H${x+w}V${y+h}H${x}Z`;}
  else if(tag==='circle'||tag==='ellipse'){const x=get('cx'),y=get('cy'),rx=get(tag==='circle'?'r':'rx'),ry=tag==='circle'?rx:get('ry');if(rx<0||ry<0)throw new Error('Negative SVG radii.');if(!rx||!ry)return[];d=`M${x+rx} ${y}A${rx} ${ry} 0 1 1 ${x-rx} ${y}A${rx} ${ry} 0 1 1 ${x+rx} ${y}Z`;}
  else if(tag==='line')d=`M${get('x1')} ${get('y1')}L${get('x2')} ${get('y2')}`;
  else{const points=svgNumbers(e.getAttribute('points')??'');if(points.length%2)throw new Error('SVG points require coordinate pairs.');if(!points.length)return[];d=`M${points[0]} ${points[1]} `+points.slice(2).map((n,i)=>i%2===0?'L'+n:String(n)).join(' ')+(tag==='polygon'?'Z':'');}
  const parsed=parseSvgContours(d);if(parsed.approximatedArcs)degraded.add('Elliptical arcs/circles/rounded corners are converted to editable cubic Bézier approximations.');return parsed.contours.filter(c=>c.points.length);
 }
 function add<T extends LayerGroup|VectorLayer|RasterLayer|TextLayer>(parent:LayerGroup,layer:T):T{if(++layers>64)throw new Error('SVG exceeds the native 64-layer editing budget. Choose flattened import.');parent.layers.add(layer);return layer;}
 function drawing(e:XmlElement,parent:LayerGroup,s:Style,local:AffineTransform,_world:AffineTransform){
  const contours=geometry(e),usesGradient=/^url\(/.test(s.fill.trim()),fillGradient=usesGradient?importSvgGradient(s.fill,bezierGeometryBounds(contours),{ids,properties,color:resolveGradientColor,length,viewport:{width:box?.[2]??w,height:box?.[3]??h,offset:!!(box?.[0]||box?.[1])}}):null,fill=usesGradient?null:paint(s.fill,s.color),stroke=paint(s.stroke,s.color),hasFill=!!(fill||fillGradient)&&e.localName!=='line',hasStroke=!!stroke&&s.strokeWidth>0,fillAlpha=(fillGradient?1:fill?.alpha??0)*s.fillOpacity,strokeAlpha=(stroke?.alpha??0)*s.strokeOpacity;
  if(fillGradient)preserved.add('Editable encoded-sRGB linear/radial gradient fills, opacity stops and affine paint coordinates.');
  if(s.rule!=='evenodd'&&s.rule!=='nonzero')throw new Error('Unsupported SVG fill rule.');if(!contours.length)return;
  // Opaque paints can share one editable contour graph. Translucent paints
  // require independent fill/stroke composition before the element opacity.
  const combined=hasFill&&hasStroke&&fillAlpha===1&&strokeAlpha===1&&contours.every(c=>c.closed);
  const label=(e.getAttribute('inkscape:label')||e.getAttribute('id')||e.localName||'SVG shape').slice(0,240),both=hasFill&&hasStroke&&!combined,owner=both?add(parent,new LayerGroup({name:label,opacity:s.opacity,visible:s.visibility&&s.display})):parent;
  if(both)degraded.add('Open fill/stroke geometry or translucent paints use independent editable fill/stroke layers; their later geometry edits are separate.');
  if(both)owner.transform=local;
  const make=(part:string,alpha:number)=>{const layer=add(owner,new VectorLayer({name:both?part:label,opacity:alpha*(both?1:s.opacity),visible:s.visibility&&s.display}));if(!both)layer.transform=local;return layer;};
  const strokeStyle={stroke:stroke?.color??null,strokeWidth:s.strokeWidth,strokeCap:s.cap as 'butt'|'round'|'square',strokeJoin:s.join as 'miter'|'round'|'bevel',strokeMiterLimit:s.miter,strokeDashArray:s.dash,strokeDashOffset:s.offset};
  if(hasFill){
   const layer=make('Fill',fillAlpha),primary=contours[0];
   layer.paths.add(new VectorPath({points:primary.points,closed:true,fill:fill?.color??null,...(fillGradient?{fillGradient}:{}),...(combined?strokeStyle:{stroke:null,strokeWidth:0}),
    ...(contours.length>1||s.rule==='evenodd'?{fillRule:s.rule,subpaths:contours.slice(1).map(c=>new VectorContour({points:c.points}))}:{}),
   }));
   if(contours.length>1||s.rule==='evenodd'||!primary.closed)preserved.add('Compound/even-odd/open fills retain editable native path contours.');
  }
  if(hasStroke&&!combined){const layer=make('Stroke',strokeAlpha);for(const c of contours)layer.paths.add(new VectorPath({points:c.points,closed:c.closed,fill:null,...strokeStyle}));}
  if(!hasFill&&!hasStroke){const layer=make('Unpainted path',1);for(const c of contours)layer.paths.add(new VectorPath({points:c.points,closed:c.closed,fill:null,stroke:null,strokeWidth:0}));}
  if(hasStroke)preserved.add('Editable stroke caps/joins, miter limits, dash arrays and offsets in local user units.');
  preserved.add('Editable paths, shapes, inherited solid paints and full affine placement.');
 }
 function image(e:XmlElement,parent:LayerGroup,s:Style,local:AffineTransform){
  const w=e.hasAttribute('width')?length(e.getAttribute('width')!):null,h=e.hasAttribute('height')?length(e.getAttribute('height')!):null;if((w!==null&&w<0)||(h!==null&&h<0))throw new Error('Negative SVG image dimensions.');if(w===0||h===0)return;
  const href=(e.getAttribute('href')||e.getAttribute('xlink:href')||'').trim();let assetId=imageSources.get(href);
  if(!assetId){const match=/^data:image\/(png|jpeg|webp);base64,([\s\S]*)$/i.exec(href);if(!match)throw new Error('Only embedded PNG/JPEG/WebP image pixels import as native raster layers.');const binary=atob(match[2].replace(/\s/g,'')),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),kind=match[1].toLowerCase();if(!(kind==='png'?bytes[0]===137&&String.fromCharCode(...bytes.subarray(1,4))==='PNG':kind==='jpeg'?bytes[0]===255&&bytes[1]===216:String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP'))throw new Error('Embedded image MIME/signature mismatch.');assetId=crypto.randomUUID();assets.push({id:assetId,name:`SVG image ${assets.length+1}.${kind}`,blob:new Blob([bytes],{type:'image/'+kind})});imageSources.set(href,assetId);}
  const layer=add(parent,new RasterLayer({name:(e.getAttribute('id')||'SVG image').slice(0,240),assetId,width:w??1,height:h??1,opacity:s.opacity,visible:s.visibility&&s.display}));layer.transform=local.multiply(AffineTransform.translation(length(e.getAttribute('x')??''),length(e.getAttribute('y')??'')));
  images.push({layerId:layer.id,assetId,viewportWidth:w,viewportHeight:h,aspect:e.getAttribute('preserveAspectRatio')||'xMidYMid meet'});preserved.add('Embedded PNG/JPEG/WebP source bytes and native-resolution raster assets with editable placement.');
 }
 function textDrawing(e:XmlElement,parent:LayerGroup,s:Style,local:AffineTransform){
  const position=(value:string,base:number)=>{if(value.includes('%'))throw new Error('Percentage SVG text positions require flattened import.');return svgTextLength(value,base);};
  const p=properties(e),x=position(p.x??'0',s.text.fontSize),y=position(p.y??'0',s.text.fontSize),dx=position(p.dx??'0',s.text.fontSize),dy=position(p.dy??'0',s.text.fontSize);
  const line=(element:XmlElement,owner:LayerGroup,settings:Style,transform:AffineTransform,x:number,y:number,path?:TextPathData)=>{
   if(settings.stroke!=='none'&&settings.strokeWidth>0)throw new Error('Stroked SVG text requires flattened import.');
   const color=(value:Style)=>{const fill=paint(value.fill,value.color),alpha=(fill?.alpha??0)*value.fillOpacity;if(!fill||alpha===0)return'#00000000';return alpha===1?fill.color:`rgba(${parseInt(fill.color.slice(1,3),16)},${parseInt(fill.color.slice(3,5),16)},${parseInt(fill.color.slice(5,7),16)},${alpha})`;};
   const runs=svgTextImportRuns(element,settings,(span,parent)=>{const value=style(span,parent);if(value.stroke!=='none'&&value.strokeWidth>0||value.opacity!==1||!value.display||value.visibility!==settings.visibility)throw new Error('SVG inline stroke, group opacity or visibility changes require flattened import.');return value;},value=>svgCharacterFormat(value.text,color(value)));
   const native=!!path||runs.styled,fill=paint(settings.fill,settings.color),content=native?runs.text:svgTextImportContent(element,settings.text),{anchor,xmlSpace:_xmlSpace,whiteSpace:_whiteSpace,...typography}=settings.text;
   const align=anchor==='middle'?'center':(anchor==='start')===(typography.direction==='ltr')?'left':'right';
   const prepared=new TextLayer({name:(element.getAttribute('id')||'SVG text').slice(0,240),text:content,...typography,fontVariationSettings:undefined,align,color:native?color(settings):fill?.color??'#000000',opacity:settings.opacity*(native?1:(fill?.alpha??0)*settings.fillOpacity),visible:settings.visibility&&settings.display});
   // Structural inspection retains authored axes but cannot load their source.
   // Native placement/reflow occurs only after private font preparation.
   const data=prepared.toJSON();if(data.kind!=='text')throw new Error('Expected SVG text');if(typography.fontVariationSettings!==undefined)data.fontVariationSettings=typography.fontVariationSettings;
   const layer=add(owner,Layer._fromData(data)as TextLayer);
   layer.transform=transform;texts.push({layerId:layer.id,x,y,...(native?{characterRanges:runs.ranges}:{}),...(path?{path}:{})});
   if(runs.styled)preserved.add('Editable inline character fonts, sizes, colors, native spacing and inherited source-indexed formatting.');
  };
  const children:XmlElement[]=[];let literal='';for(let child=e.firstChild;child;child=child.nextSibling){if(child.nodeType===1)children.push(child as XmlElement);else if(child.nodeType===3||child.nodeType===4)literal+=child.nodeValue??'';}
  if(children.some(child=>child.localName==='textPath')){
   if(children.length!==1||literal.trim()||x||y||dx)throw new Error('Mixed or repositioned SVG path text requires flattened import.');
   const child=children[0],fields=properties(child),href=(fields.href??fields['xlink:href']??'').trim(),target=href.startsWith('#')?ids.get(href.slice(1)):undefined;
   if(!target||target.localName!=='path')throw new Error('SVG text requires a local path reference.');
   if(['x','y','dx','dy','rotate','transform','textLength','lengthAdjust','path'].some(key=>child.hasAttribute(key))||!['align'].includes(fields.method??'align')||!['exact'].includes(fields.spacing??'exact')||!['left'].includes(fields.side??'left'))throw new Error('SVG text path positioning, stretching or side requires flattened import.');
   if(target.hasAttribute('pathLength'))throw new Error('Calibrated SVG path lengths require flattened import.');
   const targetParent=target.parentNode as XmlElement,referenceOwner=targetParent.localName==='defs'?targetParent.parentNode:targetParent;
   if(referenceOwner!==e.parentNode&&referenceOwner!==root)throw new Error('SVG path reference ancestry requires flattened import.');
   const geometry=parseSvgContours(target.getAttribute('d')??'');if(geometry.contours.length!==1)throw new Error('Compound SVG text baselines require flattened import.');
   if(geometry.approximatedArcs)degraded.add('Elliptical text baselines are approximated by editable cubic curves.');
   const contour=geometry.contours[0],matrix=svgTransform(target.getAttribute('transform')??''),settings=style(child,s);
   if(settings.opacity!==1||!settings.display||settings.visibility!==s.visibility||settings.text.direction!==s.text.direction||settings.text.anchor!==s.text.anchor)throw new Error('SVG path text group styling requires flattened import.');
   const path=textPathSchema.parse({points:contour.points.map(point=>({...matrix.point(point),in:matrix.point(point.in),out:matrix.point(point.out)})),closed:contour.closed,startOffset:position(fields.startOffset??'0',settings.text.fontSize),baselineOffset:dy});
   line(child,parent,{...settings,opacity:s.opacity},local,0,0,path);preserved.add('Editable native text on a copied single cubic baseline with source-owned character formatting.');
   degraded.add('SVG path references become independent editable text baselines; shared path/DOM identity and authored traversal flags are not retained.');
  }else if(children.some(child=>child.hasAttribute('x')||child.hasAttribute('y')||child.hasAttribute('dy'))){
   if(literal.trim()||dx||dy||children.some(child=>child.localName!=='tspan'||!child.hasAttribute('x')||!child.hasAttribute('y')&&!child.hasAttribute('dy')))throw new Error('Inline SVG positioning and character runs require flattened import.');
   const group=add(parent,new LayerGroup({name:(e.getAttribute('id')||'SVG text lines').slice(0,240),opacity:s.opacity,visible:s.display}));group.transform=local;let baseline=y;
   for(const child of children){const settings=style(child,s),fields=properties(child);if(child.hasAttribute('transform'))throw new Error('Transformed SVG text runs require flattened import.');baseline=fields.y!==undefined?position(fields.y,settings.text.fontSize):baseline;baseline+=position(fields.dy??'0',settings.text.fontSize);line(child,group,settings,new AffineTransform(),position(fields.x,settings.text.fontSize)+position(fields.dx??'0',settings.text.fontSize),baseline);}
   degraded.add('Independently positioned SVG text lines become independent native text layers; shared text/DOM identity is not retained.');
  }else line(e,parent,s,local,x+dx,y+dy);
  preserved.add('Editable horizontal text, whole-line typography, alphabetic baselines and full affine placement.');
  degraded.add('SVG and Canvas font substitution, shaping, whitespace and hinting can differ; installed/system fonts remain external references.');
 }
 function walk(e:XmlElement,parent:LayerGroup,inherited:Style,world:AffineTransform,refs:Set<string>,depth:number){
  if(depth>8){issue('SVG exceeds the native 8-level group editing budget. Choose flattened import.');return;}
  if(['defs','title','desc','metadata','linearGradient','radialGradient'].includes(e.localName??''))return;
  if(e.localName==='style')return;
  if(e.namespaceURI&&e.namespaceURI!==SVG){issue('Foreign XML drawing elements require flattened import.');return;}
  try{const s=style(e,inherited),local=svgTransform(e.getAttribute('transform')??''),next=world.multiply(local);
   if(e.localName==='g'||e.localName==='a'){const group=add(parent,new LayerGroup({name:(e.getAttribute('id')||e.localName||'SVG shape').slice(0,240),opacity:s.opacity,visible:s.display}));group.transform=local;for(let c=e.firstChild;c;c=c.nextSibling)if(c.nodeType===1)walk(c as XmlElement,group,s,next,refs,depth+1);}
   else if(e.localName==='use'){const key=(e.getAttribute('href')||e.getAttribute('xlink:href')||'').trim().slice(1),target=ids.get(key);if(!target||refs.has(key))throw new Error('Missing or cyclic SVG use reference.');const group=add(parent,new LayerGroup({name:(e.getAttribute('id')||'SVG use').slice(0,240),opacity:s.opacity,visible:s.display})),offset=local.multiply(AffineTransform.translation(length(e.getAttribute('x')??''),length(e.getAttribute('y')??'')));group.transform=offset;walk(target,group,s,world.multiply(offset),new Set([...refs,key]),depth+1);degraded.add('SVG use references expand independently; shared symbol/DOM identity is not retained.');}
   else if(e.localName==='image')image(e,parent,s,local);
   else if(e.localName==='text')textDrawing(e,parent,s,local);
   else if(['path','rect','circle','ellipse','line','polyline','polygon'].includes(e.localName??''))drawing(e,parent,s,local,next);
   else issue(`SVG ${e.localName} elements require flattened import.`);
  }catch(error){issue(error instanceof Error?error.message:String(error));}
 }
 try{const s=style(root,initial);viewport.opacity=s.opacity;viewport.visible=s.display;const view=box?svgViewBox(width,height,box,root.getAttribute('preserveAspectRatio')||'xMidYMid meet'):new AffineTransform();viewport.transform=svgTransform(root.getAttribute('transform')??'').multiply(view);for(let child=root.firstChild;child;child=child.nextSibling)if(child.nodeType===1)walk(child as XmlElement,viewport,s,viewport.transform,new Set(),1);}
 catch(error){issue(error instanceof Error?error.message:String(error));}
 root.setAttribute('xmlns',SVG);root.setAttribute('width',String(width));root.setAttribute('height',String(height));root.setAttribute('style',(root.getAttribute('style')??'')+`;width:${width}px!important;height:${height}px!important`);
 const flat=new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml;charset=utf-8'});
 if(fonts.length){preserved.add('Complete embedded font files are privately parsed and owned on import; no external font request is made.');degraded.add('SVG font-face CSS is converted to native face references; omitted original collections and external source files cannot be recovered from delivered face bytes.');}
 const report:SvgImportReport={version:1,width,height,canImportEditable:unsupported.size===0&&additionalIssues===0,featuresPreserved:[...preserved],featuresDegraded:[...degraded,'Flattened import uses the browser SVG image decoder at the inspected viewport, discarding vector/text/effect editability and original XML.'],unsupportedFeatures:[...unsupported],additionalIssues,elements,layers,images:assets.length,fonts:fonts.length,texts:texts.length};
 return{report,document:report.canImportEditable?document.toJSON():undefined,assets:report.canImportEditable?assets:[],images:report.canImportEditable?images:[],texts:report.canImportEditable?texts:[],fonts,flat};
}
