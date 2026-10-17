/** Shared native text state. Keep whole-line shaping in the browser engine. */
import type {ParagraphStyle} from './text-layout';
export interface TextStyle extends ParagraphStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  wordSpacing?: number;
  fontKerning?: 'auto' | 'normal' | 'none';
  direction?: 'ltr' | 'rtl';
}
export class UnsupportedTextStyleError extends Error {}
export function assertTextStyleSupport(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, style: TextStyle) {
  if (style.paragraphJustify === 'inter-word' && !('wordSpacing' in context))
    throw new UnsupportedTextStyleError('This browser cannot render native paragraph justification. Use a supporting browser or Reset paragraph.');
  if ((style.wordSpacing ?? 0) !== 0 && !('wordSpacing' in context))
    throw new UnsupportedTextStyleError('This browser cannot render native word spacing. Use a supporting browser or reset Word spacing to 0.');
  if ((style.fontKerning ?? 'auto') !== 'auto' && !('fontKerning' in context))
    throw new UnsupportedTextStyleError('This browser cannot control native font kerning. Use a supporting browser or reset Kerning to Auto.');
}
/** Measurement callbacks must reset the base spacing after derived-line work. */
export function measureStyledText(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, style: TextStyle, wordSpacing = style.wordSpacing??0): number {
  if ('wordSpacing' in context) context.wordSpacing = `${wordSpacing}px`;
  return context.measureText(text).width;
}
export function applyTextStyle(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, style: TextStyle) {
  assertTextStyleSupport(context, style);
  context.font = `${style.fontStyle ?? 'normal'} ${style.fontWeight ?? 'normal'} ${style.fontSize}px ${style.fontFamily}`;
  // Reset absent values too: measurement and export contexts are reused.
  if ('letterSpacing' in context) context.letterSpacing = `${style.letterSpacing ?? 0}px`;
  if ('wordSpacing' in context) context.wordSpacing = `${style.wordSpacing ?? 0}px`;
  if ('fontKerning' in context) context.fontKerning = style.fontKerning ?? 'auto';
  if ('direction' in context) context.direction = style.direction ?? 'ltr';
}
