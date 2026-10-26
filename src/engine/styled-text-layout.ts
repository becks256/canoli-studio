import {z} from 'zod';
import {characterFormatSchema,characterFormatPatchSchema,DEFAULT_CHARACTER_FORMAT,definedCharacterFormat,type CharacterFormat} from '../core/character-format';
import {characterRangeSchema,normalizeCharacterRanges,characterLineSpans,resolvedCharacterFormat} from '../core/text-ranges';
import {paragraphFormatSchema,DEFAULT_PARAGRAPH_FORMAT} from '../core/paragraph-styles';
import {layoutTextAsync,type TextMeasurementRange} from '../core/text-layout';
import {applyTextStyle,nativeTextFont} from '../core/text-style';
import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {yieldTask} from '../core/task-yield';
import {normalizeStyledTextScene,prepareStyledTextSurface,captureStyledTextFonts,applyStyledSpanStyle,type StyledTextSceneInput,type StyledTextLine,type StyledTextControl,type StyledTextSurface} from './styled-text';

const paragraphSchema=paragraphFormatSchema.pick({align:true,direction:true,lineHeight:true,paragraphSpacing:true,firstLineIndent:true,paragraphJustify:true}).partial().extend({wrapWidth:z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER).nullable().optional()}).strict();
const inputSchema=z.object({text:z.string().max(10000),ranges:z.array(characterRangeSchema).max(10000).default([]),style:characterFormatPatchSchema.optional(),paragraph:paragraphSchema.optional(),
  width:z.number(),height:z.number(),transform:z.tuple([z.number(),z.number(),z.number(),z.number(),z.number(),z.number()]).optional()}).strict();
export type StyledTextParagraphInput=z.input<typeof inputSchema>;
export interface StyledParagraphLine extends StyledTextLine {readonly source:Readonly<TextMeasurementRange>;readonly advance:number;readonly top:number;readonly height:number}
export interface StyledParagraphLayout {readonly width:number;readonly height:number;readonly lines:readonly StyledParagraphLine[]}
export interface StyledParagraphSurface extends StyledTextSurface {readonly layout:StyledParagraphLayout}
const NS='http://www.w3.org/2000/svg';

/** Native whole-paragraph layout from source-indexed formats. Internal until
 * the model, OO command, worker and UI contracts are connected together. */
