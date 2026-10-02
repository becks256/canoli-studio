import { test, expect } from "@playwright/test";

test("Poisson worker snapshots inputs, returns real blended pixels and survives invalid requests", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    const target = new Uint8ClampedArray(7 * 7 * 4),
      donor = target.slice(),
      coverage = new Uint8Array(49);
    for (let p = 0; p < 49; p++) {
      target.set([100, 100, 100, 177], p * 4);
      donor.set([160, 160, 160, 255], p * 4);
    }
    for (let y = 1; y < 6; y++) coverage.fill(255, y * 7 + 1, y * 7 + 6);
    donor[24 * 4] = 190;
    const options = { mode: "source", tolerance: 0.001 };
    try {
      const pending = processor.poissonBlend(
        target,
        donor,
        7,
        7,
        coverage,
        options,
      );
      target.fill(1);
      donor.fill(2);
      coverage.fill(0);
      options.tolerance = NaN;
      const solved = await pending;
      let error = "";
      try {
        await processor.poissonBlend(target, donor, 8, 7, coverage);
      } catch (e) {
        error = String(e);
      }
      const after = await processor.poissonBlend(target, donor, 7, 7, coverage);
      return {
        converged: solved.converged,
        residual: solved.residual,
        center: [...solved.pixels.slice(24 * 4, 24 * 4 + 4)],
        exterior: [...solved.pixels.slice(0, 4)],
        retained: [target.byteLength, donor.byteLength, coverage.byteLength],
        unchangedCaller:
          target.every((v) => v === 1) && donor.every((v) => v === 2),
        error,
        after: after.converged && after.pixels.every((v: number) => v === 1),
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toMatchObject({
    converged: true,
    center: [130, 100, 100, 177],
    exterior: [100, 100, 100, 177],
    retained: [196, 196, 49],
    unchangedCaller: true,
    after: true,
  });
  expect(result.residual).toBeLessThanOrEqual(0.001);
  expect(result.error).toContain("dimensions");
});
