import {fontVariantCapsSchema,fontStretchSchema,fontVariationSettingsSchema} from './font-features';
import {characterFormatSchema} from './character-format';
import type {CharacterLayoutLine} from './character-layout';
import type {LayerData,TextLayerData} from './model';
import type {SvgDocument} from './svg-masks';
import {svgAttribute,svgNumber} from './svg-path';

/** Private measured export data; original text/typography remains in the model. */
export interface SvgTextLayout {
  styledLines?:readonly CharacterLayoutLine[];
  baselines:readonly number[];
  color:string;
  letterSpacing:number;
  xOffsets?:readonly number[];
  lines?:readonly string[];
  xPositions?:readonly number[];
  wordSpacings?:readonly number[];
  spacingRuns?:readonly (readonly SvgWhitespaceRun[])[];
}
export interface SvgWhitespaceRun {start:number;end:number;wordSpacing:0;}

let segmenter:Intl.Segmenter|undefined;
function whitespaceBoundaries(text:string):Set<number>|undefined{
  if(typeof Intl.Segmenter!=='function')return;
  segmenter??=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  return new Set([0,text.length,...Array.from(segmenter.segment(text),part=>part.index)]);
}

/** Only spacing changes: never divide a word, glyph cluster or text chunk. */
export function svgWhitespaceRuns(line:string,mask:number):SvgWhitespaceRun[]{
  const text=line.replace(/[\t\r\f]/g,' '),first=text.search(/[^ \u00a0]/u),last=text.search(/[ \u00a0]*$/u),runs:SvgWhitespaceRun[]=[];
  for(let i=0;i<text.length;i++){
    const value=text[i],zero=((mask&1)!==0&&value===' ')||((mask&2)!==0&&value==='\u00a0')||((mask&4)!==0&&(value===' '||value==='\u00a0')&&(i<first||i>=last));
    if(!zero)continue;
    const previous=runs.at(-1);if(previous?.end===i)previous.end++;else runs.push({start:i,end:i+1,wordSpacing:0});
  }
  if(!runs.length)return runs;
  // Canvas first normalizes ASCII controls. Segment that same string: a space
  // with a following mark/ZWJ must never be separated by an inline style.
  const boundaries=whitespaceBoundaries(text);
  return boundaries&&runs.every(run=>boundaries.has(run.start)&&boundaries.has(run.end))?runs:[];
}
export function* svgTextContent(line:string,runs:readonly SvgWhitespaceRun[]=[]):Generator<string>{
  let offset=0;
  for(const run of runs){
    yield svgAttribute(line.slice(offset,run.start).replace(/[\t\r\f]/g,' '));
    yield '<tspan word-spacing="0">';
    yield svgAttribute(line.slice(run.start,run.end).replace(/[\t\r\f]/g,' '));
    yield '</tspan>';offset=run.end;
  }
  yield svgAttribute(line.slice(offset).replace(/[\t\r\f]/g,' '));
}
export type SvgTextLayouts=ReadonlyMap<string,SvgTextLayout>;

export function planSvgTexts(document:SvgDocument):TextLayerData[]{
  const result:TextLayerData[]=[];
  function walk(nodes:LayerData[]){for(const layer of nodes){
    if(!layer.visible||layer.opacity===0)continue;
    if(layer.kind==='text'&&layer.text)result.push(layer);
    else if(layer.kind==='group')walk(layer.children);
  }}
  walk(document.children);return result;
}

