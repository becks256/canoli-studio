import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import { poissonBlend } from "../src/core/retouch/poisson";
import { instantiateKernel, wasmPoissonSolver } from "../src/engine/wasm";
import type { PoissonLinearSolver } from "../src/core/retouch/poisson-solver";
let solve: PoissonLinearSolver;
beforeAll(async () => {
  solve = wasmPoissonSolver(
    await instantiateKernel(
      new Uint8Array(await readFile("public/wasm/pixels.wasm")),
    ),
  );
});

for (const mode of ["source", "mixed"] as const)
  for (const width of [3, 7, 35]) {
    it(`WASM matches reference RGB, boundary/alpha and residual for ${mode} on ${width}px irregular domains`, () => {
      const height = width + 2;
      const target = new Uint8ClampedArray(width * height * 4),
        donor = target.slice(),
        mask = new Uint8Array(width * height);
      for (let p = 0; p < mask.length; p++) {
        const x = p % width,
          y = Math.floor(p / width);
        target.set(
          [(p * 13) % 256, (p * 31) % 256, (p * 7) % 256, p % 11 ? 177 : 0],
          p * 4,
        );
        donor.set(
          [(p * 37) % 256, (p * 19) % 256, (p * 23) % 256, p % 13 ? 255 : 0],
          p * 4,
        );
        mask[p] =
          x > 0 && y > 0 && x < width - 1 && y < height - 1 && p % 7
            ? p % 3
              ? 255
              : 128
            : 0;
      }
      const reference = poissonBlend(target, donor, width, height, mask, {
        mode,
      });
      const output = poissonBlend(
        target,
        donor,
        width,
        height,
        mask,
        { mode },
        solve,
      );
      expect(output.converged).toBe(true);
      expect(reference.converged).toBe(true);
      expect(output.pixels).toEqual(reference.pixels);
      expect(output.residual).toBeCloseTo(reference.residual, 8);
      expect(output.iterations).toBe(reference.iterations);
      const limited = poissonBlend(
        target,
        donor,
        width,
        height,
        mask,
        { mode, maxIterations: 1 },
        solve,
      );
      const limitedReference = poissonBlend(
        target,
        donor,
        width,
        height,
        mask,
        { mode, maxIterations: 1 },
      );
      expect(limited.pixels).toEqual(limitedReference.pixels);
      expect(limited.converged).toBe(limitedReference.converged);
      expect(limited.residual).toBeCloseTo(limitedReference.residual, 8);
    });
  }
