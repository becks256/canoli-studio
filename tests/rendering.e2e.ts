import { test, expect } from "@playwright/test";

test("incremental brush/pencil previews match full replay with clipping, styles and viewport changes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      LayerGroup,
      PaintLayer,
      PaintFill,
      BrushStroke,
      PencilStroke,
      MarqueeSelection,
      LayerStyle,
      BlendIf,
    } = window.luma;
    const doc = new Document({ width: 320, height: 240 });
    const group = doc.layers.add(new LayerGroup({ x: 12, y: 9, opacity: 0.8 }));
    const background = group.layers.add(new PaintLayer());
    background.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 320, height: 240 },
        color: "#777777",
      }),
    );
    const paint = group.layers.add(
      new PaintLayer({ x: 4, y: 6, opacity: 0.7, fillOpacity: 0.8 }),
    );
    paint.strokes.add(
      new BrushStroke({
        points: [
          { x: 30, y: 40 },
          { x: 220, y: 40 },
        ],
        size: 24,
        opacity: 0.5,
      }),
    );
    paint.styles = new LayerStyle({
      colorOverlay: { enabled: true, color: "#55cc88", opacity: 0.3 },
      dropShadow: { enabled: true, x: 4, y: 6, blur: 3 },
      blendIf: new BlendIf({ enabled: true, underlying: [0, 40, 200, 255] }),
    });
    const clip = new MarqueeSelection({
      shape: "ellipse",
      x: 25,
      y: 30,
      width: 160,
      height: 100,
    });
    const points = Array.from({ length: 80 }, (_, i) => ({
      x: 10 + i * 2.4,
      y: 70 + Math.sin(i / 7) * 30,
      pressure: 0.2 + (i % 11) / 14,
    }));
    let maximumDifference = 0;
    const compare = async (a: HTMLCanvasElement, b: HTMLCanvasElement) => {
      const x = a.getContext("2d")!.getImageData(0, 0, a.width, a.height).data;
      const y = b.getContext("2d")!.getImageData(0, 0, b.width, b.height).data;
      for (let i = 0; i < x.length; i++)
        maximumDifference = Math.max(maximumDifference, Math.abs(x[i] - y[i]));
      a.width = a.height = b.width = b.height = 0;
    };
    for (const Constructor of [BrushStroke, PencilStroke]) {
      const data = new Constructor({
        points,
        size: 19,
        hardness: 0.35,
        opacity: 0.45,
        clip,
      }).toJSON();
      if (data.kind === "fill") throw new Error("Expected stroke");
      for (const count of [1, 13, 45, 80, 25, 80]) {
        const stroke = { ...data, points: data.points.slice(0, count) };
        const options = {
          region: { x: count === 25 ? 33 : 0, y: 5, width: 260, height: 200 },
          scale: count === 25 ? 0.65 : 1,
        };
        const cached = await editor.renderer.render(
          doc.getSnapshot().document,
          editor.assetStore,
          { ...options, paintPreview: { layerId: paint.id, stroke } },
        );
        const reference = doc.toJSON();
        const g = reference.children[0];
        if (g.kind !== "group" || g.children[1].kind !== "paint")
          throw new Error("Expected paint");
        g.children[1].strokes.push(stroke);
        await compare(
          cached,
          await editor.renderer.render(reference, editor.assetStore, {
            ...options,
            cache: false,
          }),
        );
      }
    }
    // Changed backdrops must invalidate group content and rerun underlying Blend If.
    for (const change of [
      () => {
        background.visible = false;
      },
      () => doc.undo(),
      () => doc.redo(),
      () => {
        group.x = 30;
      },
      () => {
        paint.fillOpacity = 0.4;
      },
    ]) {
      change();
      const snapshot = doc.getSnapshot().document;
      await compare(
        await editor.renderer.render(snapshot, editor.assetStore),
        await editor.renderer.render(snapshot, editor.assetStore, {
          cache: false,
        }),
      );
    }
    return { maximumDifference };
  });
  expect(result.maximumDifference).toBe(0);
});

