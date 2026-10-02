import { expect, it } from "vitest";
import { extractRetouchRegion } from "../src/engine/retouch-sampling";
it("extracts detached row-aligned native pixels at translated coordinates", () => {
  const pixels = Uint8ClampedArray.from({ length: 4 * 3 * 4 }, (_, i) => i);
  const window = { region: { x: -10, y: 100, width: 4, height: 3 }, pixels };
  const output = extractRetouchRegion(window, {
    x: -9,
    y: 101,
    width: 2,
    height: 2,
  })!;
  expect([...output]).toEqual([
    ...pixels.slice(20, 28),
    ...pixels.slice(36, 44),
  ]);
  output.fill(0);
  expect(pixels[20]).toBe(20);
  expect(extractRetouchRegion(window, window.region)).toEqual(pixels);
});
it("requires full coverage and rejects malformed geometry instead of inventing border pixels", () => {
  const window = {
    region: { x: 2, y: 3, width: 2, height: 2 },
    pixels: new Uint8ClampedArray(16),
  };
  for (const [x, y] of [
    [1, 3],
    [3, 3],
    [2, 2],
    [2, 4],
  ])
    expect(
      extractRetouchRegion(window, { x, y, width: 2, height: 2 }),
    ).toBeNull();
  expect(() =>
    extractRetouchRegion(window, { x: 2.5, y: 3, width: 1, height: 1 }),
  ).toThrow("geometry");
  expect(() =>
    extractRetouchRegion(
      { ...window, pixels: new Uint8ClampedArray(4) },
      window.region,
    ),
  ).toThrow("match");
});
