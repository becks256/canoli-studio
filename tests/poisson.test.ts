import { describe, expect, it } from "vitest";
import { poissonBlend } from "../src/core/retouch/poisson";

function solid(width: number, height: number, value: number, alpha = 255) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++)
    pixels.set([value, value, value, alpha], p * 4);
  return pixels;
}
function interior(width: number, height: number) {
  const coverage = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++)
    coverage.fill(255, y * width + 1, (y + 1) * width - 1);
  return coverage;
}

describe("Poisson retouch kernel", () => {
  it.each([false, true])(
    "preserves a known texture solution with irregular holes=%s",
    (holes) => {
      const target = solid(9, 9, 100, 177),
        donor = solid(9, 9, 160),
        mask = interior(9, 9);
      if (holes) for (const p of [30, 31, 40, 49, 50, 60]) mask[p] = 0;
      const expected = target.slice();
      for (let y = 2; y < 7; y++)
        for (let x = 2; x < 7; x++) {
          if (!mask[y * 9 + x]) continue;
          const detail = ((x * 7 + y * 3) % 5) * 4;
          for (let c = 0; c < 3; c++) {
            donor[(y * 9 + x) * 4 + c] += detail;
            expected[(y * 9 + x) * 4 + c] += detail;
          }
        }
      const before = [target.slice(), donor.slice(), mask.slice()];
      const result = poissonBlend(target, donor, 9, 9, mask);
      expect(result.converged).toBe(true);
      expect(result.residual).toBeLessThanOrEqual(0.001);
      expect(result.pixels).toEqual(expected);
      expect([target, donor, mask]).toEqual(before);
    },
  );

  it("solves disconnected irregular domains with fixed holes and exact exterior/alpha preservation", () => {
    const target = solid(7, 5, 100),
      donor = solid(7, 5, 180),
      mask = new Uint8Array(35);
    for (const p of [8, 10, 12, 22, 24, 26]) {
      mask[p] = p === 10 ? 128 : 255;
      donor[p * 4] = 200;
      target[p * 4 + 3] = p === 26 ? 0 : 120;
    }
    const result = poissonBlend(target, donor, 7, 5, mask);
    expect(result.converged).toBe(true);
    for (let p = 0; p < mask.length; p++) {
      expect(result.pixels[p * 4 + 3]).toBe(target[p * 4 + 3]);
      if (!mask[p] || !target[p * 4 + 3])
        expect(result.pixels.slice(p * 4, p * 4 + 4)).toEqual(
          target.slice(p * 4, p * 4 + 4),
        );
      else expect(result.pixels[p * 4]).toBe(p === 10 ? 110 : 120);
    }
  });

  it("mixed gradients retain a stronger destination detail; transparent donor RGB is ignored", () => {
    const target = solid(5, 5, 100),
      donor = solid(5, 5, 150),
      mask = interior(5, 5);
    target[12 * 4] = 130;
    expect(poissonBlend(target, donor, 5, 5, mask).pixels[12 * 4]).toBe(100);
    expect(
      poissonBlend(target, donor, 5, 5, mask, { mode: "mixed" }).pixels,
    ).toEqual(target);
    for (let p = 0; p < 25; p++) {
      donor[p * 4] = p % 2 ? 255 : 0;
      donor[p * 4 + 3] = 0;
    }
    expect(poissonBlend(target, donor, 5, 5, mask).pixels).toEqual(target);
  });

  it("reports insufficient convergence rather than claiming a finished solve", () => {
    const target = solid(15, 15, 100),
      donor = solid(15, 15, 100);
    donor[112 * 4] = 170;
    const result = poissonBlend(target, donor, 15, 15, interior(15, 15), {
      maxIterations: 1,
    });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.residual).toBeGreaterThan(0.001);
    expect(
      poissonBlend(target, donor, 15, 15, interior(15, 15)).converged,
    ).toBe(true);
  });

  it("validates padded geometry and numerical options, including empty coverage", () => {
    const pixels = solid(3, 3, 100),
      mask = new Uint8Array(9);
    expect(poissonBlend(pixels, pixels, 3, 3, mask)).toMatchObject({
      converged: true,
      iterations: 0,
      residual: 0,
      pixels,
    });
    expect(() => poissonBlend(pixels, pixels, 4, 3, mask)).toThrow(
      "dimensions",
    );
    expect(() =>
      poissonBlend(pixels, pixels, 3, 3, mask, { tolerance: NaN }),
    ).toThrow("tolerance");
    expect(() =>
      poissonBlend(pixels, pixels, 3, 3, mask, { maxIterations: 0 }),
    ).toThrow("iteration");
    expect(() =>
      poissonBlend(pixels, pixels, 3, 3, mask, { mode: "invalid" as "source" }),
    ).toThrow("mode");
    mask[0] = 1;
    expect(() => poissonBlend(pixels, pixels, 3, 3, mask)).toThrow("boundary");
  });
});
