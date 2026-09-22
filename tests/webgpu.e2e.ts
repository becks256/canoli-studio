import { test, expect } from "@playwright/test";

// SwiftShader runs actual WebGPU validation and WGSL. These are correctness
// tests, not evidence of hardware acceleration or user-device performance.
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: [
      "--enable-gpu",
      "--enable-unsafe-webgpu",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--use-vulkan=swiftshader",
      "--use-webgpu-adapter=swiftshader",
      "--disable-vulkan-surface",
    ],
  },
});

test("WebGPU executes real shaders, retains textures, and renders brush/pencil previews", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      BrushStroke,
      PencilStroke,
    } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    const ready = await gpu.ready;
    if (!ready) return { ready, diagnostics: gpu.diagnostics };
    const doc = new Document({ width: 160, height: 120 });
    const base = doc.layers.add(new PaintLayer());
    base.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 160, height: 120 },
        color: "#243648",
      }),
    );
    const paint = doc.layers.add(new PaintLayer());
    const read = async (options = {}) => {
      const frame = await gpu.prepare(
        doc.getSnapshot().document,
        editor.assetStore,
        options,
      );
      if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
      const pixels = [...(await frame.readPixels())];
      frame.dispose();
      return pixels;
    };
    try {
      const blank = await read(),
        initialUploads = gpu.diagnostics.uploads;
      const stroke = new BrushStroke({
        points: [
          { x: 20, y: 40 },
          { x: 60, y: 40 },
          { x: 100, y: 40 },
        ],
        color: "#ff0000",
        size: 16,
        hardness: 1,
      }).toJSON();
      if (stroke.kind === "fill") throw new Error("Expected brush");
      await read({
        paintPreview: {
          layerId: paint.id,
          stroke: { ...stroke, points: stroke.points.slice(0, 2) },
        },
      });
      const beforeStamps = gpu.diagnostics.stamps;
      const painted = await read({
        paintPreview: { layerId: paint.id, stroke },
      });
      const addedStamps = gpu.diagnostics.stamps - beforeStamps;
      const repeated = await read({
        paintPreview: { layerId: paint.id, stroke },
      });
      const repeatedStamps =
        gpu.diagnostics.stamps - beforeStamps - addedStamps;
      paint.strokes.add(
        new PencilStroke({
          points: [
            { x: 20.5, y: 80.5 },
            { x: 100.5, y: 80.5 },
          ],
          size: 1,
          color: "#00ff00",
        }),
      );
      const pencil = await read();
      const sample = (pixels: number[], x: number, y: number) =>
        pixels.slice((y * 160 + x) * 4, (y * 160 + x) * 4 + 4);
      return {
        ready,
        initialUploads,
        uploads: gpu.diagnostics.uploads,
        addedStamps,
        repeatedStamps,
        stable: JSON.stringify(painted) === JSON.stringify(repeated),
        blank: sample(blank, 60, 40),
        brush: sample(painted, 60, 40),
        pencil: sample(pencil, 60, 80),
        adjacent: sample(pencil, 60, 81),
        diagnostics: gpu.diagnostics,
      };
    } finally {
      gpu.dispose();
    }
  });
  expect(result.ready, JSON.stringify(result)).toBe(true);
  expect(result.blank).toEqual([36, 54, 72, 255]);
  expect(result.brush).toEqual([255, 0, 0, 255]);
  expect(result.pencil).toEqual([0, 255, 0, 255]);
  expect(result.adjacent).toEqual(result.blank);
  expect(result.stable).toBe(true);
  expect(result.addedStamps).toBeGreaterThan(0);
  expect(result.repeatedStamps).toBe(0);
  expect(result.uploads).toBe(result.initialUploads);
});

