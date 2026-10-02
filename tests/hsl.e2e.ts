import { test, expect } from "@playwright/test";

test("HSL controls, masks, isolated scripts and PNG/project persistence agree", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, RasterLayer, AdjustmentLayer } = window.luma;
    editor.newDocument({ width: 16, height: 8 });
    const canvas = new OffscreenCanvas(16, 8),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 8);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob({ type: "image/png" }),
      "red",
      undefined,
      false,
    );
    editor.document.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 8 }),
    );
    editor.document.selectedLayer = editor.document.layers.add(
      new AdjustmentLayer(),
    );
  });
  await page.getByLabel("Adjustment type", { exact: true }).selectOption("hsl");
  const hue = page.getByRole("spinbutton", { name: "Hue value", exact: true });
  await hue.fill("120");
  await hue.press("Enter");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const sample = async () => {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const ctx = canvas.getContext("2d")!;
      const pixels = [2, 12].map((x) => [...ctx.getImageData(x, 2, 1, 1).data]);
      canvas.width = canvas.height = 0;
      return pixels;
    };
    const green = await sample();
    editor.document.undo();
    const red = await sample();
    editor.document.redo();
    await editor.runScript(
      'document.selectedLayer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 8, height: 8 }) });',
    );
    const masked = await sample();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "hsl.luma"));
    const reopened = await sample();
    const { exportPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const bitmap = await createImageBitmap(
      await exportPng(
        editor.document.toJSON(),
        editor.assetStore,
        editor.renderer,
      ),
    );
    const canvas = new OffscreenCanvas(16, 8),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const exported = [2, 12].map((x) => [...ctx.getImageData(x, 2, 1, 1).data]);
    return { green, red, masked, reopened, exported };
  });
  expect(result.green).toEqual([
    [0, 255, 0, 255],
    [0, 255, 0, 255],
  ]);
  expect(result.red).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.masked).toEqual([
    [0, 255, 0, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.reopened).toEqual(result.masked);
  expect(result.exported).toEqual(result.masked);
});

test("HSL worker agrees with reference pixels and snapshots caller inputs", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const { adjustHsl } = await import(
      /* @vite-ignore */ String("/src/engine/hsl.ts")
    );
    const processor = new PixelProcessor();
    try {
      const input = new Uint8ClampedArray(4096 * 4);
      for (let i = 0; i < input.length; i++)
        input[i] = (i * 31 + Math.floor(i / 7)) % 256;
      const before = input.slice(),
        settings = { kind: "hsl", hue: -137, saturation: 41, lightness: -23 };
      const expected = adjustHsl(before, settings);
      const pending = processor.hsl(input, settings);
      input.fill(0);
      settings.hue = 0;
      const actual = await pending;
      const equal = actual.every(
        (value: number, index: number) => value === expected[index],
      );
      const retained = input.byteLength === before.byteLength;
      let malformed = false;
      try {
        await processor.hsl(new Uint8ClampedArray(3), settings);
      } catch {
        malformed = true;
      }
      return { equal, retained, malformed };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toEqual({ equal: true, retained: true, malformed: true });
});

test("palette and context menu create named HSL layers with one-step undo", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 100, height: 100 }),
  );
  await page.getByRole("button", { name: "Find a command (Mod+K)" }).click();
  await page.getByRole("combobox", { name: "Search commands" }).fill("HSL");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Adjustment type", { exact: true })).toHaveValue(
    "hsl",
  );
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.name),
  ).toBe("HSL 1");
  await page
    .locator(".viewport")
    .click({ button: "right", position: { x: 50, y: 50 } });
  await page
    .locator(".canvas-context-menu")
    .getByRole("button", { name: "HSL", exact: true })
    .click();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.name),
  ).toBe("HSL 2");
  const result = await page.evaluate(() => {
    const doc = window.luma.editor.document;
    const count = doc.layers.length;
    doc.undo();
    const undone = doc.layers.length;
    doc.redo();
    return { count, undone, redone: doc.layers.length };
  });
  expect(result).toEqual({ count: 2, undone: 1, redone: 2 });
});

test("HSL recipe renders persistent batch deliverables with actual recolored pixels", async ({
  page,
}) => {
  await page.goto("/");
  const id = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(16, 16),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const batch = window.luma.editor.batch;
    const run = await batch.createBatch(
      {
        name: "HSL batch",
        budgetId: "default-budget",
        recipeId: "preset-hsl-recolor",
        recipeParams: { hue: 120 },
        variants: [
          {
            id: "native",
            name: "Native",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "contain",
          },
        ],
      },
      [
        {
          id: "red",
          name: "red.png",
          width: 16,
          height: 16,
          mimeType: "image/png",
          byteLength: blob.size,
          blob,
        },
      ],
    );
    await batch.start(run.id);
    await batch.waitForRun(run.id);
    return run.id;
  });
  await page.reload();
  const result = await page.evaluate(async (id) => {
    const batch = window.luma.editor.batch,
      run = (await batch.getRun(id))!;
    const output = run.deliveryManifest!.deliverables[0];
    const bitmap = await createImageBitmap(
      (await batch.getDeliverableBlob(output.deliverableId))!,
    );
    const canvas = new OffscreenCanvas(16, 16),
      ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      pixel: [...ctx.getImageData(2, 2, 1, 1).data],
      count: run.deliveryManifest!.deliverables.length,
    };
  }, id);
  expect(result).toEqual({ pixel: [0, 255, 0, 255], count: 1 });
});
