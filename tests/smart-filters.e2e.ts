import { expect, test } from "@playwright/test";

test("scripted smart filters preserve master sharing, editable stacks, undo and project pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 144, height: 64 });
    const image = new OffscreenCanvas(48, 48),
      c = image.getContext("2d")!;
    c.fillStyle = "#ff0000";
    c.fillRect(16, 16, 16, 16);
    const blob = await image.convertToBlob(),
      asset = await editor.assetStore.add(blob, "Source", undefined, false);
    await editor.runScript(`
      const master = new Document({ width: 48, height: 48 });
      master.layers.add(new RasterLayer({ assetId: ${JSON.stringify(asset.id)}, width: 48, height: 48 }));
      const key = document.defineComponent(master);
      document.placeSmartObject(key, { name: 'Filtered', x: 8, y: 8 });
      document.placeSmartObject(key, { name: 'Original', x: 80, y: 8 });
    `);
    async function pixels(cache = true) {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache, readback: true },
      );
      const bytes = canvas.getContext("2d")!.getImageData(0, 0, 144, 64).data;
      canvas.width = canvas.height = 0;
      return [...bytes];
    }
    const before = await pixels(),
      source = JSON.stringify(editor.document.toJSON().components);
    const history = editor.document.getSnapshot().past.length;
    await editor.runScript(`document.layers.at(0).setFilters([
      new GaussianBlurFilter({ sigma: 2 }), new UnsharpMaskFilter({ sigma: 1, amount: 0.2 }), new SmartToneFilter({ saturation: -100 })
    ]);`);
    const after = await pixels(),
      uncached = await pixels(false);
    const at = (bytes: number[], x: number, y: number) =>
      bytes.slice((y * 144 + x) * 4, (y * 144 + x) * 4 + 4);
    const masterUnchanged =
      source === JSON.stringify(editor.document.toJSON().components);
    const oneUndo = editor.document.getSnapshot().past.length === history + 1;
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "filters.luma"));
    const reopened = await pixels();
    const instance = editor.document.layers.at(0) as InstanceType<
      typeof window.luma.SmartObjectLayer
    >;
    const savedFilters = instance.smartFilters;
    const { GaussianBlurFilter, UnsharpMaskFilter, SmartToneFilter } =
      window.luma;
    instance.setFilters([
      new GaussianBlurFilter({ sigma: 2, enabled: false }),
      new UnsharpMaskFilter({ enabled: false }),
      new SmartToneFilter({ enabled: false }),
    ]);
    const disabled = await pixels();
    return {
      changed: after.some((v, i) => v !== before[i]),
      cachedEqual: after.every((v, i) => v === uncached[i]),
      undoEqual: before.every((v, i) => v === undone[i]),
      reopenedEqual: after.every((v, i) => v === reopened[i]),
      disabledEqual: before.every((v, i) => v === disabled[i]),
      kinds: savedFilters.map((filter) => filter.kind),
      original: at(after, 104, 32),
      filtered: at(after, 32, 32),
      blurOutside: at(after, 23, 32)[3],
      masterUnchanged,
      oneUndo,
      sourceEqual:
        new Uint8Array(
          await editor.assetStore.get(asset.id).blob.arrayBuffer(),
        ).join() === new Uint8Array(await blob.arrayBuffer()).join(),
    };
  });
  expect(result).toMatchObject({
    changed: true,
    cachedEqual: true,
    undoEqual: true,
    reopenedEqual: true,
    disabledEqual: true,
    masterUnchanged: true,
    oneUndo: true,
    sourceEqual: true,
    kinds: ["gaussian-blur", "unsharp-mask", "tone"],
    original: [255, 0, 0, 255],
  });
  expect(result.filtered[0]).toBe(result.filtered[1]);
  expect(result.filtered[1]).toBe(result.filtered[2]);
  expect(result.blurOutside).toBeGreaterThan(0);
});