test("warm layers and old active segments are not repainted", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, PaintLayer, BrushStroke } = window.luma;
    const doc = new Document({ width: 320, height: 240 });
    const paint = doc.layers.add(new PaintLayer());
    for (let i = 0; i < 12; i++)
      paint.strokes.add(
        new BrushStroke({
          points: [
            { x: 10, y: 10 + i * 15 },
            { x: 280, y: 10 + i * 15 },
          ],
          size: 12,
        }),
      );
    const data = new BrushStroke({
      points: Array.from({ length: 60 }, (_, i) => ({ x: 20 + i * 3, y: 100 })),
      size: 12,
    }).toJSON();
    if (data.kind === "fill") throw new Error("Expected brush");
    const arc = CanvasRenderingContext2D.prototype.arc;
    let stamps = 0;
    CanvasRenderingContext2D.prototype.arc = function (...args) {
      stamps++;
      return arc.apply(this, args);
    };
    const render = async (count: number, cache = true) => {
      const start = performance.now();
      const canvas = await editor.renderer.render(
        doc.getSnapshot().document,
        editor.assetStore,
        {
          cache,
          paintPreview: {
            layerId: paint.id,
            stroke: { ...data, points: data.points.slice(0, count) },
          },
        },
      );
      canvas.width = canvas.height = 0;
      return performance.now() - start;
    };
    try {
      await render(40);
      stamps = 0;
      const warmMs = await render(60),
        addedStamps = stamps;
      stamps = 0;
      await render(60);
      const repeatedStamps = stamps;
      stamps = 0;
      const replayMs = await render(60, false),
        replayStamps = stamps;
      editor.renderer.clearCache();
      stamps = 0;
      await render(60);
      return {
        addedStamps,
        repeatedStamps,
        replayStamps,
        afterClear: stamps,
        warmMs,
        replayMs,
      };
    } finally {
      CanvasRenderingContext2D.prototype.arc = arc;
    }
  });
  expect(result.addedStamps).toBe(60); // 20 new segments, three stamps per segment.
  expect(result.repeatedStamps).toBe(0);
  expect(result.replayStamps).toBeGreaterThan(2000);
  expect(result.afterClear).toBe(result.replayStamps);
  console.log("Incremental rendering work:", result);
});

test("pointer bursts publish once per frame, retain all samples and cancel cleanly", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    const modifiers = { alt: false, shift: false, pressure: 1 };
    const history = () => editor.document.getSnapshot().past.length;
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    editor.tools.begin("brush", { x: 20, y: 30 }, modifiers, 1);
    const basePreview = editor.tools.getSnapshot().preview;
    let publications = 0;
    const unsubscribe = editor.tools.subscribe(() => publications++);
    for (let i = 1; i <= 100; i++)
      editor.tools.move({ x: 20 + i * 2, y: 30 }, modifiers);
    const beforeFrame = publications;
    await frame();
    const afterFrame = publications;
    const preview = editor.tools.getSnapshot();
    const during = history();
    // End before another frame: the final sample must be in the single commit.
    editor.tools.move({ x: 250, y: 30 }, modifiers);
    await editor.tools.end();
    const layer = editor.document.selectedLayer;
    if (!(layer instanceof PaintLayer))
      throw new Error("Missing committed paint");
    const stroke = layer.strokes.at(0)!.toJSON();
    if (stroke.kind === "fill") throw new Error("Expected brush");
    const committed = history();
    editor.document.undo();
    const undoLayers = editor.document.layers.length;
    editor.document.redo();
    const redoLayers = editor.document.layers.length;
    editor.tools.begin("pencil", { x: 20, y: 80 }, modifiers, 1);
    editor.tools.move({ x: 250, y: 80 }, modifiers);
    editor.tools.cancel();
    await frame();
    unsubscribe();
    return {
      beforeFrame,
      afterFrame,
      during,
      committed,
      points: stroke.points.length,
      endpoint: stroke.points.at(-1),
      previewPoints: preview.paintPreview?.stroke.points.length,
      stableBase: basePreview === preview.preview,
      undoLayers,
      redoLayers,
      cancelled: editor.tools.getSnapshot().paintPreview === null,
      afterCancel: history(),
    };
  });
  expect(result).toMatchObject({
    beforeFrame: 0,
    afterFrame: 1,
    during: 0,
    committed: 1,
    points: 102,
    endpoint: { x: 250, y: 30 },
    previewPoints: 101,
    stableBase: true,
    undoLayers: 0,
    redoLayers: 1,
    cancelled: true,
    afterCancel: 1,
  });
});

