import LineBreaker from 'linebreak';

export class NativeJustificationError extends Error {}

export const PARAGRAPH_LIMITS = {spacing: {min: 0, max: 10000}, indent: {min: -10000, max: 10000}} as const;
export interface ParagraphStyle {
  paragraphJustify?: 'none' | 'inter-word';
  wrapWidth?: number | null;
  paragraphSpacing?: number;
  firstLineIndent?: number;
}
export interface TextLayoutInput extends ParagraphStyle {
  text: string;
  fontSize: number;
  lineHeight: number;
  align?: 'left' | 'center' | 'right';
  direction?: 'ltr' | 'rtl';
  letterSpacing?: number;
  wordSpacing?: number;
}
export interface TextLayoutLine {
  text: string;
  x: number;
  y: number;
  /** Offsets into the unchanged authored string, including consumed spaces. */
  start: number;
  end: number;
  softBreak: boolean;
  /** Derived native spacing for this visual line; authored style is unchanged. */
  wordSpacing?: number;
}
export interface TextLayout {
  lines: TextLayoutLine[];
  width: number;
  height: number;
}
let graphemes: Intl.Segmenter | undefined;

export function assertParagraphStyle(style: ParagraphStyle): void {
  if (style.paragraphJustify !== undefined && !['none','inter-word'].includes(style.paragraphJustify)) throw new Error('Paragraph justification must be none or inter-word.');
  const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (style.wrapWidth != null && !finite(style.wrapWidth, 1, Number.MAX_SAFE_INTEGER)) throw new Error('Paragraph width must be finite and at least 1 pixel.');
  if (style.paragraphSpacing !== undefined && !finite(style.paragraphSpacing, PARAGRAPH_LIMITS.spacing.min, PARAGRAPH_LIMITS.spacing.max)) throw new Error('Paragraph spacing must be between 0 and 10000 pixels.');
  if (style.firstLineIndent !== undefined && !finite(style.firstLineIndent, PARAGRAPH_LIMITS.indent.min, PARAGRAPH_LIMITS.indent.max)) throw new Error('First-line indent must be between -10000 and 10000 pixels.');
}

/** Whole-line measurement/shaping; break opportunities never split graphemes.
 * Unbreakable runs overflow rather than being condensed, clipped or discarded.
 */