test("master-space filtering follows affine placement and agrees with tiled PNG export", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const {
      Document,
      RasterLayer,
      GaussianBlurFilter,
      AffineTransform,
      LayerGroup,
    } = window.luma;
    editor.newDocument({ width: 380, height: 220 });
    const input = new OffscreenCanvas(96, 64),
      c = input.getContext("2d")!;
    c.fillStyle = "#fa2814";
    c.fillRect(0, 0, 48, 64);
    c.fillStyle = "#1450dc";
    c.fillRect(48, 0, 48, 64);
    const asset = await editor.assetStore.add(
      await input.convertToBlob(),
      "Original",
      undefined,
      false,
    );
    const master = new Document({ width: 96, height: 64 });
    master.layers.add(
      new RasterLayer({ assetId: asset.id, width: 96, height: 64 }),
    );
    const key = editor.document.defineComponent(master);
    const instance = editor.document.placeSmartObject(key, {
      width: 192,
      height: 128,
      x: 85,
      y: 35,
    });
    instance.transform = new AffineTransform(1, 0.2, 0.15, 1, 85, 35);
    instance.addFilter(new GaussianBlurFilter({ sigma: 2 }));
    const render = async (doc = editor.document.toJSON()) => {
      const canvas = await editor.renderer.render(doc, editor.assetStore, {
        cache: false,
        readback: true,
      });
      const pixels = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 380, 220).data,
      ];
      canvas.width = canvas.height = 0;
      return pixels;
    };
    const actual = await render();
    // Independently prefilter a native master with halo plus a transparent sampling border,
    // preventing Canvas edge clamping at the last nonzero blur pixel during affine resampling.
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const processor = new PixelProcessor();
    const padded = new OffscreenCanvas(112, 80),
      p = padded.getContext("2d")!;
    p.drawImage(input, 8, 8);
    try {
      const filtered = await processor.spatialFilter(
        p.getImageData(0, 0, 112, 80).data,
        112,
        80,
        { kind: "gaussian-blur", sigmaX: 2 },
      );
      const image = p.createImageData(112, 80);
      image.data.set(filtered);
      p.putImageData(image, 0, 0);
    } finally {
      processor.dispose();
    }
    const baked = await editor.assetStore.add(
      await padded.convertToBlob(),
      "Reference",
      undefined,
      false,
    );
    const reference = new Document({ width: 380, height: 220 });
    const group = reference.layers.add(new LayerGroup());
    group.transform = instance.transform.multiply(AffineTransform.scale(2, 2));
    group.layers.add(
      new RasterLayer({
        assetId: baked.id,
        width: 112,
        height: 80,
        x: -8,
        y: -8,
      }),
    );
    const expected = await render(reference.toJSON());
    const { exportPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const png = await exportPng(
      editor.document.toJSON(),
      editor.assetStore,
      editor.renderer,
    );
    const bitmap = await createImageBitmap(png),
      output = new OffscreenCanvas(380, 220),
      out = output.getContext("2d")!;
    out.drawImage(bitmap, 0, 0);
    bitmap.close();
    const exported = out.getImageData(0, 0, 380, 220).data;
    const maxDifference = (other: ArrayLike<number>) =>
      actual.reduce(
        (max, value, index) => Math.max(max, Math.abs(value - other[index])),
        0,
      );
    return {
      referenceDifference: maxDifference(expected),
      exportDifference: maxDifference(exported),
      visible: actual.some((v) => v > 0),
    };
  });
  expect(result.visible).toBe(true);
  expect(result.referenceDifference).toBe(0);
  expect(result.exportDifference).toBe(0);
});

test("nested filter changes invalidate cached parent pixels and filter order remains observable", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor,
      { Document, RasterLayer, GaussianBlurFilter, SmartToneFilter } =
        window.luma;
    editor.newDocument({ width: 64, height: 64 });
    const input = new OffscreenCanvas(32, 32),
      c = input.getContext("2d")!;
    c.fillStyle = "#505050";
    c.fillRect(0, 0, 16, 32);
    c.fillStyle = "#dcdcdc";
    c.fillRect(16, 0, 16, 32);
    const asset = await editor.assetStore.add(
      await input.convertToBlob(),
      "Source",
      undefined,
      false,
    );
    const leaf = new Document({ width: 32, height: 32 });
    leaf.layers.add(
      new RasterLayer({ assetId: asset.id, width: 32, height: 32 }),
    );
    const leafId = editor.document.defineComponent(leaf);
    const parent = Document.fromJSON({
      ...new Document({ width: 32, height: 32 }).toJSON(),
      components: editor.document.toJSON().components,
    });
    const nested = parent.placeSmartObject(leafId);
    const blur = new GaussianBlurFilter({ sigma: 2 }),
      tone = new SmartToneFilter({ exposure: 1 });
    nested.setFilters([blur, tone]);
    const parentId = editor.document.defineComponent(parent);
    editor.document.placeSmartObject(parentId, { x: 16, y: 16 });
    async function pixels(cache: boolean) {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache, readback: true },
      );
      const data = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 64, 64).data,
      ];
      canvas.width = canvas.height = 0;
      return data;
    }
    const first = await pixels(true),
      before = JSON.stringify(editor.document.toJSON());
    nested.setFilters([tone, blur]);
    editor.document.defineComponent(parent, { id: parentId });
    const reordered = await pixels(true),
      clean = await pixels(false);
    editor.document.undo();
    const restored = await pixels(true);
    return {
      orderChanged: reordered.some((v, i) => v !== first[i]),
      cleanMatches: reordered.every((v, i) => v === clean[i]),
      undoPixels: restored.every((v, i) => v === first[i]),
      undoData: before === JSON.stringify(editor.document.toJSON()),
    };
  });
  expect(result).toEqual({
    orderChanged: true,
    cleanMatches: true,
    undoPixels: true,
    undoData: true,
  });
});
