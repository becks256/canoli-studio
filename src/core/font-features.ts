/** Native whole-line font requests, separate from source text and geometry. */
import {z} from 'zod';
export {fontVariationSettingsSchema} from './font-variations';

export const FONT_CAPITAL_VARIANTS = ['normal','small-caps','all-small-caps','petite-caps','all-petite-caps','unicase','titling-caps'] as const;
export const FONT_STRETCHES = ['ultra-condensed','extra-condensed','condensed','semi-condensed','normal','semi-expanded','expanded','extra-expanded','ultra-expanded'] as const;
export const fontVariantCapsSchema=z.enum(FONT_CAPITAL_VARIANTS);
export const fontStretchSchema=z.enum(FONT_STRETCHES);
export type FontVariantCaps=z.infer<typeof fontVariantCapsSchema>;
export type FontStretch=z.infer<typeof fontStretchSchema>;
export interface FontFeatures {fontVariantCaps?:FontVariantCaps;fontStretch?:FontStretch;fontVariationSettings?:string}

/** Check serialized presence before parsing defaults; old readers cannot admit these fields. */
export function assertFontFeaturesVersion(value:object,version:number){
  if(version<44&&'fontVariationSettings'in value)throw new Error('Font variation settings require document schema version 44.');
  if(version<42&&('fontVariantCaps'in value||'fontStretch'in value))throw new Error('Native font variants and stretch require document schema version 42.');
}
