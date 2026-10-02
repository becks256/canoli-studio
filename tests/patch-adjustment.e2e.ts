import { expect, test } from "@playwright/test";

test("scripted patches preserve backdrop alpha across tiles, masks, undo and project reopen", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { LayerMask, MarqueeSelection } = window.luma;
    editor.newDocument({ width: 1030, height: 8 });
    const canvas = new OffscreenCanvas(1030, 8);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, 1030, 8);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await editor.importImage(
      new File([blob], "base.png", { type: "image/png" }),
    );
    const sourceId = editor.assetStore.values()[0].id;
    const patchCanvas = new OffscreenCanvas(20, 4);
    const pc = patchCanvas.getContext("2d")!;
    pc.fillStyle = "rgba(255,255,255,0.5)";
    pc.fillRect(0, 0, 20, 4);
    const asset = await editor.assetStore.add(
      await patchCanvas.convertToBlob({ type: "image/png" }),
      "patch",
    );
    await editor.runScript(`document.layers.add(new AdjustmentLayer({ name: 'Patch', x: 1018, y: 2,
      adjustment: new PatchAdjustment({ assetId: ${JSON.stringify(asset.id)}, width: 20, height: 4 }) }));`);
    const sample = async () => {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const context = surface.getContext("2d")!;
      const pixels = [1017, 1020, 1025].map((x) => [
        ...context.getImageData(x, 3, 1, 1).data,
      ]);
      surface.width = surface.height = 0;
      return pixels;
    };
    const applied = await sample();
    editor.document.undo();
    const undone = await sample();
    editor.document.redo();
    const redone = await sample();
    const layer = editor.document.layers.at(1)!;
    layer.opacity = 0.5;
    const faded = await sample();
    editor.document.undo();
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 5,
        height: 4,
      }),
    });
    const masked = await sample();
    editor.document.undo();
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "patch.luma"));
    const reopened = await sample();
    const originalUnchanged =
      (await editor.assetStore.get(sourceId).blob.text()) ===
      (await blob.text());
    let missing = "";
    try {
      await editor.runScript(
        `document.layers.add(new AdjustmentLayer({ adjustment: new PatchAdjustment({ assetId: 'missing', width: 1, height: 1 }) }));`,
      );
    } catch (error) {
      missing = String(error);
    }
    return {
      applied,
      undone,
      redone,
      faded,
      masked,
      reopened,
      originalUnchanged,
      missing,
      count: editor.document.layers.length,
    };
  });
  expect(result.applied[0]).toEqual([0, 0, 0, 128]);
  for (const pixel of result.applied.slice(1)) {
    expect(pixel[0]).toBeCloseTo(128, -1);
    expect(pixel[3]).toBe(128);
  }
  expect(result.undone).toEqual([
    [0, 0, 0, 128],
    [0, 0, 0, 128],
    [0, 0, 0, 128],
  ]);
  expect(result.redone).toEqual(result.applied);
  expect(result.reopened).toEqual(result.applied);
  expect(result.faded[1][0]).toBeCloseTo(64, -1);
  expect(result.faded[1][3]).toBe(128);
  expect(result.masked[1]).toEqual(result.applied[1]);
  expect(result.masked[2]).toEqual([0, 0, 0, 128]);
  expect(result.originalUnchanged).toBe(true);
  expect(result.missing).toMatch(/asset/i);
  expect(result.count).toBe(2);
});

test("portable recipes remap patch references in additions and replacements", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { serializeRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 4, height: 4 });
    const canvas = new OffscreenCanvas(4, 4);
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, 4, 4);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob({ type: "image/png" }),
      "corrected",
    );
    const descriptor = new window.luma.PatchAdjustment({
      assetId: asset.id,
      width: 4,
      height: 4,
    }).toJSON();
    const recipe = {
      schemaVersion: 1,
      id: "patch-portable",
      name: "Patch",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "adjustment",
              name: "Patch",
              adjustment: descriptor,
            },
          },
        },
        {
          id: "replace",
          name: "Replace",
          target: { by: "stepResult", stepId: "add" },
          action: { type: "layer.update", patch: { adjustment: descriptor } },
        },
      ],
    };
    const file = await serializeRecipePackage(recipe, editor.assetStore);
    editor.newDocument({ width: 4, height: 4 });
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 4, 4);
    await editor.importImage(
      new File(
        [await canvas.convertToBlob({ type: "image/png" })],
        "base.png",
        { type: "image/png" },
      ),
    );
    await editor.recipes.executeRecipePackage(file);
    const layer = editor.document.layers.at(1)!;
    const data = layer.toJSON();
    if (data.kind !== "adjustment" || data.adjustment.kind !== "patch")
      throw new Error("Missing patch");
    const mapped = data.adjustment.assetId;
    const surface = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const pixel = [...surface.getContext("2d")!.getImageData(1, 1, 1, 1).data];
    surface.width = surface.height = 0;
    editor.document.undo();
    const undone = editor.document.layers.length;
    editor.document.redo();
    return {
      mapped: mapped !== asset.id,
      installed: editor.assetStore.get(mapped).width,
      pixel,
      undone,
      redone: editor.document.layers.length,
    };
  });
  expect(result).toEqual({
    mapped: true,
    installed: 4,
    pixel: [255, 255, 255, 255],
    undone: 1,
    redone: 2,
  });
});

