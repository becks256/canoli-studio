import {z} from 'zod';
import {PATH_POINT_LIMIT} from '../core/drawing';
import {textPathSchema,normalizeTextPath,textPathData,type TextPathGeometry} from '../core/text-path';
import {characterFormatSchema,characterFormatPatchSchema as formatPatchSchema,DEFAULT_CHARACTER_FORMAT,definedCharacterFormat,type CharacterFormat} from '../core/character-format';
import {applyNativeCharacterStyle} from '../core/character-layout';
import {fontFamilyNames} from '../core/font-families';
import {parseFontVariations,assertFontVariationRanges} from '../core/font-variations';
import {documentFontFiles} from '../core/font-files';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import type {Rect} from '../core/drawing';
import {applyTextStyle,nativeTextFont} from '../core/text-style';
import {captureOwnedExportFonts,captureExportFonts,type FontSourceCapture} from './export-fonts';
import {captureSvgFonts} from './svg-fonts';
import {yieldTask} from './task-yield';

const SVG_NS='http://www.w3.org/2000/svg';
const coordinate=z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const sceneSchema=z.object({
  width:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),height:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  transform:z.tuple([coordinate,coordinate,coordinate,coordinate,coordinate,coordinate]).optional(),
  style:formatPatchSchema.optional(),
  lines:z.array(z.object({x:coordinate.default(0),y:coordinate.default(0),wordSpacingDelta:coordinate.default(0),
    align:z.enum(['left','center','right']).default('left'),direction:z.enum(['ltr','rtl']).default('ltr'),
    path:textPathSchema.optional(),
    spans:z.array(z.object({text:z.string().max(10000),style:formatPatchSchema.optional()}).strict()).max(10000),
  }).strict()).max(10000),
}).strict().superRefine((scene,context)=>{
  const anchors=scene.lines.reduce((count,line)=>count+(line.path?.points.length??0),0);
  if(anchors>PATH_POINT_LIMIT)context.addIssue({code:'custom',message:'Styled text baselines exceed the existing 20000-anchor vector budget.'});
  const characters=scene.lines.reduce((count,line)=>count+line.spans.reduce((size,span)=>size+span.text.length,0),Math.max(0,scene.lines.length-1));
  if(characters>10000)context.addIssue({code:'custom',message:'Styled text exceeds the existing 10000-character text budget.'});
  for(const line of scene.lines){
    let previous='';
    for(const span of line.spans){
      if(/[\n\u2028\u2029]/u.test(span.text))context.addIssue({code:'custom',message:'Supply explicit visual lines for styled text.'});
      for(const character of span.text){const point=character.codePointAt(0)!;if(point<32&&![9,12,13].includes(point)||point>=0xd800&&point<=0xdfff||point===0xfffe||point===0xffff)context.addIssue({code:'custom',message:'Native SVG styled text cannot represent XML controls or unpaired surrogates.'});}
      if(!span.text)continue;
      if(/[\ud800-\udbff]$/.test(previous)&&/^[\udc00-\udfff]/.test(span.text))context.addIssue({code:'custom',message:'A style boundary cannot split a Unicode surrogate pair.'});
      previous=span.text;
    }
  }
});

/** Internal render DTOs; these are not a second public document mutation API. */
export type StyledTextSceneInput=z.input<typeof sceneSchema>;
export interface StyledTextSpan {readonly text:string;readonly style:Readonly<CharacterFormat>}
export interface StyledTextLine {readonly x:number;readonly y:number;readonly wordSpacingDelta:number;readonly align:'left'|'center'|'right';readonly direction:'ltr'|'rtl';readonly path?:TextPathGeometry;readonly spans:readonly StyledTextSpan[]}
export interface StyledTextScene {readonly width:number;readonly height:number;readonly transform:readonly number[];readonly lines:readonly StyledTextLine[]}
export interface StyledTextLineMetrics {readonly advance:number;readonly ink:Readonly<Rect>;readonly pathLength?:number}
export interface StyledTextControl {signal?:AbortSignal;isCancelled?:()=>boolean}
export interface StyledTextSurface {
  readonly bitmap:ImageBitmap;
  readonly metrics:readonly StyledTextLineMetrics[];
  check():void;
  release():void;
}

/** Snapshot before any await; parser budgets apply to text metadata, not fonts
 * or document geometry. Width/height describe a caller-selected work window. */
export function normalizeStyledTextScene(input:StyledTextSceneInput):StyledTextScene{
  const value=sceneSchema.parse(input),base={...DEFAULT_CHARACTER_FORMAT,...definedCharacterFormat(value.style)};
  const lines=value.lines.map(line=>{
    const spans:{text:string;style:Readonly<CharacterFormat>}[]=[];
    for(const span of line.spans){
      if(!span.text)continue;
      const style=Object.freeze(characterFormatSchema.parse({...base,...definedCharacterFormat(span.style)})),text=span.text.replace(/[\t\r\f]/g,' '),previous=spans.at(-1);
      if(previous&&Object.keys(characterFormatSchema.shape).every(key=>previous.style[key as keyof CharacterFormat]===style[key as keyof CharacterFormat]))previous.text+=text;
      else spans.push({text,style});
    }
    return Object.freeze({...line,...(line.path?{path:normalizeTextPath(line.path)}:{}),spans:Object.freeze(spans.map(span=>Object.freeze(span)))});
  });
  return Object.freeze({width:value.width,height:value.height,transform:Object.freeze(value.transform??[1,0,0,1,0,0]),
    lines:Object.freeze(lines),
  });
}

