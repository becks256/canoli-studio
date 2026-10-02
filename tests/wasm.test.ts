import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  featherAlpha,
  applyBlendIf,
  applyTone,
  applyLut,
  blendAdjustment,
  instantiateKernel,
  renderSelection,
} from "../src/engine/wasm";
import type { PixelKernel } from "../src/engine/wasm";
import { AffineTransform, ToneAdjustment, MarqueeSelection } from "../src/dom";
let kernel: PixelKernel;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
});
it("inverse-maps rotated selection samples and retains coverage across tiles", () => {
  const selection = new MarqueeSelection({
    shape: "rectangle",
    x: 2,
    y: 3,
    width: 4,
    height: 5,
  }).toJSON();
  // Local X = output Y; local Y = 10 - output X.
  const options = {
    selection,
    x: 0,
    y: 10,
    stepX: 0,
    stepY: 0,
    stepXY: 1,
    stepYX: -1,
  };
  const full = renderSelection(kernel, { ...options, width: 10, height: 10 });
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      expect(full[(y * 10 + x) * 4 + 3]).toBe(
        x >= 2 && x < 7 && y >= 2 && y < 6 ? 255 : 0,
      );
    }
  const tile = renderSelection(kernel, {
    ...options,
    x: 3,
    y: 6,
    width: 6,
    height: 7,
  });
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 6; x++) {
      expect(tile[(y * 6 + x) * 4 + 3]).toBe(
        full[((y + 3) * 10 + x + 4) * 4 + 3],
      );
    }
});
it("renders Boolean selection coverage identically across arbitrary tile boundaries", () => {
  const selection = new MarqueeSelection({
    shape: "ellipse",
    x: 1.5,
    y: 2.5,
    width: 30,
    height: 24,
  })
    .combine(
      new MarqueeSelection({
        shape: "rectangle",
        x: 11,
        y: 0,
        width: 3,
        height: 32,
      }),
      "subtract",
    )
    .combine(
      new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 8,
        width: 40,
        height: 22,
      }),
      "intersect",
    )
    .toJSON();
  const whole = renderSelection(kernel, {
    selection,
    width: 40,
    height: 32,
    x: 0,
    y: 0,
    stepX: 1,
    stepY: 1,
  });
  const tile = renderSelection(kernel, {
    selection,
    width: 19,
    height: 13,
    x: 9,
    y: 7,
    stepX: 1,
    stepY: 1,
  });
  for (let y = 0; y < 13; y++)
    for (let x = 0; x < 19; x++)
      expect(tile[(y * 19 + x) * 4 + 3]).toBe(
        whole[((y + 7) * 40 + x + 9) * 4 + 3],
      );
  expect(whole[(16 * 40 + 12) * 4 + 3]).toBe(0);
  expect(whole[(16 * 40 + 18) * 4 + 3]).toBe(255);
  expect(whole[(6 * 40 + 18) * 4 + 3]).toBe(0);
});
it("executes compiled WASM with correct exposure and unchanged alpha/source", () => {
  const original = new Uint8ClampedArray([40, 60, 80, 128, 140, 20, 0, 255]);
  expect([
    ...applyTone(kernel, original, [
      new ToneAdjustment({ exposure: 1 }).toJSON(),
    ]),
  ]).toEqual([80, 120, 160, 128, 255, 40, 0, 255]);
  expect([...original]).toEqual([40, 60, 80, 128, 140, 20, 0, 255]);
});
it("keeps identity exact and can grow memory for a working tile", () => {
  const pixels = new Uint8ClampedArray(1024 * 1024 * 4).fill(123);
  expect(
    Buffer.compare(
      Buffer.from(applyTone(kernel, pixels, [new ToneAdjustment().toJSON()])),
      Buffer.from(pixels),
    ),
  ).toBe(0);
  const desaturated = applyTone(
    kernel,
    new Uint8ClampedArray([200, 50, 20, 255]),
    [new ToneAdjustment({ saturation: -100 }).toJSON()],
  );
  expect(desaturated[0]).toBe(desaturated[1]);
  expect(desaturated[1]).toBe(desaturated[2]);
  expect(desaturated[3]).toBe(255);
});

