import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import {
  findRetouchDonor,
  findRetouchDonorReference,
  type DonorValidity,
} from "../src/core/retouch/donor";
import { instantiateKernel, wasmDonorValidity } from "../src/engine/wasm";
let validity: DonorValidity;
beforeAll(async () => {
  validity = wasmDonorValidity(
    await instantiateKernel(
      new Uint8Array(await readFile("public/wasm/pixels.wasm")),
    ),
  );
});
for (const width of [7, 31, 32, 33, 65]) {
  it(`WASM donor validity preserves results and errors at ${width}px row boundaries`, () => {
    let state = width;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (const alpha of [0, 128, 255])
      for (const textured of [false, true]) {
        const height = 13,
          pixels = new Uint8ClampedArray(width * height * 4),
          coverage = new Uint8Array(width * height);
        for (let p = 0; p < coverage.length; p++) {
          const value = textured ? random() % 256 : 100;
          pixels.set(
            [value, value, value, random() % 11 === 0 ? 0 : 255],
            p * 4,
          );
          const x = p % width,
            y = Math.floor(p / width);
          if (
            x >= Math.floor(width / 2) - 1 &&
            x <= Math.floor(width / 2) + 1 &&
            y >= 5 &&
            y <= 7 &&
            random() % 4 !== 0
          ) {
            coverage[p] = 255;
            pixels[p * 4 + 3] = alpha;
          }
        }
        const input = pixels.slice(),
          mask = coverage.slice();
        const run = (wasm: boolean) => {
          try {
            return wasm
              ? findRetouchDonor(
                  pixels,
                  width,
                  height,
                  coverage,
                  { radius: 6 },
                  validity,
                )
              : findRetouchDonorReference(pixels, width, height, coverage, {
                  radius: 6,
                });
          } catch (error) {
            return String(error);
          }
        };
        expect(run(true)).toEqual(run(false));
        expect(pixels).toEqual(input);
        expect(coverage).toEqual(mask);
      }
  });
}
it("rejects invalid ABI geometry and support rows before accessing WASM memory", () => {
  const input = {
    blocked: new Uint32Array(4),
    support: [{ row: 1, column: 0, bits: 1 }],
    stride: 1,
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
  };
  expect(() => validity({ ...input, stride: 0 })).toThrow("geometry");
  expect(() =>
    validity({ ...input, support: [{ row: 4, column: 0, bits: 1 }] }),
  ).toThrow("coordinates");
  expect(() => validity({ ...input, maxX: Infinity })).toThrow("geometry");
});
