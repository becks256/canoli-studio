export type DodgeBurnMode = "dodge" | "burn";
export type DodgeBurnRange = "shadows" | "midtones" | "highlights";

export interface DodgeBurnOptions {
  mode: DodgeBurnMode;
  range: DodgeBurnRange;
  /** Unit interval; full exposure spans up to two stops before range weighting. */
  exposure: number;
  /** Unit interval, multiplied by per-pixel coverage. Defaults to one. */
  flow?: number;
  /** Prevent individual channels clipping by limiting a common RGB gain. Defaults true. */
  protectTones?: boolean;
}

export type PoissonBlendMode = "source" | "mixed";
export interface PoissonBlendOptions {
  mode?: PoissonBlendMode;
  /** Maximum absolute equation residual, in 8-bit RGB units. Default 0.001. */
  tolerance?: number;
  /** Iterations per color channel. Default 500. */
  maxIterations?: number;
}
export interface PatchOptions extends PoissonBlendOptions {
  /** Source: drag the repair selection toward a donor. Destination: drag the donor selection to the repair site. */
  direction?: "source" | "destination";
}
export interface PoissonBlendResult {
  pixels: Uint8ClampedArray;
  converged: boolean;
  iterations: number;
  residual: number;
}

export type RetouchSampleMode =
  "current-layer" | "current-and-below" | "all-layers";
export interface RetouchSamplingOptions {
  mode: RetouchSampleMode;
  layerId?: string;
}
