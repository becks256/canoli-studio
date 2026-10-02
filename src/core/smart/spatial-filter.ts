/** Internal working-tile contract; document smart-filter serialization is a separate boundary. */
export type SpatialFilterOptions =
  | {
      kind: "gaussian-blur";
      sigmaX: number;
      sigmaY?: number;
    }
  | {
      kind: "unsharp-mask";
      sigmaX: number;
      sigmaY?: number;
      amount: number;
      threshold?: number;
    };

export function spatialFilterSupport(options: SpatialFilterOptions): {
  x: number;
  y: number;
} {
  if (!options || !["gaussian-blur", "unsharp-mask"].includes(options.kind))
    throw new Error("Unknown spatial filter.");
  const sigmas = [options.sigmaX, options.sigmaY ?? options.sigmaX];
  // Finite convolution support is a worker allocation/work budget, not an image import limit.
  if (
    sigmas.some(
      (value) =>
        !Number.isFinite(value) || value < 0 || Math.ceil(3 * value) > 4096,
    )
  )
    throw new Error(
      "Spatial filter sigma exceeds the supported working-tile halo.",
    );
  if (
    options.kind === "unsharp-mask" &&
    (!Number.isFinite(options.amount) ||
      options.amount < 0 ||
      options.amount > 5 ||
      !Number.isFinite(options.threshold ?? 0) ||
      (options.threshold ?? 0) < 0 ||
      (options.threshold ?? 0) > 255)
  )
    throw new Error("Unsharp amount must be 0–5 and threshold 0–255.");
  return { x: Math.ceil(3 * sigmas[0]), y: Math.ceil(3 * sigmas[1]) };
}

/** Normalized Gaussian with finite three-sigma support; no intermediate byte quantization. */
export function gaussianWeights(sigma: number): Float64Array {
  const { x: radius } = spatialFilterSupport({
    kind: "gaussian-blur",
    sigmaX: sigma,
  });
  if (radius === 0) return new Float64Array([1]);
  const weights = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-0.5 * (i / sigma) ** 2);
    weights[i + radius] = value;
    total += value;
  }
  for (let i = 0; i < weights.length; i++) weights[i] /= total;
  return weights;
}
