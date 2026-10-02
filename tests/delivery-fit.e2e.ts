import { test, expect } from "@playwright/test";

test("delivery fitting scales nested masked artwork and text without mutating the source", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const { fittedRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/fitted-renderer.ts")
    );
    const { exportPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const { LayerGroup, RasterLayer, LayerMask, MarqueeSelection, TextLayer } =
      window.luma;
    const editor = window.luma.editor;
    editor.newDocument({ width: 64, height: 32 });
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = sourceCanvas.height = 1;
    sourceCanvas.getContext("2d")!.fillStyle = "#00ff00";
    sourceCanvas.getContext("2d")!.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob>((resolve) =>
      sourceCanvas.toBlob((b) => resolve(b!)),
    );
    const asset = await editor.assetStore.add(blob, "green");
    const group = new LayerGroup({ x: 4, y: 2 });
    const layer = new RasterLayer({
      assetId: asset.id,
      x: 4,
      y: 2,
      width: 16,
      height: 8,
    });
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 8,
        height: 8,
      }),
    });
    group.layers.add(layer);
    group.layers.add(
      new TextLayer({
        text: "Hi",
        x: 26,
        y: 8,
        fontSize: 10,
        color: "#ffffff",
      }),
    );
    editor.document.layers.add(group);
    // Content outside the source artboard must not appear in contain margins.
    editor.document.layers.add(
      new RasterLayer({ assetId: asset.id, x: 0, y: -8, width: 64, height: 8 }),
    );
    const doc = editor.document.toJSON();
    const before = JSON.stringify(doc);
    const renderer = new CanvasRenderer();
    const pixel = (canvas: HTMLCanvasElement, x: number, y: number) =>
      Array.from(canvas.getContext("2d")!.getImageData(x, y, 1, 1).data);
    const output = [];
    for (const fit of ["contain", "cover", "fill"] as const) {
      const width = 128,
        height = fit === "contain" ? 128 : 32;
      const view = fittedRenderer(renderer, doc, width, height, fit);
      const delivery = { ...doc, width, height };
      const canvas = await view.render(delivery, editor.assetStore, {
        cache: false,
      });
      const png = await exportPng(delivery, editor.assetStore, view);
      const bitmap = await createImageBitmap(png);
      const decoded = document.createElement("canvas");
      decoded.width = width;
      decoded.height = height;
      decoded.getContext("2d")!.drawImage(bitmap, 0, 0);
      const a: Uint8ClampedArray = canvas
        .getContext("2d")!
        .getImageData(0, 0, width, height).data;
      const b = decoded
        .getContext("2d")!
        .getImageData(0, 0, width, height).data;
      output.push({
        fit,
        green: pixel(
          canvas,
          20,
          fit === "contain" ? 44 : fit === "cover" ? 4 : 6,
        ),
        masked: pixel(canvas, 40, fit === "contain" ? 44 : 6),
        margin: pixel(canvas, 20, 20),
        tiledEqual: a.every((v, i) => v === b[i]),
        textPixels: Array.from(a).filter((v, i) => i % 4 === 0 && v > 200)
          .length,
      });
      bitmap.close();
      canvas.width = decoded.width = 0;
    }
    renderer.dispose();
    return { output, unchanged: before === JSON.stringify(doc) };
  });
  expect(result.unchanged).toBe(true);
  for (const output of result.output) {
    expect(output.green).toEqual([0, 255, 0, 255]);
    expect(output.masked[3]).toBe(0);
    expect(output.tiledEqual).toBe(true);
    expect(output.textPixels).toBeGreaterThan(10);
    if (output.fit === "contain") expect(output.margin[3]).toBe(0);
  }
});
