import type {DocumentData} from '../../src/core/model';
/** Construct pre-native-feature fixtures without fields that only the new format can store. */
export function withoutNativeFontFeatures(document:DocumentData):DocumentData{
 return JSON.parse(JSON.stringify(document,(key,value)=>key==='fontVariantCaps'||key==='fontStretch'||key==='fontVariationSettings'||key==='writingMode'||key==='textOrientation'?undefined:value));
}