it("computes Blend If with exact hard and feathered ranges, channels, and underlying transparency", () => {
  // Test hard cutoff on source luminance: [50, 50, 200, 200]
  const source = new Uint8ClampedArray([
    20,
    20,
    20,
    255, // lum ~20 (< 50) -> excluded (alpha 0)
    100,
    100,
    100,
    255, // lum ~100 (in [50, 200]) -> kept (alpha 255)
    230,
    230,
    230,
    255, // lum ~230 (> 200) -> excluded (alpha 0)
  ]);
  const backdrop = new Uint8ClampedArray([
    128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255,
  ]);

  const resultHard = applyBlendIf(kernel, source, backdrop, {
    enabled: true,
    channel: "luminance",
    source: [50, 50, 200, 200],
    underlying: [0, 0, 255, 255],
  });
  expect(resultHard[3]).toBe(0);
  expect(resultHard[7]).toBe(255);
  expect(resultHard[11]).toBe(0);

  // Test feathered range: [0, 100, 200, 255]
  // Pixel with value 50 gets weight (50-0)/(100-0) = 0.5 -> alpha ~128
  const sourceFeather = new Uint8ClampedArray([50, 50, 50, 255]);
  const backdropFeather = new Uint8ClampedArray([128, 128, 128, 255]);
  const resultFeather = applyBlendIf(kernel, sourceFeather, backdropFeather, {
    enabled: true,
    channel: "luminance",
    source: [0, 100, 200, 255],
    underlying: [0, 0, 255, 255],
  });
  expect(Math.abs(resultFeather[3] - 128)).toBeLessThanOrEqual(1);

  // Test underlying transparency: transparent backdrop does not occlude
  const sourceUnder = new Uint8ClampedArray([150, 150, 150, 255]);
  const transparentBackdrop = new Uint8ClampedArray([10, 10, 10, 0]); // alpha 0
  const resultTransparent = applyBlendIf(
    kernel,
    sourceUnder,
    transparentBackdrop,
    {
      enabled: true,
      channel: "luminance",
      source: [0, 0, 255, 255],
      underlying: [100, 100, 255, 255], // backdrop (10) would be excluded if opaque
    },
  );
  expect(resultTransparent[3]).toBe(255);

  // Test red channel selection
  const sourceRed = new Uint8ClampedArray([
    220,
    10,
    10,
    255, // red = 220 -> kept
    40,
    250,
    250,
    255, // red = 40 -> excluded
  ]);
  const resultRed = applyBlendIf(
    kernel,
    sourceRed,
    new Uint8ClampedArray(8).fill(255),
    {
      enabled: true,
      channel: "red",
      source: [100, 100, 255, 255],
      underlying: [0, 0, 255, 255],
    },
  );
  expect(resultRed[3]).toBe(255);
  expect(resultRed[7]).toBe(0);
});

it("feathers alpha with the expected three-pass impulse response, including fractional radii", () => {
  const pixels = new Uint8ClampedArray(15 * 4);
  pixels[7 * 4 + 3] = 255;
  for (const [radius, coefficients, divisor] of [
    [1, [1, 3, 6, 7, 6, 3, 1], 27],
    [0.5, [1, 6, 15, 20, 15, 6, 1], 64],
  ] as const) {
    const result = featherAlpha(kernel, pixels, {
      width: 15,
      height: 1,
      radiusX: radius,
      radiusY: 0,
    });
    expect(
      Array.from({ length: 7 }, (_, i) => result[(i + 4) * 4 + 3]),
    ).toEqual(coefficients.map((v) => Math.round((v * 255) / divisor)));
    expect(result[3]).toBe(0);
    expect(result[14 * 4 + 3]).toBe(0);
  }
  expect(pixels[7 * 4 + 3]).toBe(255);
});
it("feathering preserves constant interiors and validates working buffers", () => {
  const pixels = new Uint8ClampedArray(51 * 51 * 4).fill(255);
  const result = featherAlpha(kernel, pixels, {
    width: 51,
    height: 51,
    radiusX: 2.7,
    radiusY: 1.2,
  });
  expect(result[(25 * 51 + 25) * 4 + 3]).toBe(255);
  expect(result[3]).toBeGreaterThan(0);
  expect(result[3]).toBeLessThan(255);
  expect(() =>
    featherAlpha(kernel, pixels, {
      width: 50,
      height: 51,
      radiusX: 1,
      radiusY: 1,
    }),
  ).toThrow(/working tile/);
  expect(() =>
    featherAlpha(kernel, pixels, {
      width: 51,
      height: 51,
      radiusX: Infinity,
      radiusY: 1,
    }),
  ).toThrow(/working tile/);
});

it("applies 768-byte lookup tables to RGB channels and preserves alpha", () => {
  const lut = new Uint8Array(768);
  // Red: invert (255 - r)
  for (let i = 0; i < 256; i++) lut[i] = 255 - i;
  // Green: identity
  for (let i = 0; i < 256; i++) lut[256 + i] = i;
  // Blue: zero
  for (let i = 0; i < 256; i++) lut[512 + i] = 0;

  const pixels = new Uint8ClampedArray([100, 150, 200, 128, 0, 255, 128, 255]);

  const result = applyLut(kernel, pixels, lut);

  // Pixel 1:
  // R: 255 - 100 = 155
  // G: 150
  // B: 0
  // A: 128 (preserved!)
  expect(result[0]).toBe(155);
  expect(result[1]).toBe(150);
  expect(result[2]).toBe(0);
  expect(result[3]).toBe(128);

  // Pixel 2:
  // R: 255 - 0 = 255
  // G: 255
  // B: 0
  // A: 255
  expect(result[4]).toBe(255);
  expect(result[5]).toBe(255);
  expect(result[6]).toBe(0);
  expect(result[7]).toBe(255);
});

