import { expect, test } from "@playwright/test";

test("worker donor search snapshots caller buffers and stays usable after rejected input", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const { findRetouchDonor } = await import(
      /* @vite-ignore */ String("/src/core/retouch/donor.ts")
    );
    const processor = new PixelProcessor();
    try {
      const pixels = new Uint8ClampedArray(7 * 7 * 4).fill(255),
        mask = new Uint8Array(49);
      mask[24] = 255;
      const options = { radius: 2 },
        expected = findRetouchDonor(pixels, 7, 7, mask, options);
      const pending = processor.findDonor(pixels, 7, 7, mask, options);
      pixels.fill(0);
      mask.fill(0);
      options.radius = 0;
      const actual = await pending;
      let invalid = "";
      try {
        await processor.findDonor(pixels, 8, 7, mask);
      } catch (error) {
        invalid = String(error);
      }
      pixels.fill(255);
      mask[24] = 255;
      const next = await processor.findDonor(pixels, 7, 7, mask, { radius: 2 });
      return {
        actual,
        expected,
        next,
        invalid,
        bytes: pixels.byteLength,
        maskBytes: mask.byteLength,
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result.actual).toEqual(result.expected);
  expect(result.next).toEqual(result.expected);
  expect(result.invalid).toContain("geometry");
  expect(result.bytes).toBe(196);
  expect(result.maskBytes).toBe(49);
});

test("native donor proposal uses visible boundary context without document or asset mutations", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const { suggestRetouchDonor } = await import(
      /* @vite-ignore */ String("/src/engine/donor-search.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 15, height: 7 });
    const canvas = new OffscreenCanvas(15, 7),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#646464";
    c.fillRect(0, 0, 15, 7);
    for (const [dx, dy, value] of [
      [-1, 0, 30],
      [1, 0, 190],
      [0, -1, 70],
      [0, 1, 140],
    ]) {
      c.fillStyle = `rgb(${value},${value},${value})`;
      c.fillRect(3 + dx, 3 + dy, 1, 1);
      c.fillStyle = `rgb(${value + 20},${value + 20},${value + 20})`;
      c.fillRect(10 + dx, 3 + dy, 1, 1);
    }
    await editor.importImage(
      new File([await canvas.convertToBlob()], "context.png", {
        type: "image/png",
      }),
    );
    const selection = new window.luma.MarqueeSelection({
      shape: "rectangle",
      x: 3,
      y: 3,
      width: 1,
      height: 1,
    }).toJSON();
    const before = JSON.stringify(editor.document.toJSON()),
      history = editor.document.getSnapshot().past.length;
    const processor = new PixelProcessor();
    try {
      const proposal = await suggestRetouchDonor(
        editor.document.toJSON(),
        editor.assetStore,
        editor.renderer,
        processor,
        selection,
        { mode: "all-layers" },
        { radius: 8 },
      );
      const controller = new AbortController();
      controller.abort();
      let cancelled = false;
      try {
        await suggestRetouchDonor(
          editor.document.toJSON(),
          editor.assetStore,
          editor.renderer,
          processor,
          selection,
          { mode: "all-layers" },
          { radius: 8 },
          controller.signal,
        );
      } catch {
        cancelled = true;
      }
      return {
        proposal,
        cancelled,
        unchanged: before === JSON.stringify(editor.document.toJSON()),
        historyUnchanged: history === editor.document.getSnapshot().past.length,
        assets: editor.assetStore.values().length,
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result.proposal).toMatchObject({ x: 7, y: 0 });
  expect(result).toMatchObject({
    cancelled: true,
    unchanged: true,
    historyUnchanged: true,
    assets: 1,
  });
});
