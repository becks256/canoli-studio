import { readFile } from "node:fs/promises";
import { instantiateKernel, wasmPoissonSolver } from "../src/engine/wasm";
import { cpus } from "node:os";
import { poissonBlend } from "../src/core/retouch/poisson";

// Reproducible numerical baseline; this is not a browser end-to-end timing.
const useWasm = process.argv.includes("--wasm");
const solver = useWasm
  ? wasmPoissonSolver(
      await instantiateKernel(
        new Uint8Array(await readFile("public/wasm/pixels.wasm")),
      ),
    )
  : undefined;
const results = [];
for (const size of [64, 128, 256]) {
  const target = new Uint8ClampedArray(size * size * 4),
    donor = target.slice();
  const mask = new Uint8Array(size * size),
    expected = target.slice();
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const p = y * size + x,
        inside = x > 0 && y > 0 && x < size - 1 && y < size - 1;
      const detail = inside ? (x * 7 + y * 3) % 21 : 0;
      target.set([100, 100, 100, 255], p * 4);
      donor.set([160 + detail, 160 + detail, 160 + detail, 255], p * 4);
      expected.set([100 + detail, 100 + detail, 100 + detail, 255], p * 4);
      mask[p] = inside ? 255 : 0;
    }
  poissonBlend(target, donor, size, size, mask, {}, solver); // Warm-up outside timing.
  const samples = [];
  let iterations = 0,
    residual = 0;
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const result = poissonBlend(target, donor, size, size, mask, {}, solver);
    samples.push(performance.now() - start);
    if (
      !result.converged ||
      !result.pixels.every((value, index) => value === expected[index])
    ) {
      throw new Error(
        `Incorrect Poisson output at ${size}px; benchmark rejected.`,
      );
    }
    iterations = result.iterations;
    residual = result.residual;
  }
  const medianMs = [...samples].sort((a, b) => a - b)[2];
  results.push({
    size,
    samplesMs: samples,
    medianMs,
    iterations,
    residual,
    meets50ms: medianMs <= 50,
  });
}
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      backend: useWasm ? "wasm-ic0" : "typescript-ic0",
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      fixture:
        "Padded RGB texture with known illumination-offset solution; source guidance; tolerance 0.001; 500 iterations maximum",
      results,
    },
    null,
    2,
  ),
);
