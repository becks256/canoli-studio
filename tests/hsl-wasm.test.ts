import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { instantiateKernel, applyHsl } from "../src/engine/wasm";
import { adjustHsl } from "../src/engine/hsl";

it("actual WASM matches the HSL reference across hue boundaries, extrema, alpha and memory growth", async () => {
  const kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
  const input = new Uint8ClampedArray(256 * 1024);
  let seed = 123456;
  for (let i = 0; i < input.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    input[i] = seed >>> 24;
  }
  input.set([
    0, 0, 0, 0, 255, 255, 255, 255, 128, 128, 128, 64, 255, 0, 0, 128, 0, 255,
    0, 1, 0, 0, 255, 254,
  ]);
  const original = input.slice();
  for (const hue of [-180, -120, -60, -0.1, 0, 60, 120, 180]) {
    for (const [saturation, lightness] of [
      [0, 0],
      [-100, 0],
      [100, 0],
      [41, -23],
      [0, 100],
      [0, -100],
    ]) {
      const settings = { kind: "hsl" as const, hue, saturation, lightness };
      const actual = applyHsl(kernel, input, settings),
        expected = adjustHsl(input, settings);
      const mismatch = actual.findIndex(
        (value, index) => value !== expected[index],
      );
      expect(
        mismatch,
        `HSL ${hue}/${saturation}/${lightness}: byte ${mismatch}`,
      ).toBe(-1);
    }
  }
  expect(input.every((value, index) => value === original[index])).toBe(true);
  expect(() =>
    applyHsl(kernel, new Uint8ClampedArray(3), {
      kind: "hsl",
      hue: 0,
      saturation: 0,
      lightness: 0,
    }),
  ).toThrow(/RGBA/);
});
