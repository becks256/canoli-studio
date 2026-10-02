import { id } from "../core/model";
import { smartFilterSchema, type SmartFilterData } from "../core/smart/filters";
export abstract class SmartFilter {
  private readonly data: SmartFilterData;
  protected constructor(data: SmartFilterData) {
    this.data = smartFilterSchema.parse(data);
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
