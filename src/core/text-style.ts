/** Shared native text state. Keep whole-line shaping in the browser engine. */
import type {ParagraphStyle} from './text-layout';
import {nativeVariationFamily} from '../fonts/variations';
import type {FontFeatures} from './font-features';
export interface TextStyle extends ParagraphStyle,FontFeatures {
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
export function nativeTextFamily(style:TextStyle):string {
  try{return nativeVariationFamily(style.fontFamily,style.fontVariationSettings);}
  catch(error){throw new UnsupportedTextStyleError(error instanceof Error?error.message:'Native font variations are unavailable.');}
}
/** Include stretch in matching and readiness checks, not only final drawing. */
export function nativeTextFont(style:TextStyle):string {
  const stretch=style.fontStretch&&style.fontStretch!=='normal'?` ${style.fontStretch}`:'';
  return `${style.fontStyle??'normal'} ${style.fontWeight??'normal'}${stretch} ${style.fontSize}px ${nativeTextFamily(style)}`;
}
export function assertTextStyleSupport(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, style: TextStyle) {
  if ((style.fontVariantCaps??'normal')!=='normal'&&!('fontVariantCaps'in context))
    throw new UnsupportedTextStyleError('This browser cannot render native capital variants. Choose Capitals Normal or Reset font features.');
  if ((style.fontStretch??'normal')!=='normal'&&!('fontStretch'in context))
    throw new UnsupportedTextStyleError('This browser cannot select native font stretch. Choose Stretch Normal or Reset font features.');
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
  context.font = nativeTextFont(style);
  if ('fontVariantCaps'in context) context.fontVariantCaps=style.fontVariantCaps??'normal';
  if ('fontStretch'in context) context.fontStretch=style.fontStretch??'normal';
  // Reset absent values too: measurement and export contexts are reused.
  if ('letterSpacing' in context) context.letterSpacing = `${style.letterSpacing ?? 0}px`;
  if ('wordSpacing' in context) context.wordSpacing = `${style.wordSpacing ?? 0}px`;
  if ('fontKerning' in context) context.fontKerning = style.fontKerning ?? 'auto';
  if ('direction' in context) context.direction = style.direction ?? 'ltr';
}