test("visible brush preview commits without a pixel jump and Escape discards it", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 400, height: 300 }),
  );
  await page.keyboard.press("Control+1");
  await page.keyboard.press("b");
  await page.evaluate(() =>
    window.luma.editor.tools.configure({
      size: 31,
      hardness: 0.4,
      opacity: 0.45,
    }),
  );
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  const snapshot = () =>
    page
      .locator(".canvas-wrap canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const empty = await snapshot();
  await page.mouse.move(box.x + 30, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 70, { steps: 20 });
  await expect.poll(snapshot).not.toBe(empty);
  // Wait for a painted endpoint, rather than an arbitrary timing delay.
  await expect
    .poll(() =>
      page.locator(".canvas-wrap canvas").evaluate((node) => {
        const c = node as HTMLCanvasElement;
        return c.getContext("2d")!.getImageData(220, 70, 1, 1).data[3];
      }),
    )
    .toBeGreaterThan(0);
  const preview = await snapshot();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(0);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.luma.editor.document.getSnapshot().past.length,
      ),
    )
    .toBe(1);
  await expect.poll(snapshot).toBe(preview);
  await page.mouse.move(box.x + 30, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 8 });
  await expect.poll(snapshot).not.toBe(preview);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(snapshot).toBe(preview);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(1);
  // Unexpected pointer-capture loss also discards an in-progress gesture.
  await page.mouse.move(box.x + 30, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200, { steps: 8 });
  await expect.poll(snapshot).not.toBe(preview);
  await page
    .locator(".viewport")
    .evaluate((element) => element.releasePointerCapture(1));
  await page.mouse.move(box.x + 225, box.y + 200);
  await page.mouse.up();
  await expect.poll(snapshot).toBe(preview);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(1);
});

test("canvas cache bounds retained memory and cached tone invalidates after edits", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/cache.ts";
    const { CanvasCache } = await import(path);
    const cache = new CanvasCache(9000);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    canvas.getContext("2d")!.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 20; i++) cache.write(String(i), "version", canvas);
    const bounded = cache.byteLength <= cache.budget;
    const evicted = !cache.read("0", "version", canvas);
    const newest = cache.read("19", "version", canvas);
    cache.clear();
    const empty = cache.byteLength === 0;
    const { editor, RasterLayer, Document } = window.luma;
    const doc = new Document({ width: 32, height: 32 });
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const asset = await editor.assetStore.add(
      new File([blob], "source.png", { type: "image/png" }),
      "source",
    );
    const layer = doc.layers.add(
      new RasterLayer({ assetId: asset.id, width: 32, height: 32 }),
    );
    layer.setTone({ exposure: 0.5 });
    const process = editor.renderer.processor.process.bind(
      editor.renderer.processor,
    );
    let calls = 0;
    editor.renderer.processor.process = (...args) => {
      calls++;
      return process(...args);
    };
    const render = async () => {
      const c = await editor.renderer.render(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      c.width = c.height = 0;
    };
    try {
      editor.renderer.clearCache();
      await render();
      const first = calls;
      await render();
      const repeated = calls - first;
      layer.setTone({ exposure: 1 });
      await render();
      const changed = calls - first;
      return { bounded, evicted, newest, empty, first, repeated, changed };
    } finally {
      editor.renderer.processor.process = process;
    }
  });
  expect(result).toMatchObject({
    bounded: true,
    evicted: true,
    newest: true,
    empty: true,
    first: 1,
    repeated: 0,
    changed: 1,
  });
});
