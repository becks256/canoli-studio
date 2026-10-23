import {lensCorrectionCodec} from '../lens/codec';
import type {NativeLensModule} from '../lens/codec/canoli_lens_correction.js';
import {hasLensCorrection,validateLensGeometry,type LensCorrectionData} from './lens';
import type {RawImportReport} from './types';

/** Inspect/validate before demosaicing. The disposable host owns both native leases. */
export async function prepareRawLens(lens:LensCorrectionData|undefined,report:RawImportReport,load:()=>Promise<NativeLensModule>){
  if(!hasLensCorrection(lens))return undefined;
  validateLensGeometry(lens!,report.displayWidth,report.displayHeight);
  if(!lens!.profile)return undefined;
  if(report.channels===1&&lens!.profile.chromatic)throw new Error('Chromatic lens correction requires a color RAW source.');
  return lensCorrectionCodec(await load()).prepare(lens!.profile,{width:report.displayWidth,height:report.displayHeight,flip:report.flip},lens!.scale);
}
