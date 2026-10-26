import {textWritingSchema,verticalWriting,applyNativeTextWriting,type TextWriting} from './text-writing';
import {z} from 'zod';
import {textPathSchema,normalizeTextPath,textPathData,type TextPathGeometry} from './text-path';
import {bezierGeometryBounds} from './bezier-bounds';
import {characterFormatSchema,characterFormatPatchSchema,DEFAULT_CHARACTER_FORMAT,definedCharacterFormat,type CharacterFormat} from './character-format';
import {characterRangeSchema,normalizeCharacterRanges,characterLineSpans,resolvedCharacterFormat,type CharacterRangeData} from './text-ranges';
import {paragraphFormatSchema,DEFAULT_PARAGRAPH_FORMAT} from './paragraph-styles';
import {layoutText,layoutTextAsync,type TextMeasurementRange,type TextLayout} from './text-layout';
import {applyTextStyle,nativeTextFont} from './text-style';
import {fontFamilyNames} from './font-families';
import {captureExportFonts} from '../fonts/native-capture';
import {isOwnedNativeFontFamily,assertNativeFontVariations} from '../fonts/variations';
import {yieldTask} from './task-yield';
import type {Rect} from './drawing';

export const characterParagraphSchema=paragraphFormatSchema.pick({align:true,direction:true,lineHeight:true,paragraphSpacing:true,firstLineIndent:true,paragraphJustify:true}).partial().extend({wrapWidth:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional()}).strict();
export const characterTextSchema=z.object({text:z.string().max(10000),ranges:z.array(characterRangeSchema).max(10000).default([]),style:characterFormatPatchSchema.optional(),paragraph:characterParagraphSchema.optional(),path:textPathSchema.optional(),writing:textWritingSchema.optional()}).strict();
export type CharacterTextInput=z.input<typeof characterTextSchema>;
export interface CharacterSpan {readonly text:string;readonly style:Readonly<CharacterFormat>}
export interface CharacterLayoutLine {readonly source:Readonly<TextMeasurementRange>;readonly x:number;readonly y:number;readonly top:number;readonly height:number;readonly wordSpacingDelta:number;readonly align:'left'|'center'|'right';readonly direction:'ltr'|'rtl';readonly advance:number;readonly spans:readonly CharacterSpan[];readonly path?:TextPathGeometry;readonly pathLength?:number;readonly writing?:Readonly<TextWriting>}
export interface CharacterBounds {width:number;height:number;origin?:{x:number;y:number}}
export interface CharacterLayout {readonly origin?:Readonly<{x:number;y:number}>;readonly width:number;readonly height:number;readonly lines:readonly CharacterLayoutLine[];readonly ink:Readonly<Rect>;readonly accuracy:'native'|'estimated'}
export interface CharacterLayoutControl {signal?:AbortSignal;isCancelled?:()=>boolean;check?:()=>void;alignmentWidth?:number}
type Paragraph=Required<Omit<z.infer<typeof characterParagraphSchema>,'wrapWidth'>>&Pick<z.infer<typeof characterParagraphSchema>,'wrapWidth'>;
export interface CharacterTextSnapshot {readonly text:string;readonly ranges:readonly CharacterRangeData[];readonly style:Readonly<CharacterFormat>;readonly paragraph:Readonly<Paragraph>;readonly styles:readonly Readonly<CharacterFormat>[];readonly path?:TextPathGeometry;readonly writing?:Readonly<TextWriting>}
/** Structural read adapter; public callers mutate TextLayer, never this DTO. */
export function characterInputForLayer(layer:{text:string;characterRanges?:readonly CharacterRangeData[];textPath?:TextPathGeometry|null}&Partial<CharacterFormat>&z.input<typeof characterParagraphSchema>):CharacterTextInput{
 const attributes=layer as unknown as Record<string,unknown>;
 return{...(layer.textPath?{path:{...layer.textPath,points:layer.textPath.points.map(p=>({...p,in:{...p.in},out:{...p.out}}))}}:{}),text:layer.text,ranges:layer.characterRanges?[...layer.characterRanges]:[],style:characterFormatPatchSchema.parse(Object.fromEntries(Object.keys(characterFormatSchema.shape).filter(key=>attributes[key]!==undefined).map(key=>[key,attributes[key]]))),paragraph:characterParagraphSchema.parse(Object.fromEntries(Object.keys(characterParagraphSchema.shape).filter(key=>attributes[key]!==undefined).map(key=>[key,attributes[key]])))};
}
export function characterFontFamilies(layer:Parameters<typeof characterInputForLayer>[0]):string[]{return layer.characterRanges!==undefined?[...new Set(normalizeCharacterText(characterInputForLayer(layer)).styles.map(style=>style.fontFamily))]:[layer.fontFamily??DEFAULT_CHARACTER_FORMAT.fontFamily];}
let preparedBounds:{key:string;bounds:CharacterBounds;check?:()=>void}|undefined;
const boundsKey=(input:CharacterTextInput)=>{const s=normalizeCharacterText(input);return JSON.stringify([s.text,s.ranges,s.style,s.paragraph,s.path,s.writing]);};
/** Worker-local geometry only. The native host always remeasures commands. */
export function withPreparedCharacterBounds<T>(input:CharacterTextInput,bounds:CharacterBounds,operation:()=>T,check?:()=>void):T{
 const before=preparedBounds;preparedBounds={key:boundsKey(input),bounds,check};try{check?.();return operation();}finally{preparedBounds=before;}
}
export function characterTextBounds(input:CharacterTextInput):CharacterBounds{
 if(preparedBounds?.key===boundsKey(input)){preparedBounds.check?.();return{...preparedBounds.bounds};}const layout=measureCharacterText(input);return{width:layout.width,height:layout.height,...(layout.origin?{origin:{...layout.origin}}:{})};
}