export function* svgTextElements(layer:TextLayerData,layout?:SvgTextLayout):Generator<string>{
  if(!layer.text)return;
  if(!layout)throw new Error('Text layers require host font measurement for SVG export.');
  if(layer.characterRanges!==undefined){
    if(!layout.styledLines)throw new Error('Character formatting requires prepared native SVG lines.');
    for(const line of layout.styledLines){
      const anchor=line.align==='center'?'middle':(line.align==='left')===(line.direction==='ltr')?'start':'end';
      yield `<text x="${svgNumber(line.x)}" y="${svgNumber(line.y)}" text-anchor="${anchor}" direction="${line.direction}" dominant-baseline="alphabetic" xml:space="preserve" style="white-space:pre">`;
      for(const span of line.spans){
        const s=characterFormatSchema.parse(span.style);
        if(!/^(?:#[a-fA-F0-9]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([a-zA-Z0-9.,%+\-/\s]+\))$/.test(s.color))throw new Error('SVG text requires a prepared literal color.');
        yield `<tspan font-family="${svgAttribute(s.fontFamily)}" font-size="${svgNumber(s.fontSize)}" font-weight="${svgAttribute(s.fontWeight??'normal')}" font-style="${s.fontStyle??'normal'}" letter-spacing="${svgNumber(s.letterSpacing)}" word-spacing="${svgNumber(s.wordSpacing+line.wordSpacingDelta)}" fill="${svgAttribute(s.color)}" style="font-kerning:${s.fontKerning??'auto'};font-variant-caps:${s.fontVariantCaps??'normal'};font-stretch:${s.fontStretch??'normal'};font-variation-settings:${svgAttribute(s.fontVariationSettings??'normal')}">${svgAttribute(span.text)}</tspan>`;
      }
      yield '</text>\n';
    }
    return;
  }
  const lines=layout.lines??layer.text.split('\n');
  if(lines.some(line=>typeof line!=='string'))throw new Error('Invalid SVG text lines.');
  if(layout.baselines.length!==lines.length)throw new Error('SVG text measurements do not match the line count.');
  if(layout.xOffsets&&(layout.xOffsets.length!==lines.length||layout.xOffsets.some(value=>!Number.isFinite(value))))throw new Error('Invalid SVG text spacing positions.');
  if(layout.xPositions&&(layout.xPositions.length!==lines.length||layout.xPositions.some(value=>!Number.isFinite(value))))throw new Error('Invalid SVG paragraph positions.');
  if(layout.wordSpacings&&(layout.wordSpacings.length!==lines.length||layout.wordSpacings.some(value=>!Number.isFinite(value))))throw new Error('Invalid SVG justification spacing.');
  if(layout.spacingRuns){
    if(!Array.isArray(layout.spacingRuns)||layout.spacingRuns.length!==lines.length)throw new Error('Invalid SVG whitespace line count.');
    for(let i=0;i<lines.length;i++){
      const runs=layout.spacingRuns[i];if(!Array.isArray(runs))throw new Error('Invalid SVG whitespace runs.');
      const boundaries=runs.length?whitespaceBoundaries(lines[i].replace(/[\t\r\f]/g,' ')):undefined;
      let end=0;
      for(const run of runs){
        if(!run||!Number.isSafeInteger(run.start)||!Number.isSafeInteger(run.end)||run.start<end||run.end<=run.start||run.end>lines[i].length||run.wordSpacing!==0||!/^[ \u00a0\t\r\f]+$/u.test(lines[i].slice(run.start,run.end)))throw new Error('Invalid SVG whitespace run.');
        if(!boundaries?.has(run.start)||!boundaries.has(run.end))throw new Error('SVG whitespace styling requires complete native graphemes.');
        end=run.end;
      }
    }
  }
  // These are browser-normalized literal colors, never URLs/paint servers.
  if(!/^(?:#[a-fA-F0-9]{3,8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([a-zA-Z0-9.,%+\-/\s]+\))$/.test(layout.color))throw new Error('SVG text requires a prepared literal color.');
  const direction=layer.direction??'ltr',align=layer.align;
  const fontKerning=layer.fontKerning??'auto';
  const caps=fontVariantCapsSchema.parse(layer.fontVariantCaps??'normal'),stretch=fontStretchSchema.parse(layer.fontStretch??'normal');
  const features=(caps==='normal'?'':`;font-variant-caps:${caps}`)+(stretch==='normal'?'':`;font-stretch:${stretch}`)+((layer.fontVariationSettings??'normal')==='normal'?'':`;font-variation-settings:${svgAttribute(fontVariationSettingsSchema.parse(layer.fontVariationSettings))}`);
  if(!['auto','normal','none'].includes(fontKerning))throw new Error('Invalid SVG font kerning.');
  if(direction!=='ltr'&&direction!=='rtl')throw new Error('Invalid SVG text direction.');
  const anchor=align==='center'?'middle':(align==='left')===(direction==='ltr')?'start':'end';
  const origin=align==='center'?layer.width/2:align==='right'?layer.width:0;
  for(let i=0;i<lines.length;i++){
    const x=(layout.xPositions?.[i]??origin)+(layout.xOffsets?.[i]??0);
    yield `<text x="${svgNumber(x)}" y="${svgNumber(layout.baselines[i])}" font-family="${svgAttribute(layer.fontFamily)}" font-size="${svgNumber(layer.fontSize)}" font-weight="${svgAttribute(layer.fontWeight??'normal')}" font-style="${svgAttribute(layer.fontStyle??'normal')}" letter-spacing="${svgNumber(layout.letterSpacing)}" word-spacing="${svgNumber(layout.wordSpacings?.[i]??layer.wordSpacing??0)}" direction="${direction}" text-anchor="${anchor}" dominant-baseline="alphabetic" fill="${svgAttribute(layout.color)}" xml:space="preserve" style="white-space:pre;font-kerning:${fontKerning}${features}">`;
    // Canvas fillText normalizes ASCII whitespace to individual spaces. Newline
    // layout is already explicit; tabs/CR/form feed must not become SVG tab stops.
    yield* svgTextContent(lines[i],layout.spacingRuns?.[i]);
    yield '</text>\n';
  }
}
