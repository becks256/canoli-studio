import { solvePoissonSystem, type PoissonLinearSolver } from "./poisson-solver";
import type { PoissonBlendOptions, PoissonBlendResult } from "./types";
import {
  captureFloatPoissonOptions,
  validateFloatRetouchPixels,
  validateFloatRetouchCoverage,
  type FloatPoissonBlendResult,
} from "./float-types";

type Bytes = Uint8Array | Uint8ClampedArray;

/**
 * Four-neighbor Poisson blending in encoded RGB, solved by IC(0)-preconditioned CG.
 * Donor is already aligned with target. A zero-coverage outer ring supplies fixed
 * Dirichlet values. Coverage feathers the solved RGB; target alpha is preserved.
 * Transparent donor edges use target guidance; transparent targets stay untouched.
 */
export function poissonBlend(
  target: Bytes,
  donor: Bytes,
  width: number,
  height: number,
  coverage: Bytes,
  options: PoissonBlendOptions = {},
  solve: PoissonLinearSolver = solvePoissonSystem,
): PoissonBlendResult {
  return solveBlend(
    target,
    donor,
    width,
    height,
    coverage,
    options,
    solve,
    false,
  ) as PoissonBlendResult;
}

/** Signed/HDR linear guidance with the same Dirichlet system and native solve.
 * RGB never clamps or rounds through integer staging; target alpha is exact. */
export function floatPoissonBlend(
  target: Float32Array,
  donor: Float32Array,
  width: number,
  height: number,
  coverage: Bytes,
  options: PoissonBlendOptions = {},
  solve: PoissonLinearSolver = solvePoissonSystem,
): FloatPoissonBlendResult {
  validateFloatRetouchPixels(target, width, height);
  validateFloatRetouchPixels(donor, width, height);
  validateFloatRetouchCoverage(coverage, width, height);
  return solveBlend(
    target,
    donor,
    width,
    height,
    coverage,
    captureFloatPoissonOptions(options),
    solve,
    true,
  ) as FloatPoissonBlendResult;
}

function solveBlend(
  target: Bytes | Float32Array,
  donor: Bytes | Float32Array,
  width: number,
  height: number,
  coverage: Bytes,
  options: PoissonBlendOptions,
  solve: PoissonLinearSolver,
  floating: boolean,
): Omit<PoissonBlendResult, "pixels"> & {
  pixels: Float32Array | Uint8ClampedArray;
} {
  const count = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(count * 4) ||
    target.length !== count * 4 ||
    donor.length !== count * 4 ||
    coverage.length !== count
  ) {
    throw new Error(
      "Poisson blending requires matching positive integer RGBA and coverage dimensions.",
    );
  }
  const mode = options.mode ?? "source",
    tolerance = options.tolerance ?? 0.001,
    limit = options.maxIterations ?? 500;
  if (mode !== "source" && mode !== "mixed")
    throw new Error("Unknown Poisson blend mode.");
  if (
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    !Number.isSafeInteger(limit) ||
    limit <= 0
  ) {
    throw new Error(
      "Poisson tolerance and iteration limit must be positive and finite; iterations must be integer.",
    );
  }
  const pixels = floating
    ? new Float32Array(target)
    : new Uint8ClampedArray(target);
  const indices = new Int32Array(count).fill(-1);
  const active: number[] = [];
  for (let p = 0; p < count; p++) {
    if (!coverage[p]) continue;
    if (
      p < width ||
      p >= count - width ||
      p % width === 0 ||
      p % width === width - 1
    ) {
      throw new Error(
        "Poisson coverage requires an unselected one-pixel boundary. Supply a padded patch.",
      );
    }
    if (!target[p * 4 + 3]) continue;
    indices[p] = active.length;
    active.push(p);
  }
  const n = active.length;
  if (!n) return { pixels, converged: true, iterations: 0, residual: 0 };
  const neighbors = new Int32Array(n * 4);
  const offsets = [-1, 1, -width, width];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++)
      neighbors[i * 4 + k] = indices[active[i] + offsets[k]];
  // Incomplete Cholesky with the grid's original sparsity. Natural row order
  // makes left/up predecessors and right/down successors, including mask holes.
  // Reuse this geometry-only factor across the three color solves.
  const inverseDiagonal = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const left = neighbors[i * 4],
      up = neighbors[i * 4 + 2];
    const l = left < 0 ? 0 : inverseDiagonal[left],
      u = up < 0 ? 0 : inverseDiagonal[up];
    inverseDiagonal[i] = 1 / Math.sqrt(4 - l * l - u * u);
  }
  const x = new Float64Array(n),
    b = new Float64Array(n);
  let iterations = 0,
    residual = 0;
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < n; i++) {
      const p = active[i];
      x[i] = target[p * 4 + channel];
      let rhs = 0;
      for (let k = 0; k < 4; k++) {
        const q = p + offsets[k];
        const targetGradient =
          target[p * 4 + channel] - target[q * 4 + channel];
        const donorGradient =
          donor[p * 4 + 3] && donor[q * 4 + 3]
            ? donor[p * 4 + channel] - donor[q * 4 + channel]
            : targetGradient;
        rhs +=
          mode === "mixed" && Math.abs(targetGradient) > Math.abs(donorGradient)
            ? targetGradient
            : donorGradient;
        if (neighbors[i * 4 + k] < 0) rhs += target[q * 4 + channel];
      }
      b[i] = rhs;
    }
    const solved = solve(neighbors, inverseDiagonal, x, b, tolerance, limit);
    residual = Math.max(residual, solved.residual);
    for (let i = 0; i < n; i++) {
      const index = active[i] * 4 + channel,
        amount = coverage[active[i]] / 255;
      const corrected = floating ? x[i] : Math.max(0, Math.min(255, x[i])),
        value = target[index] + amount * (corrected - target[index]);
      pixels[index] = floating ? value : Math.round(value);
      if (floating && !Number.isFinite(pixels[index]))
        throw new Error(
          "Float Poisson output exceeds finite Float32 precision.",
        );
    }
    iterations = Math.max(iterations, solved.iterations);
  }
  return {
    pixels,
    converged: Number.isFinite(residual) && residual <= tolerance,
    iterations,
    residual,
  };
}