export function assertCharacterTextScalars(text:string):void{
 for(const character of text){const point=character.codePointAt(0)!;if(point<32&&![9,10,12,13].includes(point)||point>=0xd800&&point<=0xdfff||point===0xfffe||point===0xffff)throw new Error('Native styled text cannot represent XML controls or unpaired surrogates.');}
}
export function normalizeCharacterText(input:CharacterTextInput):CharacterTextSnapshot{
 const value=characterTextSchema.parse(input);assertCharacterTextScalars(value.text);
 const ranges=normalizeCharacterRanges(value.text,value.ranges),style=Object.freeze(characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...definedCharacterFormat(value.style)}));
 const paragraph=Object.freeze({align:DEFAULT_PARAGRAPH_FORMAT.align,direction:DEFAULT_PARAGRAPH_FORMAT.direction,lineHeight:DEFAULT_PARAGRAPH_FORMAT.lineHeight,paragraphSpacing:DEFAULT_PARAGRAPH_FORMAT.paragraphSpacing,firstLineIndent:DEFAULT_PARAGRAPH_FORMAT.firstLineIndent,paragraphJustify:DEFAULT_PARAGRAPH_FORMAT.paragraphJustify,...Object.fromEntries(Object.entries(value.paragraph??{}).filter(([,v])=>v!==undefined))})as Readonly<Paragraph>;
 const spans=characterLineSpans(value.text,ranges,style,{start:0,end:value.text.length,softBreak:false},false),styles=Object.freeze(spans.length?spans.map(span=>span.style):[style]);
 const path=value.path?normalizeTextPath(value.path):undefined;if(path&&(paragraph.wrapWidth!=null||paragraph.paragraphSpacing!==0||paragraph.firstLineIndent!==0||paragraph.paragraphJustify!=='none'||/[\n\u2028\u2029]/u.test(value.text)))throw new Error('Path text requires one logical line without paragraph wrapping, spacing, indentation or justification.');
 return Object.freeze({text:value.text,ranges,style,paragraph,styles,...(path?{path}:{}),...(value.writing?{writing:Object.freeze(value.writing)}:{})});
}
export function applyNativeCharacterStyle(node:SVGTSpanElement,style:Readonly<CharacterFormat>,delta=0):void{
 Object.assign(node.style,{fontFamily:style.fontFamily,fontSize:`${style.fontSize}px`,fontWeight:style.fontWeight,fontStyle:style.fontStyle,fontKerning:style.fontKerning,letterSpacing:`${style.letterSpacing}px`,wordSpacing:`${style.wordSpacing+delta}px`,fontVariantCaps:style.fontVariantCaps??'normal',fontStretch:style.fontStretch??'normal',fontVariationSettings:style.fontVariationSettings??'normal'});
}
interface Measurer {readonly accuracy:'native'|'estimated';advance(spans:readonly CharacterSpan[],delta:number):number;baseline(span:CharacterSpan):number;ink(line:CharacterLayoutLine):Rect;check():void;dispose():void}
const NS='http://www.w3.org/2000/svg';
class NativeMeasurer implements Measurer {
 readonly accuracy='native';private host:HTMLDivElement;private text:SVGTextElement;private context:CanvasRenderingContext2D;private fonts:()=>void;private ready=new Set<string>();private readyCharacters=0;private baselineElement?:SVGPathElement;private pathText?:SVGTextPathElement;
 constructor(styles:readonly Readonly<CharacterFormat>[],direction:'ltr'|'rtl',path?:TextPathGeometry,writing?:Readonly<TextWriting>){
  const families=[...new Set(styles.map(style=>style.fontFamily))],requested=new Set(families.flatMap(fontFamilyNames));
  for(const face of document.fonts)for(const name of fontFamilyNames(face.family))if(requested.has(name)&&!isOwnedNativeFontFamily(name))throw new Error('Styled text requires an owned source for installed web fonts. Embed the requested font first.');
  for(const style of styles)assertNativeFontVariations(style.fontFamily,style.fontVariationSettings);
  this.fonts=captureExportFonts(families,'styled text measurement');const context=document.createElement('canvas').getContext('2d');if(!context)throw new Error('Native styled text measurement requires Canvas2D.');this.context=context;
  this.host=document.createElement('div');this.host.setAttribute('data-canoli-styled-paragraph-probe','');this.host.setAttribute('aria-hidden','true');this.host.setAttribute('inert','');this.host.style.cssText='position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
  const shadow=this.host.attachShadow({mode:'closed'}),svg=document.createElementNS(NS,'svg');this.text=document.createElementNS(NS,'text');svg.setAttribute('width','1');svg.setAttribute('height','1');svg.style.fontWeight='normal';svg.style.fontStyle='normal';this.text.style.whiteSpace='pre';this.text.setAttribute('direction',direction);applyNativeTextWriting(this.text,writing);if(path){
   if(typeof SVGTextPathElement==='undefined')throw new Error('Native text on a path is unavailable.');
   const defs=document.createElementNS(NS,'defs');this.baselineElement=document.createElementNS(NS,'path');this.baselineElement.setAttribute('id','canoli-measured-baseline');this.baselineElement.setAttribute('d',textPathData(path));defs.append(this.baselineElement);svg.append(defs);
   this.pathText=document.createElementNS(NS,'textPath');if(!(this.pathText instanceof SVGTextPathElement))throw new Error('Native text on a path is unavailable.');this.pathText.setAttribute('href','#canoli-measured-baseline');this.pathText.setAttribute('startOffset',String(path.startOffset));this.pathText.setAttribute('method','align');this.pathText.setAttribute('spacing','exact');this.text.setAttribute(verticalWriting(writing)?'dx':'dy',String(path.baselineOffset));
  }svg.append(this.text);shadow.append(svg);document.body.append(this.host);
 }
 pathLength(){const length=this.baselineElement?.getTotalLength();if(length===undefined||!Number.isFinite(length)||length<=0)throw new Error('Native text requires a finite, positive baseline length.');return length;}
 check(){this.fonts();if(!this.host.isConnected)throw new Error('The styled paragraph measurement host was removed.');}
 dispose(){this.host.remove();}
 private assertReady(style:Readonly<CharacterFormat>,sample:string){
  const ordinary={...style,fontVariationSettings:'normal'},request=nativeTextFont(ordinary),key=JSON.stringify([ordinary,sample]);if(this.ready.has(key))return;
  const c=this.context;applyTextStyle(c,ordinary);c.font='10px serif';c.font=request;if(c.font==='10px serif'){c.font='11px monospace';c.font=request;if(c.font==='11px monospace')throw new Error('Cannot measure an invalid styled-text font request.');}
  if(!document.fonts.check(request,sample))throw new Error('A styled-text font is not loaded.');c.fillStyle='#010203';c.fillStyle=style.color;if(c.fillStyle==='#010203'){c.fillStyle='#040506';c.fillStyle=style.color;if(c.fillStyle==='#040506')throw new Error('Cannot measure an invalid styled-text color.');}
  if(this.readyCharacters+key.length<=32768){this.ready.add(key);this.readyCharacters+=key.length;}
 }
 private configure(spans:readonly CharacterSpan[],delta:number){
  const parent=this.pathText??this.text;parent.replaceChildren();if(this.pathText)this.text.replaceChildren(this.pathText);for(const span of spans){this.assertReady(span.style,span.text);const node=document.createElementNS(NS,'tspan');node.textContent=span.text;applyNativeCharacterStyle(node,span.style,delta);parent.append(node);}
 }
 advance(spans:readonly CharacterSpan[],delta:number){this.check();this.text.setAttribute('x','0');this.text.setAttribute('y','0');this.text.setAttribute('text-anchor','start');this.configure(spans,delta);const width=this.text.getComputedTextLength();if(!Number.isFinite(width))throw new Error('The native styled-text advance is not finite.');return width;}
 baseline(span:CharacterSpan){const sample=span.text.trim()||'Mg';this.assertReady(span.style,sample);const c=this.context;applyTextStyle(c,span.style);c.textBaseline='alphabetic';const alphabetic=c.measureText(sample).actualBoundingBoxAscent;c.textBaseline='top';const top=c.measureText(sample).actualBoundingBoxAscent;if(!Number.isFinite(alphabetic-top))throw new Error('The browser cannot measure styled text baselines.');return alphabetic-top;}
 ink(line:CharacterLayoutLine){this.text.setAttribute('x',String(line.x));this.text.setAttribute('y',String(line.y));this.text.setAttribute('text-anchor',line.align==='center'?'middle':(line.align==='left')===(line.direction==='ltr')?'start':'end');this.configure(line.spans,line.wordSpacingDelta);const b=this.text.getBBox();if(![b.x,b.y,b.width,b.height].every(Number.isFinite))throw new Error('The native styled-text ink is not finite.');return{x:b.x,y:b.y,width:b.width,height:b.height};}
}
class EstimatedMeasurer implements Measurer {
 readonly accuracy='estimated';constructor(private writing?:Readonly<TextWriting>){}check(){}dispose(){}
 advance(spans:readonly CharacterSpan[],delta:number){let width=0,lastTracking=0;for(const span of spans){const s=span.style;for(const c of span.text){width+=s.fontSize*(verticalWriting(this.writing)&&this.writing?.orientation!=='sideways'?1:.6)+s.letterSpacing+(/[ \u00a0]/u.test(c)?s.wordSpacing+delta:0);lastTracking=s.letterSpacing;}}return width-lastTracking;}
 baseline(span:CharacterSpan){return span.style.fontSize*.8;}
 ink(line:CharacterLayoutLine){const shift=line.align==='center'?line.advance/2:line.align==='right'?line.advance:0;return verticalWriting(this.writing)?{x:line.x-line.height/2,y:line.y-shift,width:line.height,height:Math.max(0,line.advance)}:{x:line.x-shift,y:line.top,width:Math.max(0,line.advance),height:line.height};}
}
function pathLayout(snapshot:CharacterTextSnapshot,control:CharacterLayoutControl):CharacterLayout{
 const path=snapshot.path!,native=typeof document!=='undefined',measurer=native?new NativeMeasurer(snapshot.styles,snapshot.paragraph.direction,path,snapshot.writing):new EstimatedMeasurer(snapshot.writing);
 const current=()=>{control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Path text preparation superseded.','AbortError');control.check?.();measurer.check();};
 try{current();const spans=characterLineSpans(snapshot.text,snapshot.ranges,snapshot.style,{start:0,end:snapshot.text.length,softBreak:false},false),line:CharacterLayoutLine={source:Object.freeze({start:0,end:snapshot.text.length,softBreak:false}),x:0,y:0,top:0,height:0,wordSpacingDelta:0,align:snapshot.paragraph.align,direction:snapshot.paragraph.direction,advance:measurer.advance(spans,0),spans:Object.freeze(spans.map(s=>Object.freeze(s))),path,...(snapshot.writing?{writing:snapshot.writing}:{})};
  const geometry=bezierGeometryBounds([path]),padding=Math.max(...snapshot.styles.map(s=>s.fontSize))*2+Math.abs(path.baselineOffset),ink=native?measurer.ink(line):{x:geometry.x-padding,y:geometry.y-padding,width:geometry.width+padding*2,height:geometry.height+padding*2};
  const length=native?(measurer as NativeMeasurer).pathLength():undefined,currentLine=Object.freeze({...line,top:ink.y,height:Math.max(1,ink.height),...(length===undefined?{}:{pathLength:length})});current();
  return Object.freeze({width:Math.max(1,Math.ceil(ink.width)),height:Math.max(1,Math.ceil(ink.height)),origin:Object.freeze({x:ink.x,y:ink.y}),lines:Object.freeze([currentLine]),ink:Object.freeze(ink),accuracy:measurer.accuracy});
 }finally{measurer.dispose();}
}
function session(snapshot:CharacterTextSnapshot,control:CharacterLayoutControl){
 const measurer:Measurer=typeof document==='undefined'?new EstimatedMeasurer(snapshot.writing):new NativeMeasurer(snapshot.styles,snapshot.paragraph.direction,undefined,snapshot.writing),current=()=>{control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Text layout superseded.','AbortError');control.check?.();measurer.check();};
 const spansFor=(range:Readonly<TextMeasurementRange>)=>characterLineSpans(snapshot.text,snapshot.ranges,snapshot.style,range,snapshot.paragraph.wrapWidth!=null);
 const measure=(visible:string,spacing:number|undefined,range:Readonly<TextMeasurementRange>|undefined)=>{current();if(!range)throw new Error('Styled text measurement requires source ranges.');const spans=spansFor(range);if(spans.map(s=>s.text).join('')!==visible.replace(/[\t\r\f]/g,' '))throw new Error('Styled text projection differs from its source range.');return measurer.advance(spans,(spacing??snapshot.style.wordSpacing)-snapshot.style.wordSpacing);};
 function* complete(layout:TextLayout):Generator<CharacterLayoutLine,CharacterLayout,void>{
  const paragraphs=new Uint32Array(snapshot.text.length+1);for(let i=0;i<snapshot.text.length;i++)paragraphs[i+1]=paragraphs[i]+Number(snapshot.text[i]==='\n'||snapshot.text[i]==='\u2029');
  let top=0,previousParagraph=0,left=Infinity,upper=Infinity,right=-Infinity,bottom=-Infinity;const lines:CharacterLayoutLine[]=[];
  for(const raw of layout.lines){current();const source=Object.freeze({start:raw.start,end:raw.end,softBreak:raw.softBreak}),spans=spansFor(source),p=paragraphs[source.start];top+=(p-previousParagraph)*snapshot.paragraph.paragraphSpacing;previousParagraph=p;
   const sample=spans.length?spans:[{text:'Mg',style:resolvedCharacterFormat(snapshot.ranges,snapshot.style,Math.min(source.start,Math.max(0,snapshot.text.length-1)))}];let baseline=-Infinity,size=0;for(const span of sample){baseline=Math.max(baseline,measurer.baseline(span));size=Math.max(size,span.style.fontSize);}
   const height=size*snapshot.paragraph.lineHeight,delta=(raw.wordSpacing??snapshot.style.wordSpacing)-snapshot.style.wordSpacing,line=Object.freeze({source,x:verticalWriting(snapshot.writing)?(snapshot.writing!.mode==='vertical-rl'?-1:1)*(top+size/2):raw.x,y:verticalWriting(snapshot.writing)?raw.x:top+baseline,top,height,wordSpacingDelta:delta,align:snapshot.paragraph.align,direction:snapshot.paragraph.direction,advance:measurer.advance(spans,delta),spans:Object.freeze(spans.map(s=>Object.freeze(s))),...(snapshot.writing?{writing:snapshot.writing}:{})}),box=measurer.ink(line);
   if(box.width>0&&box.height>0){left=Math.min(left,box.x);upper=Math.min(upper,box.y);right=Math.max(right,box.x+box.width);bottom=Math.max(bottom,box.y+box.height);}lines.push(line);top+=height;yield line;
  }
  current();const ink=Object.freeze(left===Infinity?{x:0,y:0,width:0,height:0}:{x:left,y:upper,width:right-left,height:bottom-upper});
  if(verticalWriting(snapshot.writing)){const frameLeft=snapshot.writing!.mode==='vertical-rl'?-top:0,frameRight=snapshot.writing!.mode==='vertical-rl'?0:top,x=Math.min(frameLeft,left===Infinity?frameLeft:left),y=Math.min(0,upper===Infinity?0:upper),width=Math.max(1,Math.ceil(Math.max(frameRight,right===-Infinity?frameRight:right)-x)),height=Math.max(1,Math.ceil(Math.max(layout.width,bottom===-Infinity?0:bottom)-y));return Object.freeze({width,height,origin:Object.freeze({x,y}),accuracy:measurer.accuracy,lines:Object.freeze(lines),ink});}
  return Object.freeze({width:layout.width,height:Math.max(1,Math.round(top)),accuracy:measurer.accuracy,lines:Object.freeze(lines),ink});
 }
 return{measurer,current,measure,complete,input:{...snapshot.paragraph,text:snapshot.text,fontSize:snapshot.style.fontSize,letterSpacing:snapshot.style.letterSpacing,wordSpacing:snapshot.style.wordSpacing},options:{sourceRanges:true,pointLineBreaks:true,estimateTokens:snapshot.styles.every(s=>s.letterSpacing>=0&&s.wordSpacing>=0)}};
}
export function measureCharacterText(input:CharacterTextInput,control:CharacterLayoutControl={}):CharacterLayout{
 const captured={...control},snapshot=normalizeCharacterText(input);if(snapshot.path)return pathLayout(snapshot,captured);const work=session(snapshot,captured);try{work.current();const layout=layoutText(work.input,work.measure,captured.alignmentWidth,work.options),iterator=work.complete(layout);let result=iterator.next();while(!result.done)result=iterator.next();return result.value;}finally{work.measurer.dispose();}
}
export async function measureCharacterTextAsync(input:CharacterTextInput,control:CharacterLayoutControl={}):Promise<CharacterLayout>{
 const captured={...control},snapshot=normalizeCharacterText(input);if(snapshot.path)return pathLayout(snapshot,captured);const work=session(snapshot,captured);try{work.current();const layout=await layoutTextAsync(work.input,work.measure,captured.alignmentWidth,{...work.options,signal:captured.signal,isCancelled:captured.isCancelled}),iterator=work.complete(layout);let result=iterator.next(),deadline=performance.now()+8;while(!result.done){if(performance.now()>=deadline){await yieldTask();work.current();deadline=performance.now()+8;}result=iterator.next();}return result.value;}finally{work.measurer.dispose();}
}