test("host patch commit solves donor texture and rejects target changes before commit", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 20, height: 10 });
    const canvas = new OffscreenCanvas(20, 10),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#646464";
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillStyle = "#a0a0a0";
    ctx.fillRect(10, 0, 10, 10);
    ctx.fillStyle = "#bebebe";
    ctx.fillRect(14, 4, 1, 1);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "base.png", {
        type: "image/png",
      }),
    );
    editor.document.selection = new window.luma.MarqueeSelection({
      shape: "rectangle",
      x: 2,
      y: 2,
      width: 5,
      height: 5,
    });
    const before = editor.document.toJSON(),
      history = editor.document.getSnapshot().past.length;
    await editor.applyPatch({ x: 10, y: 0 });
    const surface = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const pixel = [...surface.getContext("2d")!.getImageData(4, 4, 1, 1).data];
    surface.width = surface.height = 0;
    const entries = editor.document.getSnapshot().past.length - history;
    editor.document.undo();
    const undone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    const assets = editor.assetStore.values().length;
    const pending = editor.applyPatch({ x: 10, y: 0 });
    editor.document.name = "Changed";
    let error = "";
    try {
      await pending;
    } catch (failure) {
      error = String(failure);
    }
    const controller = new AbortController();
    controller.abort();
    let cancelled = false;
    try {
      await editor.applyPatch(
        { x: 10, y: 0 },
        undefined,
        undefined,
        controller.signal,
      );
    } catch {
      cancelled = true;
    }
    return {
      pixel,
      entries,
      undone,
      error,
      cancelled,
      unchangedAssets: assets === editor.assetStore.values().length,
      layers: editor.document.layers.length,
    };
  });
  expect(result).toMatchObject({
    pixel: [130, 130, 130, 255],
    entries: 1,
    undone: true,
    cancelled: true,
    unchangedAssets: true,
    layers: 1,
  });
  expect(result.error).toContain("Document changed");
});

test("fractional patch coverage is applied once when prepared colors are committed", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { prepareRetouchPatch } = await import(
      /* @vite-ignore */ String("/src/engine/patch.ts")
    );
    const { PixelProcessor } = await import(
      /* @vite-ignore */ String("/src/engine/processor.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 20, height: 10 });
    const canvas = new OffscreenCanvas(20, 10),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#646464";
    ctx.fillRect(0, 0, 10, 10);
    ctx.fillStyle = "#a0a0a0";
    ctx.fillRect(10, 0, 10, 10);
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(12, 3, 1, 3);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "base.png", {
        type: "image/png",
      }),
    );
    editor.document.selection = new window.luma.MarqueeSelection({
      shape: "rectangle",
      x: 2.5,
      y: 2.5,
      width: 4,
      height: 4,
    });
    const processor = new PixelProcessor();
    try {
      const prepared = await prepareRetouchPatch(
        editor.document.toJSON(),
        editor.assetStore,
        editor.renderer,
        processor,
        editor.document.selection!.toJSON(),
        { x: 10, y: 0 },
        { mode: "all-layers" },
      );
      await editor.applyPatch({ x: 10, y: 0 });
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const actual = surface
        .getContext("2d")!
        .getImageData(
          prepared.bounds.x,
          prepared.bounds.y,
          prepared.bounds.width,
          prepared.bounds.height,
        ).data;
      surface.width = surface.height = 0;
      let maxDelta = 0,
        softChanged = 0;
      for (let p = 0; p < prepared.coverage.length; p++) {
        if (
          prepared.coverage[p] > 0 &&
          prepared.coverage[p] < 255 &&
          Math.abs(prepared.pixels[p * 4] - 100) > 5
        )
          softChanged++;
        for (let c = 0; c < 4; c++)
          maxDelta = Math.max(
            maxDelta,
            Math.abs(actual[p * 4 + c] - prepared.pixels[p * 4 + c]),
          );
      }
      return { maxDelta, softChanged };
    } finally {
      processor.dispose();
    }
  });
  expect(result.softChanged).toBeGreaterThan(0);
  expect(result.maxDelta).toBeLessThanOrEqual(2);
});
