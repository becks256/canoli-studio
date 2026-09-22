import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  applyBlendIf,
  applyTone,
  instantiateKernel,
  renderSelection,
} from "../src/engine/wasm";
import type { PixelKernel } from "../src/engine/wasm";
import { ToneAdjustment, MarqueeSelection } from "../src/dom";
let kernel: PixelKernel;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
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
