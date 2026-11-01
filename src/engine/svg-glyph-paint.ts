import {AffineTransform} from '../core/affine';
import {validateWindow,type FloatSourceWindow} from '../core/float-source/types';
import {applyNativeCharacterStyle} from '../core/character-layout';
import {characterFormatSchema,DEFAULT_CHARACTER_FORMAT} from '../core/character-format';
import {yieldTask} from '../core/task-yield';
import {createCanvas,release} from './canvas';
import type {FloatGlyph} from './float-glyph';
import type {NativeGlyphFontControl} from './native-glyph-font';
const NS='http://www.w3.org/2000/svg';

/** Renderer-private native SVG primitives. Definitions contain checked complete
 * selector sources; authored text, public font records and paint RGB stay out. */
export async function captureSvgGlyphDocument(input:readonly FloatGlyph[],control:NativeGlyphFontControl={}):Promise<Element>{
 const glyphs=input.map(g=>{if(!g.font.monochrome||g.origin&&![g.origin.x,g.origin.y].every(Number.isFinite)||g.paintFontSize!==undefined&&(!Number.isFinite(g.paintFontSize)||g.paintFontSize<=0))throw new Error('Invalid monochrome SVG glyph placement.');return {...g,...(g.origin?{origin:Object.freeze({...g.origin})}:{}),style:characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...g.style}),transform:AffineTransform.fromJSON(g.transform)};}),options={...control,signal:AbortSignal.any([...(control.signal?[control.signal]:[]),...glyphs.flatMap(g=>g.font.signal?[g.font.signal]:[])])},check=()=>{options.signal?.throwIfAborted();options.check?.();for(const g of glyphs)g.font.check();options.signal?.throwIfAborted();};check();
 const doc=document.implementation.createDocument(NS,'svg'),root=doc.documentElement;root.setAttribute('xmlns',NS);const fonts=new Map< FloatGlyph['font'],Readonly<{definitions:string;features:string}>>();
 for(const glyph of glyphs){if(fonts.has(glyph.font))continue;if(!glyph.font.svgFont)throw new Error('The glyph owner cannot supply native SVG paint.');const source=await glyph.font.svgFont({...options,check});check();const parsed=new DOMParser().parseFromString('<svg xmlns="'+NS+'">'+source.definitions+'</svg>','image/svg+xml');if(parsed.querySelector('parsererror'))throw new Error('Invalid captured SVG glyph font.');for(const node of [...parsed.documentElement.children])root.append(doc.importNode(node,true));fonts.set(glyph.font,source);}
 let previous:string|undefined,parent:SVGGElement|undefined;for(const glyph of glyphs){check();const node=doc.createElementNS(NS,'text'),m=glyph.transform,key=`matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;if(key!==previous){parent=doc.createElementNS(NS,'g');parent.setAttribute('transform',key);root.append(parent);previous=key;}node.setAttribute('x',String(glyph.origin?.x??0));node.setAttribute('y',String(glyph.origin?.y??0));node.setAttribute('text-anchor','start');node.setAttribute('direction','ltr');node.setAttribute('fill','#fff');node.style.whiteSpace='pre';applyNativeCharacterStyle(node as unknown as SVGTSpanElement,{...DEFAULT_CHARACTER_FORMAT,...glyph.style,fontSize:glyph.paintFontSize??glyph.style.fontSize,fontFamily:glyph.font.family,color:'#fff',fontVariationSettings:'normal',fontKerning:'none',fontVariantCaps:'normal',letterSpacing:0,wordSpacing:0});node.style.fontFeatureSettings=fonts.get(glyph.font)!.features;node.textContent=glyph.font.character(glyph.glyphId);parent!.append(node);}
 check();return root;
}

/** Complete candidate geometry participates in verification and culling, so
 * unexpected ink outside the original line's box cannot escape comparison. */
export async function measureSvgGlyphBounds(root:Element,check:()=>void):Promise<Readonly<{x:number;y:number;width:number;height:number}>>{
 check();const host=document.createElement('div');host.setAttribute('data-canoli-svg-glyph-probe','');host.setAttribute('inert','');host.setAttribute('aria-hidden','true');host.style.cssText='position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
 const shadow=host.attachShadow({mode:'closed'}),svg=document.createElementNS(NS,'svg');svg.setAttribute('width','1');svg.setAttribute('height','1');svg.style.fontWeight='normal';svg.style.fontStyle='normal';shadow.append(svg);document.body.append(host);
 const active=()=>{check();if(!host.isConnected)throw new Error('The native SVG glyph measurement host was removed.');};
 try{let deadline=performance.now()+2;for(const node of root.children){if(node.localName==='defs')continue;if(node.localName!=='g'||[...node.children].some(c=>c.localName!=='text'))throw new Error('Invalid native SVG glyph measurement source.');svg.append(document.importNode(node,true));if(performance.now()>=deadline){await yieldTask();active();deadline=performance.now()+2;}}active();const b=svg.getBBox();active();if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<0||b.height<0)throw new Error('Native SVG glyph bounds are invalid.');return Object.freeze({x:b.x,y:b.y,width:b.width,height:b.height});}finally{host.remove();}
}

/** A fixed world-cell native SVG alpha read. Changing viewBox is a work-window
 * projection, never a font-size or source-geometry change. No bitmap survives. */
export async function renderSvgCellAlpha(root:Element,x:number,y:number,cell:number,gutter:number,alpha:number,control:NativeGlyphFontControl={}):Promise<Uint8ClampedArray>{
 const options={...control},check=()=>{options.signal?.throwIfAborted();options.check?.();options.signal?.throwIfAborted();},timeout=options.timeoutMs??60000;check();if(!Number.isInteger(timeout)||timeout<=0||timeout>0x7fffffff)throw new Error('Invalid SVG glyph read time budget.');const size=cell+gutter*2;root.setAttribute('width',String(size));root.setAttribute('height',String(size));root.setAttribute('viewBox',`${x-gutter} ${y-gutter} ${size} ${size}`);
 for(const node of root.querySelectorAll('text,tspan')){node.setAttribute('fill','#fff');node.setAttribute('fill-opacity',String(alpha));}
 const canvas=createCanvas(size,size,true),image=new Image();let url:string|undefined,timer:ReturnType<typeof setTimeout>|undefined,abort=()=>{};
 try{
  url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)],{type:'image/svg+xml'}));
  await new Promise<void>((resolve,reject)=>{let ended=false;const finish=(error?:unknown)=>{if(ended)return;ended=true;error===undefined?resolve():reject(error);};abort=()=>finish(options.signal?.reason??new Error('Native SVG glyph paint cancelled.'));image.onload=()=>{void Promise.resolve().then(()=>image.decode()).then(()=>finish(),finish);};image.onerror=()=>finish(new Error('Cannot load the captured native SVG glyph paint.'));timer=setTimeout(()=>finish(new Error('Native SVG glyph paint exceeded its time budget.')),timeout);options.signal?.addEventListener('abort',abort,{once:true});image.src=url!;if(options.signal?.aborted)abort();});
  check();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);check();const bytes=c.getImageData(gutter,gutter,cell,cell).data,output=new Uint8ClampedArray(cell*cell);for(let i=0;i<output.length;i++)output[i]=bytes[i*4+3];check();return output;
 }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;image.src='';if(url)URL.revokeObjectURL(url);release(canvas);}
}

export async function renderFloatSvgGlyphCoverage(glyph:Readonly<FloatGlyph>,input:FloatSourceWindow,check:()=>void):Promise<Float32Array>{
 const area=validateWindow(input),output=new Float32Array(area.width*area.height),cell=256,gutter=2;check();glyph.font.check();const root=await captureSvgGlyphDocument([glyph],{signal:glyph.font.signal,check}),bounds=await measureSvgGlyphBounds(root,()=>{check();glyph.font.check();});
 for(let y=Math.floor(area.y/cell)*cell;y<area.y+area.height;y+=cell)for(let x=Math.floor(area.x/cell)*cell;x<area.x+area.width;x+=cell){
  check();glyph.font.check();
  if(bounds.x>=x+cell+4||bounds.y>=y+cell+4||bounds.x+bounds.width<=x-4||bounds.y+bounds.height<=y-4)continue;
  check();glyph.font.check();const bytes=await renderSvgCellAlpha(root,x,y,cell,gutter,1,{signal:glyph.font.signal,check}),left=Math.max(x,area.x),top=Math.max(y,area.y),right=Math.min(x+cell,area.x+area.width),bottom=Math.min(y+cell,area.y+area.height);
  for(let row=top;row<bottom;row++)for(let column=left;column<right;column++)output[(row-area.y)*area.width+column-area.x]=bytes[(row-y)*cell+column-x]/255;await yieldTask();check();glyph.font.check();
 }check();glyph.font.check();return output;
}