export async function prepareStyledTextParagraph(input:StyledTextParagraphInput,document:DocumentData,assets:AssetStore,control:StyledTextControl={}):Promise<StyledParagraphSurface>{
  control={...control};
  const alive=assets.captureLifetime(),current=()=>{control.signal?.throwIfAborted();if(control.isCancelled?.())throw new DOMException('Styled paragraph preparation superseded.','AbortError');alive();};current();
  const value=inputSchema.parse(input),base=Object.freeze(characterFormatSchema.parse({...DEFAULT_CHARACTER_FORMAT,...definedCharacterFormat(value.style)})),ranges=normalizeCharacterRanges(value.text,value.ranges);
  // This validates all source scalars and the caller's work window before any
  // font lease or DOM allocation. Original source indices remain unchanged.
  const snapshot=normalizeStyledTextScene({width:value.width,height:value.height,transform:value.transform,lines:value.text.split(/[\n\u2028\u2029]/u).map(text=>({spans:[{text}]}))});
  const paragraph={align:DEFAULT_PARAGRAPH_FORMAT.align,direction:DEFAULT_PARAGRAPH_FORMAT.direction,lineHeight:DEFAULT_PARAGRAPH_FORMAT.lineHeight,paragraphSpacing:DEFAULT_PARAGRAPH_FORMAT.paragraphSpacing,firstLineIndent:DEFAULT_PARAGRAPH_FORMAT.firstLineIndent,paragraphJustify:DEFAULT_PARAGRAPH_FORMAT.paragraphJustify,...Object.fromEntries(Object.entries(value.paragraph??{}).filter(([,v])=>v!==undefined))} as Required<Omit<z.infer<typeof paragraphSchema>,'wrapWidth'>>&Pick<z.infer<typeof paragraphSchema>,'wrapWidth'>;
  const allSpans=characterLineSpans(value.text,ranges,base,{start:0,end:value.text.length,softBreak:false},false),styles=allSpans.length?allSpans.map(span=>span.style):[base];
  let fonts:ReturnType<typeof captureStyledTextFonts>|undefined,host:HTMLDivElement|undefined,surface:StyledTextSurface|undefined,handedOff=false;
  try{
    fonts=captureStyledTextFonts(styles,document,assets);const check=()=>{current();fonts!.check();if(host&&!host.isConnected)throw new Error('The styled paragraph measurement host was removed.');};check();
    const context=globalThis.document.createElement('canvas').getContext('2d');if(!context)throw new Error('Native styled paragraph measurement requires Canvas2D.');
    host=globalThis.document.createElement('div');host.setAttribute('data-canoli-styled-paragraph-probe','');host.setAttribute('aria-hidden','true');host.setAttribute('inert','');host.style.cssText='position:fixed;left:-100000px;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none;contain:strict';
    const shadow=host.attachShadow({mode:'closed'}),svg=globalThis.document.createElementNS(NS,'svg'),text=globalThis.document.createElementNS(NS,'text');svg.setAttribute('width','1');svg.setAttribute('height','1');svg.style.fontWeight='normal';svg.style.fontStyle='normal';text.style.whiteSpace='pre';text.setAttribute('direction',paragraph.direction);svg.append(text);shadow.append(svg);globalThis.document.body.append(host);
    const ready=new Set<string>();let readyCharacters=0;
    const assertReady=(style:Readonly<CharacterFormat>,sample:string)=>{
      const ordinary={...style,fontVariationSettings:'normal'},request=nativeTextFont(ordinary),key=JSON.stringify([ordinary,sample]);if(ready.has(key))return;
      applyTextStyle(context,ordinary);context.font='10px serif';context.font=request;
      if(context.font==='10px serif'){context.font='11px monospace';context.font=request;if(context.font==='11px monospace')throw new Error('Cannot measure an invalid styled-text font request.');}
      if(!globalThis.document.fonts.check(request,sample))throw new Error('A styled-text font is not loaded.');
      // A temporary readiness cache, independent of text/font admission.
      if(readyCharacters+key.length<=32768){ready.add(key);readyCharacters+=key.length;}
    };
    const wrapped=paragraph.wrapWidth!=null;
    const spansFor=(range:Readonly<TextMeasurementRange>)=>characterLineSpans(value.text,ranges,base,range,wrapped);
    const advance=(spans:ReturnType<typeof spansFor>,delta:number)=>{
      text.replaceChildren();for(const span of spans){assertReady(span.style,span.text);const node=globalThis.document.createElementNS(NS,'tspan');node.textContent=span.text;applyStyledSpanStyle(node,span.style,delta);text.append(node);}
      const result=text.getComputedTextLength();if(!Number.isFinite(result))throw new Error('The native styled-text advance is not finite.');return result;
    };
    const layout=await layoutTextAsync({...paragraph,text:value.text,fontSize:base.fontSize,letterSpacing:base.letterSpacing,wordSpacing:base.wordSpacing},(visible,spacing,range)=>{
      check();if(!range)throw new Error('Styled text measurement requires source ranges.');const spans=spansFor(range);
      if(spans.map(span=>span.text).join('')!==visible.replace(/[\t\r\f]/g,' '))throw new Error('Styled text projection differs from its source range.');
      return advance(spans,(spacing??base.wordSpacing)-base.wordSpacing);
    },undefined,{sourceRanges:true,pointLineBreaks:true,estimateTokens:styles.every(style=>style.letterSpacing>=0&&style.wordSpacing>=0),signal:control.signal,isCancelled:control.isCancelled});
    const paragraphs=new Uint32Array(value.text.length+1);for(let i=0;i<value.text.length;i++)paragraphs[i+1]=paragraphs[i]+Number(value.text[i]==='\n'||value.text[i]==='\u2029');
    let top=0,previousParagraph=0,deadline=performance.now()+8;const lines:StyledParagraphLine[]=[];
    for(const line of layout.lines){
      check();const source=Object.freeze({start:line.start,end:line.end,softBreak:line.softBreak}),spans=spansFor(source),delta=(line.wordSpacing??base.wordSpacing)-base.wordSpacing,p=paragraphs[line.start];top+=(p-previousParagraph)*paragraph.paragraphSpacing;previousParagraph=p;
      let baseline=-Infinity,maxSize=0;
      const emptyStyle=spans.length?base:resolvedCharacterFormat(ranges,base,Math.min(source.start,Math.max(0,value.text.length-1)));
      for(const span of spans.length?spans:[{text:'Mg',style:emptyStyle}]){
        const sample=span.text.trim()||'Mg';assertReady(span.style,sample);applyTextStyle(context,span.style);context.textBaseline='alphabetic';const alphabetic=context.measureText(sample).actualBoundingBoxAscent;context.textBaseline='top';const upper=context.measureText(sample).actualBoundingBoxAscent;
        if(!Number.isFinite(alphabetic-upper))throw new Error('The browser cannot measure styled text baselines.');baseline=Math.max(baseline,alphabetic-upper);maxSize=Math.max(maxSize,span.style.fontSize);
      }
      const height=maxSize*paragraph.lineHeight,lineAdvance=advance(spans,delta);
      lines.push(Object.freeze({source,x:line.x,y:top+baseline,top,height,wordSpacingDelta:delta,align:paragraph.align,direction:paragraph.direction,advance:lineAdvance,spans:Object.freeze(spans.map(span=>Object.freeze(span)))}));top+=height;
      if(performance.now()>=deadline){await yieldTask();check();deadline=performance.now()+8;}
    }
    const result=Object.freeze({width:layout.width,height:Math.max(1,Math.round(top)),lines:Object.freeze(lines)});check();
    host.remove();host=undefined;
    const scene:StyledTextSceneInput={width:snapshot.width,height:snapshot.height,transform:[...snapshot.transform]as [number,number,number,number,number,number],lines:lines.map(line=>({x:line.x,y:line.y,align:line.align,direction:line.direction,wordSpacingDelta:line.wordSpacingDelta,spans:line.spans.map(span=>({text:span.text,style:span.style}))}))};
    surface=await prepareStyledTextSurface(scene,fonts.document,assets,control);check();handedOff=true;return Object.freeze({...surface,layout:result});
  }finally{host?.remove();fonts?.release();if(!handedOff)surface?.release();}
}