test("GPU tone, all blend modes, groups and Blend If agree with the reference renderer", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      RasterLayer,
      LayerGroup,
      LayerStyle,
      BlendIf,
    } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error(JSON.stringify(gpu.diagnostics));
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const c = canvas.getContext("2d")!;
    const gradient = c.createLinearGradient(0, 0, 96, 64);
    gradient.addColorStop(0, "#3366aa");
    gradient.addColorStop(1, "#dd9977");
    c.fillStyle = gradient;
    c.fillRect(0, 0, 96, 64);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const asset = await editor.assetStore.add(blob, "gradient");
    const doc = new Document({ width: 96, height: 64 });
    const back = doc.layers.add(new PaintLayer());
    back.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 96, height: 64 },
        color: "#6789ab",
      }),
    );
    const group = doc.layers.add(new LayerGroup({ x: 3, y: 2, opacity: 0.85 }));
    const raster = group.layers.add(
      new RasterLayer({
        assetId: asset.id,
        width: 96,
        height: 64,
        opacity: 0.8,
        fillOpacity: 0.7,
      }),
    );
    raster.setTone({ exposure: 0.35, contrast: 12, saturation: -24 });
    raster.styles = new LayerStyle({
      colorOverlay: { enabled: true, color: "#cc7744", opacity: 0.2 },
      blendIf: new BlendIf({
        enabled: true,
        source: [0, 55, 215, 255],
        underlying: [0, 20, 240, 255],
      }),
    });
    const modelPath = "/src/core/model.ts";
    const { BLEND_MODES } = await import(modelPath);
    const differences: { mode: string; max: number; mean: number }[] = [];
    try {
      for (const mode of BLEND_MODES) {
        group.blendMode = mode;
        const frame = await gpu.prepare(
          doc.getSnapshot().document,
          editor.assetStore,
        );
        if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
        const actual = await frame.readPixels();
        frame.dispose();
        const reference = await editor.renderer.render(
          doc.getSnapshot().document,
          editor.assetStore,
          { cache: false, readback: true },
        );
        const expected = reference
          .getContext("2d")!
          .getImageData(0, 0, 96, 64).data;
        let max = 0,
          total = 0;
        for (let i = 0; i < expected.length; i++) {
          const delta = Math.abs(actual[i] - expected[i]);
          max = Math.max(max, delta);
          total += delta;
        }
        differences.push({ mode, max, mean: total / expected.length });
        reference.width = reference.height = 0;
      }
      return { differences, diagnostics: gpu.diagnostics };
    } finally {
      gpu.dispose();
    }
  });
  console.log("GPU/reference differences:", result.differences);
  for (const difference of result.differences) {
    expect(difference.max, difference.mode).toBeLessThanOrEqual(5);
    // Several isolated RGBA8 passes can accumulate a few channel values of rounding.
    expect(difference.mean, difference.mode).toBeLessThan(1.5);
  }
  expect(result.diagnostics.uploads).toBe(2); // Background and raw raster stay resident during edits.
});