export function layoutText(input: TextLayoutInput, measure: (text: string, wordSpacing?: number) => number, alignmentWidth?: number): TextLayout {
  assertParagraphStyle(input);
  const lineHeight = input.fontSize * input.lineHeight, spacing = input.paragraphSpacing ?? 0, indent = input.firstLineIndent ?? 0;
  const lines: (TextLayoutLine & {indent: number; advance: number})[] = [];
  let paragraphStart = 0, widest = 0;
  const paragraphs = input.wrapWidth == null ? input.text.split('\n') : input.text.split(/[\n\u2029]/);
  const widths = new Map<string, number>();
  const spacedWidths = new Map<number, Map<string,number>>();
  let cachedCharacters = 0;
  const widthOf = (text: string, wordSpacing?: number) => {
    const cache = wordSpacing === undefined ? widths : spacedWidths.get(wordSpacing);
    let width = cache?.get(text);
    if (width === undefined) {
      width = measure(text, wordSpacing);
      if (!Number.isFinite(width)) throw new Error('The text engine returned a nonfinite line advance.');
      if (cachedCharacters+text.length+1 <= 32768) {
        if (wordSpacing === undefined) widths.set(text,width);
        else {
          let target=spacedWidths.get(wordSpacing);
          if(!target)spacedWidths.set(wordSpacing,target=new Map());
          target.set(text,width);
        }
        cachedCharacters += text.length+1;
      }
    }
    return width;
  };
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p];
    let first = true;
    const visible = (start: number, end: number, softBreak: boolean) => {
      const raw = paragraph.slice(start, end);
      return (softBreak ? raw.replace(/[ \t\r\f]+$/g, '') : raw).replace(/[\u2028\u2029]$/u, '').replace(/\u00ad/g, '') +
        (softBreak && raw.endsWith('\u00ad') ? '-' : '');
    };
    const emit = (start: number, end: number, softBreak: boolean, pointText = false) => {
      const text = pointText ? paragraph.slice(start, end) : visible(start, end, softBreak), currentIndent = first ? indent : 0;
      // Point-text placement already has authored intrinsic bounds. Rendering
      // must not add a full measurement pass to legacy unwrapped text.
      const advance = input.wrapWidth == null && alignmentWidth !== undefined ? 0 : widthOf(text);
      lines.push({text, x: 0, y: lines.length*lineHeight+p*spacing, start: paragraphStart+start, end: paragraphStart+end, softBreak, indent: currentIndent, advance});
      widest = Math.max(widest, advance+currentIndent);
      first = false;
    };
    if (input.wrapWidth == null) emit(0, paragraph.length, false, true);
    else if (!paragraph.length) emit(0, 0, false);
    else {
      if (typeof Intl.Segmenter !== 'function') throw new Error('Paragraph wrapping requires native grapheme segmentation.');
      const boundaries = new Set<number>([0]);
      graphemes ??= new Intl.Segmenter(undefined, {granularity: 'grapheme'});
      for (const segment of graphemes.segment(paragraph)) boundaries.add(segment.index+segment.segment.length);
      // Canvas normalizes these ASCII separators to individual spaces.
      const breaker = new LineBreaker(paragraph.replace(/[\t\r\f]/g, ' '));
      const breaks: {position: number; required: boolean}[] = [];
      for (let next = breaker.nextBreak(); next; next = breaker.nextBreak()) if (boundaries.has(next.position)) breaks.push(next);
      if (breaks.at(-1)?.position !== paragraph.length) breaks.push({position: paragraph.length, required: true});
      const requiredBeforeEnd = breaks.some(value => value.required && value.position < paragraph.length);
      let start = 0, accepted = 0, index = 0, lineStart = 0, estimated = 0, previous = 0;
      const estimate = (input.letterSpacing??0) >= 0 && (input.wordSpacing??0) >= 0;
      while (index < breaks.length) {
        const next = breaks[index], soft = next.position < paragraph.length && !next.required;
        const available = Math.max(0, input.wrapWidth-(first ? indent : 0));
        // Preserve one complete shaped line when the remaining paragraph fits.
        if (index === 0 && start === 0 && !requiredBeforeEnd && widthOf(visible(0, paragraph.length, false)) <= available) {
          emit(start, paragraph.length, false); start = paragraph.length; break;
        }
        if(estimate){
          // Token advances locate a candidate cheaply. They never decide final
          // shaping/fit: every emitted whole line is measured independently.
          estimated += widthOf(visible(previous,next.position,false)); previous=next.position;
          if(estimated<=available&&!next.required&&next.position<paragraph.length){accepted=next.position;index++;continue;}
        }
        if (widthOf(visible(start, next.position, soft)) > available) {
          if (accepted > start) {
            let chosen=index-1;
            while(chosen>=lineStart&&widthOf(visible(start,breaks[chosen].position,breaks[chosen].position<paragraph.length&&!breaks[chosen].required))>available)chosen--;
            if(chosen<lineStart)chosen=lineStart;
            const end=breaks[chosen];emit(start,end.position,end.position<paragraph.length&&!end.required);
            start=accepted=end.position;index=chosen+1;lineStart=index;estimated=0;previous=start;continue;
          }
          // At least one complete legal run always advances, even if too wide.
          emit(start, next.position, soft); start = accepted = next.position; index++;lineStart=index;estimated=0;previous=start;continue;
        }
        accepted = next.position; index++;
        if (next.required) {emit(start, accepted, false); start = accepted;lineStart=index;estimated=0;previous=start;}
        else if(estimate)estimated=widthOf(visible(start,accepted,false));
      }
      if (start < paragraph.length) emit(start, paragraph.length, false);
      if (paragraph.endsWith('\u2028')) emit(paragraph.length, paragraph.length, false);
    }
    paragraphStart += paragraph.length+1;
  }
  const width = input.wrapWidth ?? alignmentWidth ?? Math.max(1, Math.round(widest));
  const frame = input.wrapWidth ?? alignmentWidth ?? width;
  for (const line of lines) {
    const left = input.direction === 'rtl' ? 0 : line.indent, right = input.direction === 'rtl' ? frame-line.indent : frame;
    line.x = input.align === 'center' ? (left+right)/2 : input.align === 'right' ? right : left;
    const available = Math.max(0, right-left), tolerance = Math.max(1/64, available*2**-20);
    if (input.paragraphJustify === 'inter-word' && input.wrapWidth != null && line.softBreak && available-line.advance > tolerance ) {
      const body=line.text.replace(/^[\p{Zs}\t\r\f]+|[\p{Zs}\t\r\f]+$/gu,'');
      if(!/[\p{Zs}\t\r\f]/u.test(body))continue;
      // Measure the complete shaped line's native response, rather than
      // counting assumed glyphs/spaces or disconnecting joining scripts.
      const base = input.wordSpacing??0, slope = widthOf(line.text,base+1)-line.advance;
      if (!(slope > 0)) {
        // Fixed Unicode space characters are not necessarily word separators
        // in a host shaper. ASCII/NBSP word gaps must remain observable.
        if(!/[ \t\r\f\u00a0]/u.test(body))continue;
        throw new NativeJustificationError('This browser cannot apply inter-word justification to this text with the current kerning setting. Choose Kerning Normal or Reset paragraph.');
      }
      // A shaper's finite spacing precision accumulates across word gaps.
      // Keep the exact authored frame, and prefer a fitting native advance.
      const fitTolerance=Math.max(tolerance,slope/64);
      let spacing = base+(available-line.advance)/slope, advance = widthOf(line.text,spacing);
      let fitting={spacing:base,advance:line.advance};
      const consider=(spacing:number,advance:number)=>{if(advance<=available+tolerance&&advance>fitting.advance)fitting={spacing,advance};};
      consider(spacing,advance);
      for (let i=0;i<2 && Math.abs(available-advance)>tolerance;i++) {
        const nextSpacing = spacing+(available-advance)/slope, nextAdvance = widthOf(line.text,nextSpacing);
        consider(nextSpacing,nextAdvance);
        if (Math.abs(available-nextAdvance)>=Math.abs(available-advance)) break;
        spacing=nextSpacing;advance=nextAdvance;
      }
      if(advance>available+tolerance && available-fitting.advance>fitTolerance){
        // A rounded response can plateau across the secant correction. Probe
        // below the estimated root by half the allowed per-gap quantum.
        const lowerSpacing=Math.max(base,spacing+(available-advance)/slope-1/128);
        consider(lowerSpacing,widthOf(line.text,lowerSpacing));
      }
      if(advance>available+tolerance){spacing=fitting.spacing;advance=fitting.advance;}
      if (!Number.isFinite(spacing) || Math.abs(available-advance)>fitTolerance) throw new NativeJustificationError('This browser cannot fit native inter-word justification at this width. Adjust the width or Reset paragraph.');
      line.wordSpacing=spacing;line.advance=advance;
    }
  }
  return {lines, width, height: Math.max(1, Math.round(lines.length*lineHeight+(paragraphs.length-1)*spacing))};
}
