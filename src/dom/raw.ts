import {freeze} from '../core/immutable';
import {lensProfileSchema,type LensProfileOptions,type LensProfileData,type LensProfileSelectionOptions} from '../core/interchange/lens/schema';
import {lensCorrectionSchema,type LensCorrectionOptions,type LensCorrectionData} from '../core/interchange/raw/lens';
import {rawDevelopOptionsSchema,type RawDevelopOptions,type RawDevelopSettings,type RawImportControl} from '../core/interchange/raw/types';

/** Pure calibration value; construction never reads files or pixels. */
export class LensCorrection {
  private readonly settings:LensCorrectionData;
  constructor(options:LensCorrectionOptions={}){this.settings=freeze(lensCorrectionSchema.parse(options));Object.freeze(this);}
  toJSON():LensCorrectionData{return structuredClone(this.settings);}
}
export type LensProfileCorrectionOptions=Omit<LensProfileSelectionOptions,'definition'>&{scale?:number;enabled?:boolean};
/** Immutable, self-contained calibration value. Construction performs no file or native work. */
export class LensProfile {
  private readonly definition:LensProfileData;
  constructor(options:LensProfileOptions){this.definition=freeze(lensProfileSchema.parse(options));Object.freeze(this);}
  toJSON():LensProfileData{return structuredClone(this.definition);}
  correction(options:LensProfileCorrectionOptions):LensCorrection{
    const {scale,enabled,...selection}=options;
    const available=(kind:'distortion'|'chromatic')=>this.definition.calibrations.some(set=>set[kind].some(point=>point.model!=='none'));
    return new LensCorrection({scale,enabled,profile:{distortion:available('distortion'),chromatic:available('chromatic'),...selection,definition:this.toJSON()}});
  }
}
export type RawDevelopmentOptions=Omit<RawDevelopOptions,'lens'>&{lens?:LensCorrection|LensCorrectionOptions};

/** Immutable development parameters; constructing this value performs no work. */
export class RawDevelopment {
  private readonly settings:RawDevelopSettings;
  constructor(options:RawDevelopmentOptions={}){
    this.settings=freeze(rawDevelopOptionsSchema.parse({...options,...(options.lens instanceof LensCorrection?{lens:options.lens.toJSON()}:{})}));
    Object.freeze(this.settings.multipliers);Object.freeze(this.settings);Object.freeze(this);
  }
  toJSON():RawDevelopSettings{return structuredClone(this.settings);}
}
export interface RawDevelopmentControl extends RawImportControl {allowPrecisionLoss?:boolean}
