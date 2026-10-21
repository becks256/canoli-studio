import { id } from "../core/model";
import { medianFilterSchema } from '../core/smart/median-filter';
import { documentToneFilterSchema, nativeCompositionFilterSchema, frequencyBandFilterSchema, smartFilterSchema, type SmartFilterData } from "../core/smart/filters";
export abstract class SmartFilter {
  private readonly data: SmartFilterData;
  protected constructor(data: SmartFilterData) {
    this.data = Object.freeze(smartFilterSchema.parse(data));
    Object.freeze(this);
  }
  get id(): string {
    return this.data.id;
  }
  get enabled(): boolean {
    return this.data.enabled;
  }
  get kind(): SmartFilterData["kind"] {
    return this.data.kind;
  }
  toJSON(): SmartFilterData {
    return structuredClone(this.data);
  }
}
type Options = { id?: string; enabled?: boolean };
export class MedianFilter extends SmartFilter {
  constructor(options: Options & { radius?: number } = {}) {
    const settings = medianFilterSchema.omit({kind:true}).partial().strict().parse(options);
    super({kind:'median', id:settings.id ?? id(), enabled:settings.enabled ?? true, radius:settings.radius ?? 1});
  }
}
export class GaussianBlurFilter extends SmartFilter {
  constructor(options: Options & { sigma?: number } = {}) {
    super({
      id: options.id ?? id(),
      enabled: options.enabled ?? true,
      kind: "gaussian-blur",
      sigma: options.sigma ?? 1,
    });
  }
}
export class UnsharpMaskFilter extends SmartFilter {
  constructor(
    options: Options & {
      sigma?: number;
      amount?: number;
      threshold?: number;
    } = {},
  ) {
    super({
      id: options.id ?? id(),
      enabled: options.enabled ?? true,
      kind: "unsharp-mask",
      sigma: options.sigma ?? 1,
      amount: options.amount ?? 1,
      threshold: options.threshold ?? 0,
    });
  }
}
export class SmartToneFilter extends SmartFilter {
  constructor(
    options: Options & {
      exposure?: number;
      contrast?: number;
      saturation?: number;
    } = {},
  ) {
    super({
      id: options.id ?? id(),
      enabled: options.enabled ?? true,
      kind: "tone",
      exposure: options.exposure ?? 0,
      contrast: options.contrast ?? 0,
      saturation: options.saturation ?? 0,
    });
  }
}

export class FrequencyBandFilter extends SmartFilter {
  constructor(options: Options & { sigma?: number; band?: "low" | "high" | "correction" } = {}) {
    const settings = frequencyBandFilterSchema.omit({kind:true}).partial().parse(options);
    super({kind:"frequency-band", id:settings.id === undefined ? id() : settings.id,
      enabled:settings.enabled === undefined ? true : settings.enabled,
      sigma:settings.sigma === undefined ? 4 : settings.sigma, band:settings.band === undefined ? "high" : settings.band});
  }
}

/** Keep this master's RGBA composition on its native grid before instance resampling. */
export class NativeCompositionFilter extends SmartFilter {
  constructor(options: Options = {}) {
    const settings=nativeCompositionFilterSchema.omit({kind:true}).partial().parse(options);
    const values={kind:'native-composition' as const,id:settings.id===undefined?id():settings.id,enabled:settings.enabled===undefined?true:settings.enabled};
    super(values);
  }
}

/** Tone in document pixels after instance placement, before its ordinary layer mask. */
export class DocumentToneFilter extends SmartFilter {
  constructor(options: Options & {exposure?:number;contrast?:number;saturation?:number} = {}) {
    const values=documentToneFilterSchema.omit({kind:true}).partial().parse(options);
    super({kind:'document-tone',id:values.id===undefined?id():values.id,enabled:values.enabled===undefined?true:values.enabled,
      exposure:values.exposure===undefined?0:values.exposure,contrast:values.contrast===undefined?0:values.contrast,saturation:values.saturation===undefined?0:values.saturation});
  }
}
