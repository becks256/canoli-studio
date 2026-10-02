import type { PixelProcessor } from "../src/engine/processor";
import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  applySpatialFilter,
  instantiateKernel,
  type PixelKernel,
} from "../src/engine/wasm";
import {
  spatialFilterSupport,
  type SpatialFilterOptions,
} from "../src/core/smart/spatial-filter";
let kernel: PixelKernel;
beforeAll(async () => {
  kernel = await instantiateKernel(
    new Uint8Array(await readFile("public/wasm/pixels.wasm")),
  );
});

// Independent direct 2D convolution oracle, deliberately not the separable WASM algorithm.
function reference(
  input: Uint8ClampedArray,
  width: number,
  height: number,
  options: SpatialFilterOptions,
) {
  const sx = options.sigmaX,
    sy = options.sigmaY ?? sx;
  const rx = Math.ceil(3 * sx),
    ry = Math.ceil(3 * sy);
  const weights: { dx: number; dy: number; weight: number }[] = [];
  for (let dy = -ry; dy <= ry; dy++)
    for (let dx = -rx; dx <= rx; dx++)
      weights.push({
        dx,
        dy,
        weight: Math.exp(
          -0.5 * ((sx ? dx / sx : 0) ** 2 + (sy ? dy / sy : 0) ** 2),
        ),
      });
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  const output = input.slice();
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const channels = [0, 0, 0],
        p = (y * width + x) * 4;
      let alpha = 0;
      for (const { dx, dy, weight } of weights) {
        const xx = x + dx,
          yy = y + dy;
        if (xx < 0 || xx >= width || yy < 0 || yy >= height) continue;
        const q = (yy * width + xx) * 4,
          coverage = ((input[q + 3] / 255) * weight) / total;
        alpha += coverage;
        channels.forEach((_, c) => {
          channels[c] += input[q + c] * coverage;
        });
      }
      if (options.kind === "gaussian-blur") {
        output[p + 3] = byte(alpha * 255);
        channels.forEach((value, c) => {
          output[p + c] = output[p + 3] ? byte(value / alpha) : 0;
        });
      } else if (input[p + 3] && alpha > 0) {
        channels.forEach((value, c) => {
          const delta = input[p + c] - value / alpha;
          if (Math.abs(delta) >= (options.threshold ?? 0))
            output[p + c] = byte(input[p + c] + options.amount * delta);
        });
      }
    }
  return output;
}
function fixture(width: number, height: number) {
  return Uint8ClampedArray.from(
    { length: width * height * 4 },
    (_, i) => (i * 71 + Math.floor(i / 7) * 13) % 256,
  );
}
for (const options of [
  { kind: "gaussian-blur", sigmaX: 1.2, sigmaY: 0.7 },
  { kind: "gaussian-blur", sigmaX: 0, sigmaY: 1.5 },
  {
    kind: "unsharp-mask",
    sigmaX: 1.3,
    sigmaY: 0.6,
    amount: 1.7,
    threshold: 12,
  },
] satisfies SpatialFilterOptions[]) {
  it(`matches direct convolution for ${JSON.stringify(options)} without changing source bytes`, () => {
    const input = fixture(13, 9),
      saved = input.slice();
    const output = applySpatialFilter(kernel, input, 13, 9, options);
    const expected = reference(input, 13, 9, options);
    expect(
      Math.max(...output.map((v, i) => Math.abs(v - expected[i]))),
    ).toBeLessThanOrEqual(1);
    expect(input).toEqual(saved);
    expect(output.buffer).not.toBe(input.buffer);
    if (options.kind === "unsharp-mask")
      for (let i = 3; i < input.length; i += 4)
        expect(output[i]).toBe(input[i]);
  });
}
it("blurs coverage without bleeding hidden transparent RGB into visible color", () => {
  const input = new Uint8ClampedArray(13 * 13 * 4);
  for (let p = 0; p < 169; p++) input[p * 4 + 2] = 255;
  input.set([255, 0, 0, 255], (6 * 13 + 6) * 4);
  const output = applySpatialFilter(kernel, input, 13, 13, {
    kind: "gaussian-blur",
    sigmaX: 1,
  });
  expect(output[(6 * 13 + 6) * 4 + 3]).toBe(41);
  for (let p = 0; p < 169; p++) {
    expect([...output.slice(p * 4, p * 4 + 3)]).toEqual(
      output[p * 4 + 3] ? [255, 0, 0] : [0, 0, 0],
    );
  }
  expect(output[3]).toBe(0);
});
it("unsharp increases edge contrast, preserves coverage and has exact no-op settings", () => {
  const input = new Uint8ClampedArray(15 * 3 * 4);
  for (let p = 0; p < 45; p++)
    input.set([p % 15 < 7 ? 80 : 160, 100, 120, 128], p * 4);
  const output = applySpatialFilter(kernel, input, 15, 3, {
    kind: "unsharp-mask",
    sigmaX: 1,
    amount: 1,
  });
  expect(output[(15 + 6) * 4]).toBeLessThan(80);
  expect(output[(15 + 7) * 4]).toBeGreaterThan(160);
  for (let p = 0; p < 45; p++) expect(output[p * 4 + 3]).toBe(128);
  for (const options of [
    { kind: "gaussian-blur", sigmaX: 0 },
    { kind: "unsharp-mask", sigmaX: 2, amount: 0 },
    { kind: "unsharp-mask", sigmaX: 2, amount: 2, threshold: 255 },
  ] satisfies SpatialFilterOptions[])
    expect(applySpatialFilter(kernel, input, 15, 3, options)).toEqual(input);
});
for (const kind of ["gaussian-blur", "unsharp-mask"] as const) {
  it(`${kind} produces identical whole-image and halo-tiled results`, () => {
    const width = 47,
      height = 33,
      input = fixture(width, height),
      saved = input.slice();
    const options: SpatialFilterOptions = {
      kind,
      sigmaX: 2.25,
      sigmaY: 0.75,
      amount: 1.5,
    };
    const support = spatialFilterSupport(options);
    const whole = applySpatialFilter(kernel, input, width, height, options),
      stitched = input.slice();
    for (let y = 0; y < height; y += 11)
      for (let x = 0; x < width; x += 13) {
        const w = Math.min(13, width - x),
          h = Math.min(11, height - y);
        const tw = w + 2 * support.x,
          th = h + 2 * support.y,
          tile = new Uint8ClampedArray(tw * th * 4);
        for (let yy = 0; yy < th; yy++)
          for (let xx = 0; xx < tw; xx++) {
            const sx = x + xx - support.x,
              sy = y + yy - support.y;
            if (sx >= 0 && sx < width && sy >= 0 && sy < height)
              tile.set(
                input.subarray(
                  (sy * width + sx) * 4,
                  (sy * width + sx + 1) * 4,
                ),
                (yy * tw + xx) * 4,
              );
          }
        const filtered = applySpatialFilter(kernel, tile, tw, th, options);
        for (let yy = 0; yy < h; yy++) {
          const start = ((yy + support.y) * tw + support.x) * 4;
          stitched.set(
            filtered.subarray(start, start + w * 4),
            ((y + yy) * width + x) * 4,
          );
        }
      }
    expect(stitched).toEqual(whole);
    expect(input).toEqual(saved);
  });
}
it("rejects invalid geometry and filter parameters while retaining usable kernel memory", () => {
  const input = fixture(3, 3),
    saved = input.slice();
  expect(() =>
    applySpatialFilter(kernel, input, 4, 3, {
      kind: "gaussian-blur",
      sigmaX: 1,
    }),
  ).toThrow(/geometry/);
  for (const options of [
    { kind: "gaussian-blur", sigmaX: NaN },
    { kind: "gaussian-blur", sigmaX: -1 },
    { kind: "gaussian-blur", sigmaX: 2000 },
    { kind: "unsharp-mask", sigmaX: 1, amount: Infinity },
    { kind: "unsharp-mask", sigmaX: 1, amount: 1, threshold: -1 },
  ] satisfies SpatialFilterOptions[])
    expect(() => applySpatialFilter(kernel, input, 3, 3, options)).toThrow();
  expect(input).toEqual(saved);
  expect(
    applySpatialFilter(kernel, input, 3, 3, {
      kind: "gaussian-blur",
      sigmaX: 0,
    }),
  ).toEqual(saved);
});

it("rejects oversized cumulative filter work before any canvas allocation", async () => {
  const { filteredMasterTile } = await import("../src/engine/smart-filters");
  let renders = 0;
  const render = async () => {
    renders++;
    throw new Error("Unexpected canvas allocation");
  };
  await expect(
    filteredMasterTile(
      render,
      {} as PixelProcessor,
      { x: 0, y: 0, width: 16, height: 16 },
      [{ id: "wide", kind: "gaussian-blur", enabled: true, sigma: 1000 }],
      50_000,
      1000,
    ),
  ).rejects.toThrow(/working-tile budget/);
  await expect(
    filteredMasterTile(
      render,
      {} as PixelProcessor,
      { x: 0, y: 0, width: Infinity, height: 16 },
      [],
      50_000,
      1000,
    ),
  ).rejects.toThrow(/working-tile budget/);
  expect(renders).toBe(0);
});