test("GPU soft strokes and Boolean clipping retain preview/commit parity across zoom and pan", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      BrushStroke,
      MarqueeSelection,
    } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error(JSON.stringify(gpu.diagnostics));
    const doc = new Document({ width: 10000, height: 5000 });
    const back = doc.layers.add(new PaintLayer());
    back.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 10000, height: 5000 },
        color: "#555555",
      }),
    );
    const paint = doc.layers.add(new PaintLayer({ x: 9000, y: 4700 }));
    const clip = new MarqueeSelection({
      shape: "ellipse",
      x: 20,
      y: 15,
      width: 130,
      height: 100,
    }).combine(
      new MarqueeSelection({
        shape: "rectangle",
        x: 70,
        y: 40,
        width: 20,
        height: 40,
      }),
      "subtract",
    );
    const stroke = new BrushStroke({
      points: Array.from({ length: 40 }, (_, i) => ({
        x: 10 + i * 4,
        y: 55 + Math.sin(i / 6) * 18,
        pressure: 0.3 + (i % 5) * 0.15,
      })),
      size: 25,
      hardness: 0.4,
      opacity: 0.45,
      color: "#eeeeee",
      clip,
    });
    const data = stroke.toJSON();
    if (data.kind === "fill") throw new Error("Expected brush");
    let maxDifference = 0,
      meanDifference = 0,
      previewsMatch = true;
    const read = async (options: object) => {
      const frame = await gpu.prepare(
        doc.getSnapshot().document,
        editor.assetStore,
        options,
      );
      if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
      const pixels = await frame.readPixels();
      const size = [frame.width, frame.height];
      frame.dispose();
      return { pixels, size };
    };
    try {
      for (const scale of [1, 0.75, 1]) {
        const options = {
          region: { x: 9000, y: 4700, width: 180, height: 130 },
          scale,
        };
        await read({
          ...options,
          paintPreview: {
            layerId: paint.id,
            stroke: { ...data, points: data.points.slice(0, 15) },
          },
        });
        const preview = await read({
          ...options,
          paintPreview: { layerId: paint.id, stroke: data },
        });
        paint.strokes.add(new BrushStroke({ ...data, points: data.points }));
        const committed = await read(options);
        previewsMatch &&= preview.pixels.every(
          (v: number, i: number) => v === committed.pixels[i],
        );
        const reference = await editor.renderer.render(
          doc.getSnapshot().document,
          editor.assetStore,
          { ...options, cache: false, readback: true },
        );
        const expected = reference
          .getContext("2d")!
          .getImageData(0, 0, reference.width, reference.height).data;
        let total = 0;
        for (let i = 0; i < expected.length; i++) {
          const difference = Math.abs(expected[i] - committed.pixels[i]);
          maxDifference = Math.max(maxDifference, difference);
          total += difference;
        }
        meanDifference = Math.max(meanDifference, total / expected.length);
        reference.width = reference.height = 0;
        doc.undo();
      }
      const retained = gpu.diagnostics.retainedBytes;
      gpu.clearCache();
      return {
        previewsMatch,
        maxDifference,
        meanDifference,
        retained,
        cleared: gpu.diagnostics.retainedBytes,
      };
    } finally {
      gpu.dispose();
    }
  });
  console.log("GPU brush/reference differences:", result);
  expect(result.previewsMatch).toBe(true);
  expect(result.meanDifference).toBeLessThan(1);
  expect(result.maxDifference).toBeLessThanOrEqual(12);
  expect(result.retained).toBeLessThanOrEqual(80 * 1024 * 1024);
  expect(result.cleared).toBe(0);
});

test("unsupported effects and device loss fall back without losing the document", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/adaptive.ts";
    const { AdaptiveRenderer } = await import(path);
    const { editor, Document, PaintLayer, PaintFill, LayerStyle } = window.luma;
    const renderer = new AdaptiveRenderer({ allowSoftwareAdapter: true });
    const doc = new Document({ width: 64, height: 64 });
    const layer = doc.layers.add(new PaintLayer());
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        color: "#ff0000",
      }),
    );
    try {
      if (!(await renderer.gpu.ready))
        throw new Error(JSON.stringify(renderer.gpu.diagnostics));
      const initial = await renderer.prepareViewport(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      const initialBackend = initial.backend;
      initial.dispose();
      layer.styles = new LayerStyle({ dropShadow: { enabled: true } });
      const shadow = await renderer.prepareViewport(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      const shadowBackend = shadow.backend;
      shadow.dispose();
      layer.styles = new LayerStyle();
      const budget = renderer.gpu.workingBudget;
      renderer.gpu.workingBudget = 1024; // Force allocation fallback without exhausting the browser.
      const limited = await renderer.prepareViewport(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      const budgetBackend = limited.backend;
      limited.dispose();
      renderer.gpu.workingBudget = budget;
      const unchanged = JSON.stringify(doc.toJSON());
      const lost = new Promise<void>((resolve) => {
        const unsubscribe = renderer.subscribeBackend(() => {
          unsubscribe();
          resolve();
        });
      });
      renderer.gpu.device.destroy(); // Deliberate driver-loss simulation at the engine boundary.
      await lost;
      const recovered = await renderer.prepareViewport(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      const canvas = document.createElement("canvas");
      recovered.present(canvas);
      const pixel = [
        ...canvas.getContext("2d")!.getImageData(20, 20, 1, 1).data,
      ];
      recovered.dispose();
      return {
        initialBackend,
        shadowBackend,
        budgetBackend,
        recoveredBackend: recovered.backend,
        pixel,
        unchanged: unchanged === JSON.stringify(doc.toJSON()),
        retained: renderer.gpu.diagnostics.retainedBytes,
      };
    } finally {
      renderer.dispose();
    }
  });
  expect(result).toMatchObject({
    initialBackend: "webgpu",
    shadowBackend: "canvas2d",
    budgetBackend: "canvas2d",
    recoveredBackend: "canvas2d",
    pixel: [255, 0, 0, 255],
    unchanged: true,
    retained: 0,
  });
});

