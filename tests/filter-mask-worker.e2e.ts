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

test("owned filter mixing transfers private inputs and matches caller-safe mixing exactly", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String("/src/engine/processor.ts"));
    const processor = new PixelProcessor();
    try {
      const original = Uint8ClampedArray.from({ length: 4096 }, (_, i) => (i * 17) % 256);
      const filtered = Uint8ClampedArray.from({ length: 4096 }, (_, i) => (i * 43) % 256);
      const mask = Uint8ClampedArray.from({ length: 4096 }, (_, i) => (i * 13) % 256);
      const expected = await processor.mixFiltered(original, filtered, mask, 0.63, true);
      const actual = await processor.mixFilteredOwned(original, filtered, mask, 0.63, true);
      return { exact: expected.every((value: number, index: number) => actual[index] === value), lengths: [original.byteLength, filtered.byteLength, mask.byteLength] };
    } finally { processor.dispose(); }
  });
  expect(result).toEqual({ exact: true, lengths: [0, 0, 0] });
});
