import { expect, test } from "@playwright/test";

test("spatial-filter worker snapshots inputs, handles transparent edges, and recovers after invalid requests", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    try {
      const pixels = new Uint8ClampedArray(13 * 13 * 4);
      for (let p = 0; p < 169; p++) pixels[p * 4 + 2] = 255;
      pixels.set([255, 0, 0, 255], (6 * 13 + 6) * 4);
      const original = pixels.slice(),
        options = { kind: "gaussian-blur", sigmaX: 1 };
      const pending = processor.spatialFilter(pixels, 13, 13, options);
      pixels.fill(0);
      options.sigmaX = 0;
      const blurred: Uint8ClampedArray = await pending;
      let badGeometry = "",
        badSigma = "";
      try {
        await processor.spatialFilter(original, 14, 13, options);
      } catch (error) {
        badGeometry = String(error);
      }
      try {
        await processor.spatialFilter(original, 13, 13, {
          kind: "gaussian-blur",
          sigmaX: -1,
        });
      } catch (error) {
        badSigma = String(error);
      }
      const again: Uint8ClampedArray = await processor.spatialFilter(
        original,
        13,
        13,
        { kind: "gaussian-blur", sigmaX: 1 },
      );
      const sharp: Uint8ClampedArray = await processor.spatialFilter(
        original,
        13,
        13,
        { kind: "unsharp-mask", sigmaX: 1, amount: 2 },
      );
      return {
        center: [...blurred.slice((6 * 13 + 6) * 4, (6 * 13 + 6) * 4 + 4)],
        noFringes: blurred.every(
          (v, i) =>
            i % 4 === 3 ||
            v === (i % 4 === 0 && blurred[i - (i % 4) + 3] ? 255 : 0),
        ),
        stable: again.every((v, i) => v === blurred[i]),
        sharpUnchanged: sharp.every((v, i) => v === original[i]),
        sourceBytes: pixels.byteLength,
        sourceStillZero: pixels.every((v) => v === 0),
        badGeometry,
        badSigma,
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toMatchObject({
    center: [255, 0, 0, 41],
    noFringes: true,
    stable: true,
    sharpUnchanged: true,
    sourceBytes: 676,
    sourceStillZero: true,
  });
  expect(result.badGeometry).toContain("geometry");
  expect(result.badSigma).toContain("sigma");
});

for (const kind of ["gaussian-blur", "unsharp-mask"] as const) {
  test(`${kind} worker renders matching pixels across a tile boundary`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (kind) => {
      const { PixelProcessor } = await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      );
      const processor = new PixelProcessor();
      try {
        const width = 37,
          height = 19;
        const pixels = Uint8ClampedArray.from(
          { length: width * height * 4 },
          (_, i) => (i * 71 + Math.floor(i / 7) * 13) % 256,
        );
        const options = { kind, sigmaX: 1.25, sigmaY: 0.5, amount: 1.5 };
        const whole: Uint8ClampedArray = await processor.spatialFilter(
          pixels,
          width,
          height,
          options,
        );
        const stitched = new Uint8ClampedArray(pixels.length);
        for (const [x, w] of [
          [0, 17],
          [17, 20],
        ]) {
          const tw = w + 8,
            th = height + 4,
            tile = new Uint8ClampedArray(tw * th * 4);
          for (let yy = 0; yy < th; yy++)
            for (let xx = 0; xx < tw; xx++) {
              const sx = x + xx - 4,
                sy = yy - 2;
              if (sx >= 0 && sx < width && sy >= 0 && sy < height)
                tile.set(
                  pixels.subarray(
                    (sy * width + sx) * 4,
                    (sy * width + sx + 1) * 4,
                  ),
                  (yy * tw + xx) * 4,
                );
            }
          const filtered: Uint8ClampedArray = await processor.spatialFilter(
            tile,
            tw,
            th,
            options,
          );
          for (let yy = 0; yy < height; yy++) {
            const start = ((yy + 2) * tw + 4) * 4;
            stitched.set(
              filtered.subarray(start, start + w * 4),
              (yy * width + x) * 4,
            );
          }
        }
        return {
          identical: stitched.every((v, i) => v === whole[i]),
          length: pixels.byteLength,
          changed: whole.some((v, i) => v !== pixels[i]),
        };
      } finally {
        processor.dispose();
      }
    }, kind);
    expect(result).toEqual({ identical: true, length: 2812, changed: true });
  });
}