/** Private shared ownership for native measurement and raster preparation. */
export function captureStyledTextFonts(styles:readonly Readonly<CharacterFormat>[],document:DocumentData,assets:AssetStore){
  if(typeof globalThis.document==='undefined')throw new Error('Native styled text preparation requires a browser SVG host.');
  const families=[...new Set(styles.map(style=>style.fontFamily))],requested=new Set(families.flatMap(fontFamilyNames));
  const files=documentFontFiles(document).filter(file=>requested.has(file.resource.report.faces[0].cssFamily.toLowerCase())).map(file=>structuredClone(file));
  const fontDocument={...document,children:[],components:[],fontFiles:files};
  const ownedFamilies=new Set(files.map(file=>file.resource.report.faces[0].cssFamily.toLowerCase()));
  // An installed web face cannot be recovered from FontFace's public API. Do
  // not let its SVG-image copy silently select a different platform fallback.
  for(const face of globalThis.document.fonts)if(fontFamilyNames(face.family).some(name=>requested.has(name)&&!ownedFamilies.has(name)))throw new Error('Styled text requires an owned source for installed web fonts. Embed the requested font first.');
  for(const file of files)if(!assets.fonts.nativeAvailable||!assets.fonts.isActive(file.id))throw new Error('An owned styled-text font is not active on this native host.');
  for(const style of styles){
    const settings=style.fontVariationSettings??'normal';
    if(parseFontVariations(settings).length){
      if(typeof FontFace==='undefined'||!('variationSettings'in FontFace.prototype))throw new Error('This browser cannot render native font variations.');
      const primary=fontFamilyNames(style.fontFamily).map(name=>files.find(file=>file.resource.report.faces[0].cssFamily.toLowerCase()===name)).find(Boolean);
      if(!primary)throw new Error('Styled font variations require an owned embedded source.');
      assertFontVariationRanges(settings,primary.resource.report.faces[0].axes);
    }
  }
  let lease:FontSourceCapture|undefined;
  try{
    lease=captureOwnedExportFonts([fontDocument],families,assets);const native=captureExportFonts(families,'styled text preparation'),fonts=captureSvgFonts(fontDocument,assets,families);let released=false;
    const check=()=>{if(released)throw new Error('The styled text font capture was released.');lease!();native();fonts.check();};check();
    return{check,document:fontDocument,definitions:fonts.definitions,release:()=>{if(released)return;released=true;lease!.release();}};
  }catch(error){lease?.release();throw error;}
}

export function applyStyledSpanStyle(node:SVGTSpanElement,style:Readonly<CharacterFormat>,wordSpacingDelta=0){
  applyNativeCharacterStyle(node,style,wordSpacingDelta);
}

/** Prepare native whole-line SVG text in one pixel work window.
 * Path baselines are private render geometry; public path editing is separate. */
