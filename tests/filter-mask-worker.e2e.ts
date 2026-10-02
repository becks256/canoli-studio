import { expect, test } from "@playwright/test";
test("filter-mask worker snapshots all inputs, mixes alpha and recovers from validation failure", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    try {
      const original = new Uint8ClampedArray([0, 0, 255, 0]);
      const filtered = new Uint8ClampedArray([255, 0, 0, 255]);
      const mask = new Uint8ClampedArray([0, 0, 0, 128]);
      const pending = processor.mixFiltered(original, filtered, mask);
      original.fill(0);
      filtered.fill(0);
      mask.fill(0);
      const pixels = await pending;
      let error = "";
      try {
        await processor.mixFiltered(original, filtered, mask, -1);
      } catch (reason) {
        error = String(reason);
      }
      const recovered = await processor.mixFiltered(
        new Uint8ClampedArray([255, 0, 0, 255]),
        new Uint8ClampedArray([0, 0, 255, 0]),
        new Uint8ClampedArray([0, 0, 0, 128]),
      );
      return {
        pixels: [...pixels],
        recovered: [...recovered],
        error,
        lengths: [original.byteLength, filtered.byteLength, mask.byteLength],
        untouched: [...original, ...filtered, ...mask].every((v) => v === 0),
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toMatchObject({
    pixels: [255, 0, 0, 128],
    recovered: [255, 0, 0, 127],
    lengths: [4, 4, 4],
    untouched: true,
  });
  expect(result.error).toContain("density");
});
