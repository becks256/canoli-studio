import { redEyeOptionsSchema, defaultRedEyeAdjustment, type RedEyeAdjustmentData } from "../core/red-eye";

/** Immutable parametric correction. Attach it to a masked AdjustmentLayer. */
export class RedEyeAdjustment {
  private readonly data: Readonly<RedEyeAdjustmentData>;

  constructor(options: { threshold?: number; strength?: number } = {}) {
    const values = redEyeOptionsSchema.parse(options), defaults = defaultRedEyeAdjustment();
    this.data = Object.freeze({ kind: "red-eye", threshold: values.threshold ?? defaults.threshold,
      strength: values.strength ?? defaults.strength });
    Object.freeze(this);
  }

  get threshold(): number { return this.data.threshold; }
  get strength(): number { return this.data.strength; }
  toJSON(): RedEyeAdjustmentData { return { ...this.data }; }
}