export async function prepareStyledTextSurface(input:StyledTextSceneInput,document:DocumentData,assets:AssetStore,control:StyledTextControl={}):Promise<StyledTextSurface>{
  control={...control};
  const alive=assets.captureLifetime();
  const cancelled=()=>{control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Styled text preparation superseded.','AbortError');alive();};cancelled();
  const scene=normalizeStyledTextScene(input);cancelled();
  if(typeof globalThis.document==='undefined'||typeof Image==='undefined'||typeof createImageBitmap!=='function')throw new Error('Native styled text preparation requires a browser SVG host.');
  let fonts:ReturnType<typeof captureStyledTextFonts>|undefined;
  let host:HTMLDivElement|undefined,image:HTMLImageElement|undefined,url:string|undefined,bitmap:ImageBitmap|undefined,released=false,handedOff=false;
  const release=()=>{if(released)return;released=true;bitmap?.close();fonts?.release();};
  const check=()=>{if(released)throw new Error('The styled text surface was released.');cancelled();fonts?.check();if(host&&!host.isConnected)throw new Error('The styled text measurement host was removed.');if(bitmap&&(bitmap.width!==scene.width||bitmap.height!==scene.height))throw new Error('The styled text bitmap was closed or changed.');};
  try{
    fonts=captureStyledTextFonts(scene.lines.flatMap(line=>line.spans.map(span=>span.style)),document,assets);
    check();const context=globalThis.document.createElement('canvas').getContext('2d')!;
    host=globalThis.document.createElement('div');host.setAttribute('data-canoli-styled-text-probe','');host.setAttribute('aria-hidden','true');host.setAttribute('inert','');host.style.cssText='position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
    const shadow=host.attachShadow({mode:'closed'}),svg=globalThis.document.createElementNS(SVG_NS,'svg');
    svg.setAttribute('width',String(scene.width));svg.setAttribute('height',String(scene.height));svg.style.fontWeight='normal';svg.style.fontStyle='normal';
    const group=globalThis.document.createElementNS(SVG_NS,'g');group.setAttribute('transform',`matrix(${scene.transform.join(' ')})`);svg.append(group);shadow.append(svg);globalThis.document.body.append(host);
    const elements:{text:SVGTextElement;line:StyledTextLine;path?:SVGPathElement}[]=[];let visited=0,deadline=performance.now()+8;
    for(const line of scene.lines){
      const text=globalThis.document.createElementNS(SVG_NS,'text');text.setAttribute('x',String(line.x));text.setAttribute('y',String(line.y));text.setAttribute('direction',line.direction);text.setAttribute('text-anchor',line.align==='center'?'middle':(line.align==='left')===(line.direction==='ltr')?'start':'end');text.style.whiteSpace='pre';
      let parent:SVGTextElement|SVGTextPathElement=text,path:SVGPathElement|undefined;
      if(line.path){
        const defs=globalThis.document.createElementNS(SVG_NS,'defs');path=globalThis.document.createElementNS(SVG_NS,'path');
        // Local fragments never accept author-supplied IDs, URLs or SVG markup.
        const id='canoli-text-baseline-'+elements.length;path.setAttribute('id',id);path.setAttribute('d',textPathData(line.path));defs.append(path);svg.prepend(defs);
        parent=globalThis.document.createElementNS(SVG_NS,'textPath');if(typeof SVGTextPathElement==='undefined'||!(parent instanceof SVGTextPathElement)||typeof path.getTotalLength!=='function')throw new Error('Native text on a path is unavailable.');parent.setAttribute('href','#'+id);parent.setAttribute('startOffset',String(line.path.startOffset));parent.setAttribute('method','align');parent.setAttribute('spacing','exact');
        text.setAttribute('x','0');text.setAttribute('y','0');text.setAttribute('dy',String(line.path.baselineOffset));text.setAttribute('transform',`translate(${line.x} ${line.y})`);text.append(parent);
      }
      for(const span of line.spans){
        const style=span.style,ordinary={...style,fontVariationSettings:'normal'};
        applyTextStyle(context,ordinary);const request=nativeTextFont(ordinary);context.font='10px serif';context.font=request;
        if(context.font==='10px serif'){context.font='11px monospace';context.font=request;if(context.font==='11px monospace')throw new Error('Cannot prepare an invalid styled-text font request.');}
        if(!globalThis.document.fonts.check(request,span.text))throw new Error('A styled-text font is not loaded.');
        context.fillStyle='#010203';context.fillStyle=style.color;
        if(context.fillStyle==='#010203'){context.fillStyle='#040506';context.fillStyle=style.color;if(context.fillStyle==='#040506')throw new Error('Cannot prepare an invalid styled-text color.');}
        const node=globalThis.document.createElementNS(SVG_NS,'tspan');node.textContent=span.text;node.setAttribute('fill',String(context.fillStyle));
        applyStyledSpanStyle(node,style,line.wordSpacingDelta);
        parent.append(node);
        if(++visited%32===0||performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+8;}
      }
      group.append(text);elements.push({text,line,...(path?{path}:{})});
    }
    const metrics=Object.freeze(elements.map(({text,line,path})=>{const box=text.getBBox(),advance=text.getComputedTextLength(),pathLength=path?.getTotalLength();if(![box.x,box.y,box.width,box.height,advance].every(Number.isFinite))throw new Error('The native styled-text geometry is not finite.');if(pathLength!==undefined&&(!Number.isFinite(pathLength)||pathLength<=0))throw new Error('Native text requires a finite, positive baseline length.');return Object.freeze({advance,ink:Object.freeze({x:box.x+(path?line.x:0),y:box.y+(path?line.y:0),width:box.width,height:box.height}),...(pathLength===undefined?{}:{pathLength})});}));
    const definitions=await fonts.definitions(check);check();
    const markup=new XMLSerializer().serializeToString(svg).replace(/(<svg\b[^>]*>)/,`$1${definitions}`);
    url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'}));image=new Image();
    // decode() alone can resolve before SVG fallback-font resources finish
    // loading. Wait for the actual load event before decoding/capturing; an
    // arbitrary delay or animation frame is not a readiness contract.
    await new Promise<void>((resolve,reject)=>{
      const finish=(error?:unknown)=>{image!.onload=null;image!.onerror=null;control.signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve();};
      const abort=()=>{image!.src='';finish(control.signal?.reason??new DOMException('Styled text preparation aborted.','AbortError'));};
      image!.onload=()=>finish();image!.onerror=()=>finish(new Error('Cannot load the styled text SVG image.'));
      control.signal?.addEventListener('abort',abort,{once:true});image!.src=url!;if(control.signal?.aborted)abort();
    });
    check();await image.decode();check();bitmap=await createImageBitmap(image);check();
    handedOff=true;return Object.freeze({bitmap,metrics,check,release});
  }finally{host?.remove();host=undefined;if(image)image.src='';if(url)URL.revokeObjectURL(url);if(!handedOff)release();}
}
