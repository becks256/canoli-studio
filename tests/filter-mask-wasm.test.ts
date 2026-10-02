import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  instantiateKernel,
  mixFiltered,
  type PixelKernel,
} from "../src/engine/wasm";
let kernel: PixelKernel;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
});
const rgba = (...values: number[]) => new Uint8ClampedArray(values);

it("retains exact original and filtered endpoints, including hidden RGB", () => {
  const original = rgba(20, 40, 60, 0, 255, 0, 0, 255);
  const filtered = rgba(5, 10, 15, 0, 0, 0, 255, 128);
  const mask = rgba(99, 88, 77, 0, 99, 88, 77, 255);
  expect(mixFiltered(kernel, original, filtered, mask)).toEqual(
    rgba(20, 40, 60, 0, 0, 0, 255, 128),
  );
  expect(mixFiltered(kernel, original, filtered, mask, 0)).toEqual(filtered);
  expect(mixFiltered(kernel, original, filtered, mask, 1, true)).toEqual(
    rgba(5, 10, 15, 0, 255, 0, 0, 255),
  );
  expect(original).toEqual(rgba(20, 40, 60, 0, 255, 0, 0, 255));
});

it("interpolates alpha and premultiplied color without transparent color fringes", () => {
  const result = mixFiltered(
    kernel,
    rgba(0, 0, 255, 0, 255, 0, 0, 255),
    rgba(255, 0, 0, 255, 0, 0, 255, 0),
    rgba(0, 0, 0, 128, 0, 0, 0, 128),
  );
  expect(result).toEqual(rgba(255, 0, 0, 128, 255, 0, 0, 127));
  expect(
    mixFiltered(kernel, rgba(9, 8, 7, 0), rgba(6, 5, 4, 1), rgba(0, 0, 0, 1)),
  ).toEqual(rgba(0, 0, 0, 0));
});

it("matches independent weighted RGBA expectations for partial density and inversion", () => {
  const original = Uint8ClampedArray.from(
    { length: 2048 },
    (_, i) => (i * 47) % 256,
  );
  const filtered = Uint8ClampedArray.from(
    { length: 2048 },
    (_, i) => (i * 13 + 71) % 256,
  );
  const mask = Uint8ClampedArray.from(
    { length: 2048 },
    (_, i) => (i * 37 + 9) % 256,
  );
  const saved = [original.slice(), filtered.slice(), mask.slice()];
  for (const inverted of [true, false])
    for (const density of [0.2, 0.7, 1]) {
      const output = mixFiltered(
        kernel,
        original,
        filtered,
        mask,
        density,
        inverted,
      );
      for (let p = 0; p < original.length; p += 4) {
        const hidden =
          (density * (inverted ? mask[p + 3] : 255 - mask[p + 3])) / 255;
        const weights = [
          hidden * original[p + 3],
          (1 - hidden) * filtered[p + 3],
        ];
        const alpha = weights[0] + weights[1];
        expect(output[p + 3]).toBe(Math.round(alpha));
        for (let c = 0; c < 3; c++) {
          const expected = Math.round(alpha)
            ? Math.round(
                (original[p + c] * weights[0] + filtered[p + c] * weights[1]) /
                  alpha,
              )
            : 0;
          expect(Math.abs(output[p + c] - expected)).toBeLessThanOrEqual(1);
        }
      }
    }
  expect([original, filtered, mask]).toEqual(saved);
});

it("is identical across tile splits and rejects malformed inputs before processing", () => {
  const original = Uint8ClampedArray.from({ length: 400 }, (_, i) => i % 256);
  const filtered = original.map((v) => 255 - v),
    mask = original.slice();
  const whole = mixFiltered(kernel, original, filtered, mask, 0.7, true);
  const stitched = new Uint8ClampedArray(400);
  for (const [start, end] of [
    [0, 148],
    [148, 400],
  ])
    stitched.set(
      mixFiltered(
        kernel,
        original.slice(start, end),
        filtered.slice(start, end),
        mask.slice(start, end),
        0.7,
        true,
      ),
      start,
    );
  expect(stitched).toEqual(whole);
  for (const density of [NaN, Infinity, -1, 1.1])
    expect(() =>
      mixFiltered(kernel, original, filtered, mask, density),
    ).toThrow("density");
  expect(() => mixFiltered(kernel, original, filtered.slice(4), mask)).toThrow(
    "RGBA",
  );
  expect(() => mixFiltered(kernel, rgba(1), rgba(1), rgba(1))).toThrow("RGBA");
  expect(mixFiltered(kernel, rgba(), rgba(), rgba())).toHaveLength(0);
});

it("preserves identical visible pixels and canonicalizes transparent mixtures at every coverage byte", () => {
  const original = new Uint8ClampedArray(256 * 256 * 4),
    mask = new Uint8ClampedArray(original.length);
  for (let alpha = 0; alpha < 256; alpha++)
    for (let coverage = 0; coverage < 256; coverage++) {
      const i = (alpha * 256 + coverage) * 4;
      original.set([73, 129, 231, alpha], i);
      mask[i + 3] = coverage;
    }
  for (const density of [0, 0.2, 1])
    for (const inverted of [false, true]) {
      const output = mixFiltered(
        kernel,
        original,
        original,
        mask,
        density,
        inverted,
      );
      for (let alpha = 0; alpha < 256; alpha++)
        for (let coverage = 0; coverage < 256; coverage++) {
          const i = (alpha * 256 + coverage) * 4;
          const weight =
            1 -
            density +
            density * (inverted ? 1 - coverage / 255 : coverage / 255);
          const visible = alpha > 0 || weight <= 0 || weight >= 1;
          if (
            output[i] !== (visible ? 73 : 0) ||
            output[i + 1] !== (visible ? 129 : 0) ||
            output[i + 2] !== (visible ? 231 : 0) ||
            output[i + 3] !== alpha
          )
            throw new Error(
              `Pixel mismatch at alpha=${alpha}, coverage=${coverage}, density=${density}, inverted=${inverted}`,
            );
        }
    }
});
