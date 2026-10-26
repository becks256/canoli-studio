import {paragraphFormatSchema,DEFAULT_PARAGRAPH_FORMAT} from './paragraph-styles';
import {z} from 'zod';

/** Character properties only; paragraph geometry remains on its frame. */
export const characterFormatSchema=paragraphFormatSchema.pick({fontSize:true,fontFamily:true,color:true,
  fontWeight:true,fontStyle:true,letterSpacing:true,wordSpacing:true,fontKerning:true,
  fontVariantCaps:true,fontStretch:true,fontVariationSettings:true});
export const characterFormatPatchSchema=characterFormatSchema.partial().strict();
export type CharacterFormat=z.infer<typeof characterFormatSchema>;
export type CharacterFormatPatch=z.infer<typeof characterFormatPatchSchema>;
export const DEFAULT_CHARACTER_FORMAT:Readonly<CharacterFormat>=Object.freeze(characterFormatSchema.parse(
  Object.fromEntries(Object.keys(characterFormatSchema.shape).map(key=>[key,DEFAULT_PARAGRAPH_FORMAT[key as keyof typeof DEFAULT_PARAGRAPH_FORMAT]]))));
export const definedCharacterFormat=(style:CharacterFormatPatch|undefined)=>Object.fromEntries(Object.entries(style??{}).filter(([,value])=>value!==undefined));