it("blends adjustment layer into backdrop preserving backdrop alpha strictly", () => {
  // Target backdrop:
  // Pixel 0: semi-transparent gray RGBA(100, 100, 100, 128)
  // Pixel 1: fully transparent RGBA(50, 50, 50, 0)
  // Pixel 2: fully opaque white RGBA(255, 255, 255, 255)
  const target = new Uint8ClampedArray([
    100, 100, 100, 128, 50, 50, 50, 0, 255, 255, 255, 255,
  ]);

  // Adjusted layer (e.g. inverted/tinted)
  const adjusted = new Uint8ClampedArray([
    200, 50, 0, 255, 200, 50, 0, 255, 0, 0, 0, 255,
  ]);

  // 100% opacity, no mask
  const result = blendAdjustment(kernel, target, adjusted, null, 1.0);

  // Pixel 0:
  // tr=100, ar=200 -> 200
  // tg=100, ag=50 -> 50
  // tb=100, ab=0 -> 0
  // Alpha MUST remain 128!
  expect(result[0]).toBe(200);
  expect(result[1]).toBe(50);
  expect(result[2]).toBe(0);
  expect(result[3]).toBe(128);

  // Pixel 1:
  // Target alpha was 0 -> MUST remain 0 and unchanged!
  expect(result[4]).toBe(50);
  expect(result[5]).toBe(50);
  expect(result[6]).toBe(50);
  expect(result[7]).toBe(0);

  // Pixel 2:
  // Alpha remains 255, RGB is 0, 0, 0
  expect(result[8]).toBe(0);
  expect(result[9]).toBe(0);
  expect(result[10]).toBe(0);
  expect(result[11]).toBe(255);

  // Test with mask and 50% opacity:
  const mask = new Uint8ClampedArray([
    0,
    0,
    0,
    128, // 50% mask density
    0,
    0,
    0,
    255,
    0,
    0,
    0,
    0, // 0% mask density (hidden)
  ]);

  const target2 = new Uint8ClampedArray([
    100, 100, 100, 128, 50, 50, 50, 0, 200, 200, 200, 255,
  ]);

  // Opacity 1.0, but Pixel 0 has 50% mask -> weight = 0.5 * (128 / 255) ~ 0.502
  const maskedResult = blendAdjustment(kernel, target2, adjusted, mask, 1.0);

  // Pixel 0 weight is ~0.502: tr=100, ar=200 -> ~150
  expect(maskedResult[0]).toBeGreaterThanOrEqual(149);
  expect(maskedResult[0]).toBeLessThanOrEqual(151);
  expect(maskedResult[3]).toBe(128); // Alpha preserved!

  // Pixel 2 weight is 0 (mask is 0) -> untouched!
  expect(maskedResult[8]).toBe(200);
  expect(maskedResult[9]).toBe(200);
  expect(maskedResult[10]).toBe(200);
  expect(maskedResult[11]).toBe(255);
});

it("rasterizes independently transformed Boolean regions with exact sample and tile coverage", () => {
  const selection = new MarqueeSelection({
    shape: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 20,
  })
    .transformed(new AffineTransform(0, 1, -1, 0, 30, 5))
    .combine(
      new MarqueeSelection({
        shape: "ellipse",
        x: 0,
        y: 0,
        width: 8,
        height: 4,
      }).transformed(new AffineTransform(1, 0.5, 0, 1, 13, 7)),
      "subtract",
    )
    .combine(
      new MarqueeSelection({
        shape: "rectangle",
        x: 12,
        y: 0,
        width: 16,
        height: 20,
      }),
      "intersect",
    );
  const options = {
    selection: selection.toJSON(),
    x: 0,
    y: 0,
    width: 36,
    height: 24,
    stepX: 1,
    stepY: 1,
  };
  const full = renderSelection(kernel, options);
  for (let y = 0; y < 24; y++)
    for (let x = 0; x < 36; x++) {
      let covered = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4,
            py = y + (sy + 0.5) / 4;
          const ex = px - 13,
            ey = py - 7 - 0.5 * ex;
          const hole = ((ex - 4) / 4) ** 2 + ((ey - 2) / 2) ** 2 <= 1;
          if (px >= 12 && px < 28 && py >= 5 && py < 15 && !hole) covered++;
        }
      expect(full[(y * 36 + x) * 4 + 3]).toBe(Math.round((covered * 255) / 16));
    }
  for (const [x, width] of [
    [0, 17],
    [17, 19],
  ]) {
    const tile = renderSelection(kernel, { ...options, x, width });
    for (let y = 0; y < 24; y++)
      expect(tile.slice(y * width * 4, (y + 1) * width * 4)).toEqual(
        full.slice((y * 36 + x) * 4, (y * 36 + x + width) * 4),
      );
  }
  const translated = selection.translated(1e12, -1e12).toJSON();
  expect(
    renderSelection(kernel, {
      ...options,
      selection: translated,
      x: 1e12,
      y: -1e12,
    }),
  ).toEqual(full);
});
