import {
  patchAdjustmentSchema,
  type PatchAdjustmentData,
  tonalStrokeSchema,
  type TonalStrokeData,
} from "../core/adjustments";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { BrushStroke } from "./values";

/** Detached immutable value; the brush is captured at construction. */
export class TonalStroke {
  private readonly data: TonalStrokeData;
  constructor(
    options: Omit<DodgeBurnOptions, "flow"> & { brush: BrushStroke },
  ) {
    if (!(options.brush instanceof BrushStroke))
      throw new Error("TonalStroke requires a BrushStroke constructor value.");
    const { brush, ...adjustment } = options;
    this.data = tonalStrokeSchema.parse({
      ...adjustment,
      brush: brush.toJSON(),
    });
  }
  toJSON(): TonalStrokeData {
    return structuredClone(this.data);
  }
}

/** Immutable corrected RGB asset with alpha interpreted as patch coverage. */
export class PatchAdjustment {
  private readonly data: PatchAdjustmentData;
  constructor(options: Omit<PatchAdjustmentData, "kind">) {
    this.data = patchAdjustmentSchema.parse({ ...options, kind: "patch" });
  }
  get assetId(): string {
    return this.data.assetId;
  }
  get width(): number {
    return this.data.width;
  }
  get height(): number {
    return this.data.height;
  }
  toJSON(): PatchAdjustmentData {
    return structuredClone(this.data);
  }
}