test("subpixel brushes use the reference path without losing faint marks", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/adaptive.ts";
    const { AdaptiveRenderer } = await import(path);
    const { editor, Document, PaintLayer, BrushStroke } = window.luma;
    const renderer = new AdaptiveRenderer({ allowSoftwareAdapter: true });
    const doc = new Document({ width: 16, height: 16 });
    const layer = doc.layers.add(new PaintLayer());
    layer.strokes.add(
      new BrushStroke({ points: [{ x: 8.5, y: 8.5 }], size: 0.5, hardness: 1 }),
    );
    try {
      const frame = await renderer.prepareViewport(
        doc.getSnapshot().document,
        editor.assetStore,
      );
      const canvas = document.createElement("canvas");
      frame.present(canvas);
      const alpha = canvas.getContext("2d")!.getImageData(8, 8, 1, 1).data[3];
      frame.dispose();
      return { backend: frame.backend, alpha };
    } finally {
      renderer.dispose();
    }
  });
  expect(result.backend).toBe("canvas2d");
  expect(result.alpha).toBeGreaterThan(0);
});

test("GPU presentation pipeline writes the canvas format without a CPU readback", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const { editor, Document, PaintLayer, PaintFill } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error(JSON.stringify(gpu.diagnostics));
    const doc = new Document({ width: 32, height: 32 });
    doc.layers
      .add(new PaintLayer())
      .strokes.add(
        new PaintFill({
          bounds: { x: 0, y: 0, width: 32, height: 32 },
          color: "#336699",
        }),
      );
    const frame = await gpu.prepare(
      doc.getSnapshot().document,
      editor.assetStore,
    );
    if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
    const device: GPUDevice = gpu.device;
    const format = navigator.gpu.getPreferredCanvasFormat();
    // Real shader/pipeline/texture; only the browser-owned swapchain surface is
    // substituted because this headless software adapter cannot present one.
    const target = device.createTexture({
      size: [32, 32],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const canvas = document.createElement("canvas");
    let configurations = 0;
    const context = {
      configure() {
        configurations++;
      },
      getCurrentTexture() {
        return target;
      },
    };
    Object.defineProperty(canvas, "getContext", { value: () => context });
    const buffer = device.createBuffer({
      size: 256 * 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    try {
      device.pushErrorScope("validation");
      frame.present(canvas);
      frame.present(canvas);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer(
        { texture: target },
        { buffer, bytesPerRow: 256 },
        [32, 32],
      );
      device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      const pixel = [...new Uint8Array(buffer.getMappedRange()).slice(0, 4)];
      if (format === "bgra8unorm") [pixel[0], pixel[2]] = [pixel[2], pixel[0]];
      return {
        pixel,
        configurations,
        readbacks: gpu.diagnostics.readbacks,
        error: (await device.popErrorScope())?.message ?? null,
      };
    } finally {
      frame.dispose();
      buffer.destroy();
      target.destroy();
      gpu.dispose();
    }
  });
  expect(result).toEqual({
    pixel: [51, 102, 153, 255],
    configurations: 1,
    readbacks: 0,
    error: null,
  });
});
