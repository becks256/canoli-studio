import { expect, test } from "@playwright/test";

test("retouch sample modes honor nested placement and keep the captured layer tree immutable", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { retouchSampleDocument, sampleRetouchRegion } = await import(
      /* @vite-ignore */ String("/src/engine/retouch-sampling.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 16, height: 8 });
    const make = async (color: string) => {
      const canvas = new OffscreenCanvas(16, 8),
        ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 16, 8);
      const asset = await editor.assetStore.add(
        await canvas.convertToBlob(),
        color,
      );
      return new window.luma.RasterLayer({
        assetId: asset.id,
        width: 16,
        height: 8,
      });
    };
    editor.document.layers.add(await make("#ff0000"));
    const group = editor.document.layers.add(
      new window.luma.LayerGroup({ x: 4, y: 0 }),
    );
    group.mask = new window.luma.LayerMask({
      selection: new window.luma.MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 8,
        height: 8,
      }),
    });
    const selected = group.layers.add(await make("#00ff00"));
    selected.opacity = 0.5;
    group.layers.add(await make("#0000ff"));
    editor.document.layers.add(await make("#ffff00"));
    const original = JSON.stringify(editor.document.toJSON());
    const outputs: Record<string, number[]> = {};
    for (const mode of ["current-layer", "current-and-below", "all-layers"]) {
      const snapshot = retouchSampleDocument(editor.document.toJSON(), {
        mode,
        layerId: selected.id,
      });
      const pixels = await sampleRetouchRegion(
        snapshot,
        editor.assetStore,
        editor.renderer,
        { x: 0, y: 0, width: 16, height: 8 },
      );
      outputs[mode] = [...pixels.slice(6 * 4, 6 * 4 + 4)];
      if (mode === "current-layer") {
        outputs.outside = [...pixels.slice(0, 4)];
        outputs.masked = [...pixels.slice(14 * 4, 14 * 4 + 4)];
      }
    }
    const captured = retouchSampleDocument(editor.document.toJSON(), {
      mode: "current-layer",
      layerId: selected.id,
    });
    selected.opacity = 0;
    const old = await sampleRetouchRegion(
      captured,
      editor.assetStore,
      editor.renderer,
      { x: 6, y: 0, width: 1, height: 1 },
    );
    editor.document.undo();
    return {
      outputs,
      captured: [...old],
      unchanged: JSON.stringify(editor.document.toJSON()) === original,
    };
  });
  expect(result.outputs["current-layer"]).toEqual([0, 255, 0, 128]);
  expect(result.outputs["current-and-below"]).toEqual([127, 128, 0, 255]);
  expect(result.outputs["all-layers"]).toEqual([255, 255, 0, 255]);
  expect(result.outputs.outside).toEqual([0, 0, 0, 0]);
  expect(result.outputs.masked).toEqual([0, 0, 0, 0]);
  expect(result.captured).toEqual([0, 255, 0, 128]);
  expect(result.unchanged).toBe(true);
});

test("patch preparation transfers donor detail with target illumination without changing the document", async ({
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
    ctx.fillStyle = "#bebebe";
    ctx.fillRect(14, 4, 1, 1);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "patch.png", {
        type: "image/png",
      }),
    );
    const original = JSON.stringify(editor.document.toJSON()),
      history = editor.document.getSnapshot().past.length;
    const processor = new PixelProcessor();
    const selection = new window.luma.MarqueeSelection({
      shape: "rectangle",
      x: 2,
      y: 2,
      width: 5,
      height: 5,
    }).toJSON();
    const prepare = (offset: number, options = {}) =>
      prepareRetouchPatch(
        editor.document.toJSON(),
        editor.assetStore,
        editor.renderer,
        processor,
        selection,
        { x: offset, y: 0 },
        { mode: "all-layers" },
        options,
      );
    try {
      const patch = await prepare(10);
      const { translateSelection } = await import(
        /* @vite-ignore */ String("/src/core/drawing.ts")
      );
      const destination = await prepareRetouchPatch(
        editor.document.toJSON(),
        editor.assetStore,
        editor.renderer,
        processor,
        translateSelection(selection, 10, 0)!,
        { x: -10, y: 0 },
        { mode: "all-layers" },
        { direction: "destination" },
      );
      const destinationMatches =
        JSON.stringify(destination.bounds) === JSON.stringify(patch.bounds) &&
        destination.pixels.every(
          (value: number, index: number) => value === patch.pixels[index],
        ) &&
        destination.coverage.every(
          (value: number, index: number) => value === patch.coverage[index],
        );
      let badDirection = "";
      try {
        await prepare(10, { direction: "invalid" });
      } catch (e) {
        badDirection = String(e);
      }
      let outside = "",
        nonconverged = "";
      try {
        await prepare(30);
      } catch (e) {
        outside = String(e);
      }
      try {
        await prepare(10, { maxIterations: 1 });
      } catch (e) {
        nonconverged = String(e);
      }
      return {
        bounds: patch.bounds,
        center: [...patch.pixels.slice((3 * 7 + 3) * 4, (3 * 7 + 3) * 4 + 4)],
        boundary: [...patch.pixels.slice(0, 4)],
        coverage: patch.coverage[0],
        residual: patch.residual,
        outside,
        nonconverged,
        destinationMatches,
        badDirection,
        unchanged: JSON.stringify(editor.document.toJSON()) === original,
        historyUnchanged: editor.document.getSnapshot().past.length === history,
        assets: editor.assetStore.values().length,
      };
    } finally {
      processor.dispose();
    }
  });
  expect(result).toMatchObject({
    bounds: { x: 1, y: 1, width: 7, height: 7 },
    center: [130, 130, 130, 255],
    boundary: [100, 100, 100, 255],
    coverage: 0,
    unchanged: true,
    historyUnchanged: true,
    assets: 1,
  });
  expect(result.residual).toBeLessThanOrEqual(0.001);
  expect(result.destinationMatches).toBe(true);
  expect(result.badDirection).toContain("Unknown patch direction");
  expect(result.outside).toContain("outside the canvas");
  expect(result.nonconverged).toContain("did not converge");
});

test("retouch sampling cancels after an in-flight tile and releases its surface", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { sampleRetouchRegion } = await import(
      /* @vite-ignore */ String("/src/engine/retouch-sampling.ts")
    );
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 1030, height: 2 });
    const renderer = new CanvasRenderer(),
      render = renderer.render.bind(renderer),
      abort = new AbortController();
    let calls = 0,
      surface: HTMLCanvasElement | undefined;
    renderer.render = async (...args: Parameters<typeof render>) => {
      calls++;
      surface = await render(...args);
      abort.abort(new Error("Cancelled sample"));
      return surface;
    };
    let error = "";
    try {
      await sampleRetouchRegion(
        editor.document.toJSON(),
        editor.assetStore,
        renderer,
        { x: 0, y: 0, width: 1030, height: 2 },
        abort.signal,
      );
    } catch (e) {
      error = String(e);
    } finally {
      renderer.dispose();
    }
    return { calls, released: surface?.width === 0, error };
  });
  expect(result).toEqual({
    calls: 1,
    released: true,
    error: "Error: Cancelled sample",
  });
});
