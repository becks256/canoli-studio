import { expect, it } from "vitest";
import { findRetouchDonor } from "../src/core/retouch/donor";

function fixture() {
  const width = 15,
    height = 7;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++)
    pixels.set([100, 100, 100, 255], p * 4);
  const mask = new Uint8Array(width * height);
  mask[3 * width + 3] = 255;
  const set = (x: number, y: number, value: number) =>
    pixels.set([value, value, value, 255], (y * width + x) * 4);
  for (const [dx, dy, value] of [
    [-1, 0, 30],
    [1, 0, 190],
    [0, -1, 70],
    [0, 1, 140],
  ]) {
    set(3 + dx, 3 + dy, value);
    set(10 + dx, 3 + dy, value + 20);
  }
  return { pixels, width, height, mask };
}
it("matches boundary texture despite illumination drift and ignores damaged target colors", () => {
  const { pixels, width, height, mask } = fixture();
  const before = pixels.slice();
  const first = findRetouchDonor(pixels, width, height, mask, { radius: 8 });
  expect(first).toMatchObject({ x: 7, y: 0 });
  expect(first.score).toBeCloseTo(12);
  expect(pixels).toEqual(before);
  pixels.set([255, 0, 255, 255], (3 * width + 3) * 4);
  expect(findRetouchDonor(pixels, width, height, mask, { radius: 8 })).toEqual(
    first,
  );
});
it("rejects donors overlapping damage or containing transparency and resolves ties deterministically", () => {
  const pixels = new Uint8ClampedArray(25 * 4).fill(255),
    mask = new Uint8Array(25);
  mask[12] = 255;
  const result = findRetouchDonor(pixels, 5, 5, mask, { radius: 2 });
  expect(result).toEqual(findRetouchDonor(pixels, 5, 5, mask, { radius: 2 }));
  expect(result.x || result.y).not.toBe(0);
  for (let p = 0; p < 25; p++) if (p !== 12) pixels[p * 4 + 3] = 0;
  expect(() => findRetouchDonor(pixels, 5, 5, mask)).toThrow("visible context");
  mask.fill(255);
  expect(() => findRetouchDonor(pixels, 5, 5, mask)).toThrow("visible context");
});
it("validates input geometry and fails explicitly when there is no intact donor", () => {
  const { pixels, width, height, mask } = fixture();
  expect(() => findRetouchDonor(pixels, width + 1, height, mask)).toThrow(
    "geometry",
  );
  expect(() =>
    findRetouchDonor(pixels, width, height, mask, { radius: Infinity }),
  ).toThrow("radius");
  expect(() =>
    findRetouchDonor(pixels, width, height, new Uint8Array(mask.length)),
  ).toThrow("empty");
  const small = new Uint8ClampedArray(3 * 3 * 4).fill(255),
    hole = new Uint8Array(9);
  hole[4] = 255;
  expect(() => findRetouchDonor(small, 3, 3, hole)).toThrow("No intact donor");
});

it("packed validity matches scalar search across row boundaries, irregular masks and alpha", async () => {
  const { findRetouchDonorReference } =
    await import("../src/core/retouch/donor");
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (const width of [7, 31, 32, 33, 65])
    for (const alpha of [0, 128, 255, -1]) {
      const height = 11,
        pixels = new Uint8ClampedArray(width * height * 4),
        mask = new Uint8Array(width * height);
      for (let p = 0; p < mask.length; p++) {
        const x = p % width,
          y = Math.floor(p / width);
        pixels.set(
          [
            random() % 256,
            random() % 256,
            random() % 256,
            random() % 7 === 0 ? 0 : 255,
          ],
          p * 4,
        );
        if (
          y > 3 &&
          y < 7 &&
          x > width / 2 - 2 &&
          x < width / 2 + 2 &&
          random() % 3 !== 0
        ) {
          mask[p] = 255;
          pixels[p * 4 + 3] = alpha < 0 ? random() % 256 : alpha;
        }
      }
      const run = (search: typeof findRetouchDonor) => {
        try {
          return search(pixels, width, height, mask, { radius: 5 });
        } catch (e) {
          return String(e);
        }
      };
      expect(run(findRetouchDonor)).toEqual(run(findRetouchDonorReference));
    }
});

it("zero-score pruning preserves nearest ties and counts only valid boundary donors", async () => {
  const { findRetouchDonorReference } =
    await import("../src/core/retouch/donor");
  for (const width of [17, 33, 65])
    for (const alpha of [128, 255]) {
      const height = 17,
        pixels = new Uint8ClampedArray(width * height * 4),
        mask = new Uint8Array(width * height);
      for (let p = 0; p < mask.length; p++)
        pixels.set([80, 80, 80, alpha], p * 4);
      const center = Math.floor(width / 2);
      for (let y = 7; y <= 9; y++)
        for (let x = center - 1; x <= center + 1; x++)
          mask[y * width + x] = 255;
      // Transparent and insufficient-alpha pixels can invalidate only a donor's
      // boundary, so skipping boundary validation would overcount candidates.
      pixels[(4 * width + center - 3) * 4 + 3] = 0;
      pixels[(12 * width + center + 3) * 4 + 3] = alpha - 1;
      expect(
        findRetouchDonor(pixels, width, height, mask, { radius: 8 }),
      ).toEqual(
        findRetouchDonorReference(pixels, width, height, mask, { radius: 8 }),
      );
    }
});
