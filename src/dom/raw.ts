import {rawDevelopOptionsSchema,type RawDevelopOptions,type RawDevelopSettings,type RawImportControl} from '../core/interchange/raw/types';

/** Immutable development parameters; constructing this value performs no work. */
export class RawDevelopment {
  private readonly settings:RawDevelopSettings;
  constructor(options:RawDevelopOptions={}){
    this.settings=rawDevelopOptionsSchema.parse(options);
    Object.freeze(this.settings.multipliers);Object.freeze(this.settings);Object.freeze(this);
  }
  toJSON():RawDevelopSettings{return structuredClone(this.settings);}
}
export interface RawDevelopmentControl extends RawImportControl {allowPrecisionLoss?:boolean}
