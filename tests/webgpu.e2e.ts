import { test, expect } from "@playwright/test";
import {writeFile} from 'node:fs/promises';

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

test("GPU reference uploads preserve a complete layer matrix without double transformation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const gpuPath = "/src/engine/gpu/renderer.ts",
      matrixPath = "/src/core/affine.ts",
      assetPath = "/src/core/assets.ts";
    const { WebGpuRenderer } = await import(gpuPath),
      { AffineTransform } = await import(matrixPath),
      { AssetStore } = await import(assetPath);
    const { editor, Document, VectorLayer, VectorPath } = window.luma;
    const assets = new AssetStore(),
      doc = new Document({ width: 64, height: 64 });
    const layer = doc.layers.add(new VectorLayer({ x: 500, y: 600 }));
    layer.paths.add(
      new VectorPath({
        closed: true,
        fill: "#ffffff",
        stroke: null,
        points: [
          { x: 0, y: 0 },
          { x: 15, y: 0 },
          { x: 0, y: 20 },
        ],
      }),
    );
    layer.transform = new AffineTransform(2, 0.4, 0.2, 3, 500, 600);
    const matrix = new AffineTransform(0, 1, -1, 0.3, 35, 10);
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error("WebGPU unavailable");
    const space = { x: 0, y: 0, width: 64, height: 64, sx: 1, sy: 1 };
    try {
      const surface = await gpu.reference(
        layer.toJSON(),
        doc.toJSON(),
        assets,
        space,
        0,
        0,
        matrix,
      );
      const expected = document.createElement("canvas");
      expected.width = expected.height = 64;
      const context = expected.getContext("2d")!;
      context.setTransform(0, 1, -1, 0.3, 35, 10);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(15,0);
      context.lineTo(0,20);
      context.lineTo(0,0);
      context.closePath();
      context.fillStyle = "white";
      context.fill();
      const reference = context.getImageData(0, 0, 64, 64).data;
      const device = gpu.device,
        buffer = device.createBuffer({
          size: 16384,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: surface.texture },
          { buffer, bytesPerRow: 256 },
          [64, 64],
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const actual = new Uint8Array(buffer.getMappedRange());
        let max = 0,
          coverage = 0;
        for (let i = 3; i < actual.length; i += 4) {
          max = Math.max(max, Math.abs(actual[i] - reference[i]));
          coverage += actual[i];
        }
        return { max, coverage };
      } finally {
        buffer.destroy();
      }
    } finally {
      gpu.dispose();
    }
  });
  expect(result.max).toBe(0);
  expect(result.coverage).toBeGreaterThan(0);
});

test("GPU mask uploads preserve affine coverage and invalidate on matrix changes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const gpuPath = "/src/engine/gpu/renderer.ts",
      matrixPath = "/src/core/affine.ts";
    const { WebGpuRenderer } = await import(gpuPath);
    const { AffineTransform } = await import(matrixPath);
    const { editor, LayerMask, MarqueeSelection } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error("WebGPU unavailable");
    const mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 12,
        height: 20,
      }),
    }).toJSON();
    const space = { x: 0, y: 0, width: 64, height: 64, sx: 1, sy: 1 };
    const first = new AffineTransform(0, 1, -1, 0, 30, 5);
    const second = new AffineTransform(1, 0.5, 0.2, 1, 30, 5);
    try {
      const a = await gpu.layerMask("fixture", mask, space, first);
      const reused = await gpu.layerMask("fixture", mask, space, first);
      const changed = await gpu.layerMask("fixture", mask, space, second);
      const reference = await editor.renderer.renderMaskCoverage(
        mask,
        space,
        0,
        0,
        "reference",
        false,
        second,
      );
      const expected = reference
        .getContext("2d")!
        .getImageData(0, 0, 64, 64).data;
      const device = gpu.device;
      const buffer = device.createBuffer({
        size: 64 * 64 * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: changed.texture },
          { buffer, bytesPerRow: 256 },
          [64, 64],
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const actual = new Uint8Array(buffer.getMappedRange());
        let maxAlpha = 0,
          coverage = 0;
        for (let i = 3; i < actual.length; i += 4) {
          maxAlpha = Math.max(maxAlpha, Math.abs(actual[i] - expected[i]));
          coverage += actual[i];
        }
        return {
          reused: a === reused,
          changed: a !== changed,
          maxAlpha,
          coverage,
        };
      } finally {
        buffer.destroy();
        reference.width = 0;
      }
    } finally {
      gpu.dispose();
    }
  });
  expect(result.reused).toBe(true);
  expect(result.changed).toBe(true);
  expect(result.maxAlpha).toBe(0);
  expect(result.coverage).toBeGreaterThan(0);
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
    doc.layers.add(new PaintLayer()).strokes.add(
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

test("GPU layer masks match Canvas for nested groups, holes, inversion and density", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const {
      editor,
      Document,
      LayerGroup,
      PaintLayer,
      PaintFill,
      LayerMask,
      MarqueeSelection,
      TextLayer,
      VectorPath,
      BrushStroke,
      PencilStroke,
    } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    const ready = await gpu.ready;
    if (!ready) return { ready, differences: [] };
    const doc = new Document({ width: 160, height: 120 });
    const group = doc.layers.add(new LayerGroup({ x: 8, y: 4 }));
    const layer = group.layers.add(new PaintLayer({ x: 3, y: 2 }));
    layer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 140, height: 110 },
        color: "#e49245",
      }),
    );
    const shape = new MarqueeSelection({
      shape: "ellipse",
      x: 10,
      y: 10,
      width: 100,
      height: 90,
    }).combine(
      new MarqueeSelection({
        shape: "rectangle",
        x: 35,
        y: 20,
        width: 15,
        height: 60,
      }),
      "subtract",
    );
    group.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 20,
        width: 130,
        height: 65,
      }),
      density: 0.7,
    });
    const text = group.layers.add(
      new TextLayer({ text: "Mask", x: 20, y: 40, fontSize: 20 }),
    );
    text.mask = new LayerMask({ selection: shape, density: 0.5 });
    const differences: number[] = [];
    try {
      const paths = [
        new VectorPath({
          closed: true,
          points: [
            { x: 10, y: 50, in: { x: 10, y: 5 }, out: { x: 10, y: 100 } },
            { x: 110, y: 50, in: { x: 110, y: 100 }, out: { x: 110, y: 5 } },
          ],
        }),
        new VectorPath({
          closed: true,
          points: [
            { x: 40, y: 30 },
            { x: 70, y: 30 },
            { x: 70, y: 70 },
            { x: 40, y: 70 },
          ],
        }),
      ];
      for (const kind of ["selection", "evenodd", "nonzero", "paint"] as const)
        for (const refined of [false, true])
          for (const feather of [0, 9.5])
            for (const inverted of [false, true])
              for (const density of [0, 0.4, 1]) {
                layer.mask =
                  kind === "paint"
                    ? new LayerMask({ base: 1, inverted, density, feather })
                        .paint(
                          new BrushStroke({
                            points: [
                              { x: 30, y: 20 },
                              { x: 85, y: 80 },
                            ],
                            size: 40,
                            opacity: 0.7,
                            clip: shape,
                          }),
                          "hide",
                        )
                        .paint(
                          new PencilStroke({
                            points: [{ x: 55, y: 50 }],
                            size: 10,
                          }),
                          "reveal",
                        )
                    : kind === "selection"
                      ? new LayerMask({
                          selection: shape,
                          inverted,
                          density,
                          feather,
                        })
                      : new LayerMask({
                          paths,
                          fillRule: kind,
                          inverted,
                          density,
                          feather,
                        });
                if (refined)
                  layer.mask = layer.mask
                    .paint(
                      new BrushStroke({
                        points: [
                          { x: 25, y: 25 },
                          { x: 95, y: 70 },
                        ],
                        size: 20,
                        opacity: 0.7,
                      }),
                      "hide",
                    )
                    .paint(
                      new PencilStroke({ points: [{ x: 80, y: 40 }], size: 6 }),
                      "reveal",
                    );
                layer.mask = layer.mask.with({
                  linked: kind !== "nonzero",
                  x: 7,
                  y: -3,
                });
                const frame = await gpu.prepare(
                  doc.getSnapshot().document,
                  editor.assetStore,
                );
                if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
                const actual = await frame.readPixels();
                frame.dispose();
                if (kind !== "selection" && density > 0) {
                  const uploads = gpu.diagnostics.uploads;
                  const repeated = await gpu.prepare(
                    doc.getSnapshot().document,
                    editor.assetStore,
                  );
                  if (!repeated)
                    throw new Error("Repeated vector mask frame unavailable");
                  repeated.dispose();
                  if (gpu.diagnostics.uploads !== uploads)
                    throw new Error(
                      "Unchanged vector mask coverage was uploaded again",
                    );
                }
                const canvas = await editor.renderer.render(
                  doc.toJSON(),
                  editor.assetStore,
                  { cache: false },
                );
                const expected = canvas
                  .getContext("2d")!
                  .getImageData(0, 0, 160, 120).data;
                let maxAlpha = 0;
                for (let i = 0; i < expected.length; i += 4) {
                  maxAlpha = Math.max(
                    maxAlpha,
                    Math.abs(actual[i + 3] - expected[i + 3]),
                  );
                  // GPU readback is premultiplied; Canvas ImageData is straight RGBA.
                  for (let c = 0; c < 3; c++)
                    maxAlpha = Math.max(
                      maxAlpha,
                      Math.abs(
                        actual[i + c] -
                          (expected[i + c] * expected[i + 3]) / 255,
                      ),
                    );
                }
                differences.push(maxAlpha);
                canvas.width = canvas.height = 1;
              }
      return { ready, differences };
    } finally {
      gpu.dispose();
    }
  });
  expect(result.ready).toBe(true);
  expect(result.differences).toHaveLength(96);
  for (const difference of result.differences)
    expect(difference).toBeLessThanOrEqual(2);
});

test("GPU transient mask previews preserve source textures and match committed coverage", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts",
      { WebGpuRenderer } = await import(path);
    const {
      editor,
      Document,
      LayerGroup,
      PaintLayer,
      TextLayer,
      PaintFill,
      LayerMask,
      BrushStroke,
    } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready))
      return { ready: false, differences: [], uploads: [] };
    const differences: number[] = [],
      uploads: number[] = [];
    try {
      for (const kind of ["group", "text", "paint"] as const)
        for (const mode of ["hide", "reveal"] as const) {
          const doc = new Document({ width: 180, height: 100 });
          const parent = doc.layers.add(new LayerGroup({ x: 4, y: 3 }));
          const paint = parent.layers.add(new PaintLayer());
          paint.strokes.add(
            new PaintFill({
              bounds: { x: 0, y: 0, width: 170, height: 90 },
              color: "#ee8866",
            }),
          );
          const text = parent.layers.add(
            new TextLayer({ text: "Mask", fontSize: 50 }),
          );
          const target =
            kind === "group" ? parent : kind === "text" ? text : paint;
          target.mask = new LayerMask({
            base: mode === "hide" ? 1 : 0,
            feather: 4,
          });
          const stroke = new BrushStroke({
            points: [
              { x: 30, y: 30 },
              { x: 120, y: 60 },
            ],
            size: 45,
            opacity: 0.6,
          });
          const read = async (paintPreview?: unknown) => {
            const frame = await gpu.prepare(
              doc.getSnapshot().document,
              editor.assetStore,
              { paintPreview },
            );
            if (!frame) throw Error(JSON.stringify(gpu.diagnostics));
            try {
              return await frame.readPixels();
            } finally {
              frame.dispose();
            }
          };
          const initial = await read(),
            before = gpu.diagnostics.uploads;
          const preview = await read({
            layerId: target.id,
            stroke: stroke.toJSON(),
            maskMode: mode,
          });
          uploads.push(gpu.diagnostics.uploads - before);
          let changed = false;
          for (let i = 0; i < initial.length; i++)
            if (initial[i] !== preview[i]) changed = true;
          if (!changed) throw Error("Mask preview was not visible");
          target.mask = target.mask!.paint(stroke, mode);
          const beforeCommit = gpu.diagnostics.uploads,
            committed = await read();
          uploads.push(gpu.diagnostics.uploads - beforeCommit);
          let max = 0;
          for (let i = 0; i < preview.length; i++)
            max = Math.max(max, Math.abs(preview[i] - committed[i]));
          differences.push(max);
        }
      return { ready: true, differences, uploads };
    } finally {
      gpu.dispose();
    }
  });
  expect(result.ready).toBe(true);
  expect(result.differences).toEqual(Array(6).fill(0));
  expect(result.uploads).toEqual(
    Array.from({ length: 6 }, () => [1, 0]).flat(),
  );
});

test("GPU AdjustmentLayer HSL, master levels, tone, and fallback curves agree with the reference renderer and preserve backdrop alpha", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/engine/gpu/renderer.ts";
    const { WebGpuRenderer } = await import(path);
    const { editor, Document, RasterLayer, AdjustmentLayer } = window.luma;
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error(JSON.stringify(gpu.diagnostics));

    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const c = canvas.getContext("2d")!;
    // Create a half-transparent backdrop: left alpha 0, center alpha 0.5, right alpha 1
    const imgData = c.createImageData(64, 48);
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 64; x++) {
        const idx = (y * 64 + x) * 4;
        imgData.data[idx] = (x * 4) % 256;
        imgData.data[idx + 1] = (y * 5) % 256;
        imgData.data[idx + 2] = ((x + y) * 3) % 256;
        imgData.data[idx + 3] = x < 20 ? 0 : x < 40 ? 128 : 255;
      }
    }
    c.putImageData(imgData, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const asset = await editor.assetStore.add(blob, "backdrop");

    const doc = new Document({ width: 64, height: 48 });
    doc.layers.add(
      new RasterLayer({
        assetId: asset.id,
        width: 64,
        height: 48,
      }),
    );
    const adj = doc.layers.add(new AdjustmentLayer());

    const compare = async () => {
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
        .getImageData(0, 0, 64, 48).data;
      let maxDiff = 0,
        totalDiff = 0,
        alphaMismatch = 0;
      for (let i = 0; i < expected.length; i += 4) {
        const deltaA = Math.abs(actual[i + 3] - expected[i + 3]);
        if (deltaA > 0) alphaMismatch++;
        const a = expected[i + 3] / 255;
        for (let ch = 0; ch < 3; ch++) {
          // WebGPU textures store premultiplied RGB; 2D canvas getImageData returns straight RGB
          const expectedPremul = Math.round(expected[i + ch] * a);
          const delta = Math.abs(actual[i + ch] - expectedPremul);
          maxDiff = Math.max(maxDiff, delta);
          totalDiff += delta;
        }
        totalDiff += deltaA;
      }
      reference.width = reference.height = 0;
      return { maxDiff, meanDiff: totalDiff / expected.length, alphaMismatch };
    };

    // Test 1: Tone adjustment
    adj.setTone({ exposure: 0.4, contrast: 20, saturation: -30 });
    const toneResult = await compare();

    // Test 2: Master Levels adjustment
    adj.setLevels({
      inputBlack: 15,
      inputWhite: 235,
      gamma: 1.15,
      outputBlack: 25,
      outputWhite: 240,
    });
    const levelsResult = await compare();

    const blendResults = [];
    for (const mode of ["normal", "multiply", "screen", "color"] as const) {
      adj.blendMode = mode;
      adj.styles.update({
        blendIf: {
          enabled: true,
          source: [10, 40, 130, 180],
          underlying: [0, 20, 210, 255],
        },
      });
      blendResults.push(await compare());
    }
    adj.blendMode = "normal";
    adj.styles.update({ blendIf: { enabled: false } });

    const hslResults = [];
    for (const hue of [-180, -120, 0, 60, 180]) {
      for (const opacity of [1, 0.5]) {
        adj.adjustment = { kind: "hsl", hue, saturation: 35, lightness: -15 };
        adj.opacity = opacity;
        hslResults.push(await compare());
      }
    }
    const { LayerMask, MarqueeSelection } = window.luma;
    adj.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 8,
        y: 8,
        width: 40,
        height: 24,
      }),
    });
    hslResults.push(await compare());
    adj.mask = null;
    adj.opacity = 1;

    // Test 3: Curves adjustment (cleanly falls back to Canvas reference renderer)
    adj.setCurves([
      { x: 0, y: 0 },
      { x: 64, y: 32 },
      { x: 192, y: 224 },
      { x: 255, y: 255 },
    ]);
    const curvesGpuFrame = await gpu.prepare(
      doc.getSnapshot().document,
      editor.assetStore,
    );
    const curvesFallsBack = curvesGpuFrame === null;

    const adaptivePath = "/src/engine/adaptive.ts";
    const { AdaptiveRenderer } = await import(adaptivePath);
    const adaptive = new AdaptiveRenderer({ allowSoftwareAdapter: true });
    await adaptive.gpu.ready;
    const adaptiveFrame = await adaptive.prepareViewport(
      doc.getSnapshot().document,
      editor.assetStore,
    );
    const adaptiveBackend = adaptiveFrame.backend;
    adaptiveFrame.dispose();
    adaptive.dispose();

    gpu.dispose();
    return {
      toneResult,
      levelsResult,
      blendResults,
      hslResults,
      curvesFallsBack,
      adaptiveBackend,
    };
  });

  expect(result.toneResult.alphaMismatch).toBe(0);
  expect(result.toneResult.maxDiff).toBeLessThanOrEqual(2);
  expect(result.toneResult.meanDiff).toBeLessThan(1);

  expect(result.levelsResult.alphaMismatch).toBe(0);
  expect(result.levelsResult.maxDiff).toBeLessThanOrEqual(3);
  expect(result.levelsResult.meanDiff).toBeLessThan(1);

  for (const comparison of result.blendResults) {
    expect(comparison.alphaMismatch).toBe(0);
    expect(comparison.maxDiff).toBeLessThanOrEqual(4);
  }
  for (const comparison of result.hslResults) {
    expect(comparison.alphaMismatch).toBe(0);
    expect(comparison.maxDiff).toBeLessThanOrEqual(3);
    expect(comparison.meanDiff).toBeLessThan(1);
  }
  expect(result.curvesFallsBack).toBe(true);
  expect(result.adaptiveBackend).toBe("canvas2d");
});

test("GPU affine brush and pencil stamps preserve clips, pressure, cache invalidation and incremental replay", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { WebGpuRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/gpu/renderer.ts")
    );
    const { AffineTransform } = await import(
      /* @vite-ignore */ String("/src/core/affine.ts")
    );
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const {
      editor,
      Document,
      PaintLayer,
      BrushStroke,
      PencilStroke,
      MarqueeSelection,
    } = window.luma;
    const renderer = new CanvasRenderer();
    const gpu = new WebGpuRenderer(renderer, { allowSoftwareAdapter: true });
    if (!(await gpu.ready)) throw new Error("WebGPU unavailable");
    const doc = new Document({ width: 64, height: 64 });
    const layer = doc.layers.add(new PaintLayer());
    const space = { x: 1e12, y: -1e12, width: 64, height: 64, sx: 1, sy: 1 };
    const matrices = [
      new AffineTransform(0, 1, -1, 0, space.x + 45, space.y + 5),
      new AffineTransform(-1.2, 0.3, 0.4, 0.8, space.x + 42, space.y + 10),
    ];
    const read = async (surface: any) => {
      const device = gpu.device;
      const buffer = device.createBuffer({
        size: 16384,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture: surface.texture },
          { buffer, bytesPerRow: 256 },
          [64, 64],
        );
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        return new Uint8Array(buffer.getMappedRange()).slice();
      } finally {
        buffer.destroy();
      }
    };
    const cases = [];
    try {
      for (const kind of ["brush", "pencil"])
        for (const world of matrices) {
          const Constructor = kind === "brush" ? BrushStroke : PencilStroke;
          const stroke = new Constructor({
            size: 12,
            hardness: 0.55,
            color: "#ffffff",
            opacity: 1,
            flow: 0.6,
            pressureSize: false,
            pressureOpacity: true,
            points: [
              { x: 6, y: 8, pressure: 0.3 },
              { x: 14, y: 14, pressure: 0.8 },
              { x: 22, y: 18, pressure: 0.5 },
            ],
            clip: new MarqueeSelection({
              shape: "ellipse",
              x: 3,
              y: 4,
              width: 22,
              height: 23,
            }),
          }).toJSON();
          if (stroke.kind === "fill")
            throw new Error("Expected a brush stroke");
          const prefix = { ...stroke, points: stroke.points.slice(0, 2) };
          gpu.stroke(prefix, space, 0, 0, true, world);
          const appended = await read(
            gpu.stroke(stroke, space, 0, 0, true, world),
          );
          const stampsBefore = gpu.diagnostics.stamps;
          const repeated = await read(
            gpu.stroke(stroke, space, 0, 0, true, world),
          );
          const stampsAfter = gpu.diagnostics.stamps;
          const full = await read(
            gpu.stroke(stroke, space, 0, 0, false, world),
          );
          const data = { ...layer.toJSON(), strokes: [stroke] };
          const reference = await renderer.render(
            { ...doc.toJSON(), children: [data] },
            editor.assetStore,
            {
              region: { x: space.x, y: space.y, width: 64, height: 64 },
              rootTransform: world,
              cache: false,
              readback: true,
            },
          );
          const expected = reference
            .getContext("2d")!
            .getImageData(0, 0, 64, 64).data;
          let max = 0,
            sum = 0,
            coverage = 0;
          for (let i = 3; i < expected.length; i += 4) {
            const delta = Math.abs(full[i] - expected[i]);
            max = Math.max(max, delta);
            sum += delta;
            coverage += full[i];
          }
          const changed = world.multiply(AffineTransform.rotation(0.3));
          const transformed = await read(
            gpu.stroke(stroke, space, 0, 0, true, changed),
          );
          cases.push({
            kind,
            max,
            mean: sum / 4096,
            coverage,
            appendEqual: appended.every((v, i) => v === full[i]),
            repeatEqual: repeated.every((v, i) => v === full[i]),
            newStamps: stampsAfter - stampsBefore,
            changed: transformed.some((v, i) => v !== full[i]),
          });
          reference.width = reference.height = 0;
        }
      let subpixel = "";
      try {
        gpu.stroke(
          new BrushStroke({ size: 4, points: [{ x: 10, y: 10 }] }).toJSON(),
          space,
          0,
          0,
          false,
          new AffineTransform(0.01, 0, 0, 1, space.x + 20, space.y + 20),
        );
      } catch (e) {
        subpixel = String(e);
      }
      return { cases, subpixel };
    } finally {
      gpu.dispose();
      renderer.dispose();
    }
  });
  for (const result of results.cases) {
    expect(result.coverage).toBeGreaterThan(0);
    expect(result.appendEqual, JSON.stringify(result)).toBe(true);
    expect(result.repeatEqual).toBe(true);
    expect(result.newStamps).toBe(0);
    expect(result.changed).toBe(true);
    expect(result.mean, JSON.stringify(result)).toBeLessThan(0.5);
    expect(result.max, JSON.stringify(result)).toBeLessThanOrEqual(24);
  }
  expect(results.subpixel).toContain("reference coverage");
});

test("GPU eraser preview and commit remove existing paint with pressure, flow and one-step undo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { WebGpuRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/gpu/renderer.ts")
    );
    const { EraserStroke } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    const { editor, Document, PaintLayer, PaintFill, MarqueeSelection } =
      window.luma;
    const doc = new Document({ width: 64, height: 64 });
    const paint = doc.layers.add(new PaintLayer());
    paint.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 64, height: 64 },
        color: "#ffffff",
      }),
    );
    const stroke = new EraserStroke({
      size: 20,
      hardness: 1,
      opacity: 0.7,
      flow: 0.65,
      pressureSize: false,
      pressureOpacity: true,
      points: [
        { x: 20, y: 30, pressure: 0.3 },
        { x: 36, y: 30, pressure: 0.8 },
      ],
      clip: new MarqueeSelection({
        shape: "rectangle",
        x: 24,
        y: 0,
        width: 40,
        height: 64,
      }),
    });
    const gpu = new WebGpuRenderer(editor.renderer, {
      allowSoftwareAdapter: true,
    });
    if (!(await gpu.ready)) throw new Error("WebGPU unavailable");
    const read = async (options = {}) => {
      const frame = await gpu.prepare(doc.toJSON(), editor.assetStore, options);
      if (!frame) throw new Error(JSON.stringify(gpu.diagnostics));
      try {
        return await frame.readPixels();
      } finally {
        frame.dispose();
      }
    };
    try {
      const preview = await read({
        paintPreview: { layerId: paint.id, stroke: stroke.toJSON() },
      });
      paint.strokes.add(stroke);
      const committed = await read();
      const reference = await editor.renderer.render(
        doc.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const expected = reference
        .getContext("2d")!
        .getImageData(0, 0, 64, 64).data;
      let max = 0,
        sum = 0,
        worst: number[] = [];
      for (let i = 3; i < expected.length; i += 4) {
        const delta = Math.abs(expected[i] - committed[i]);
        if (delta > max)
          worst = [
            (i >> 2) % 64,
            Math.floor((i >> 2) / 64),
            committed[i],
            expected[i],
          ];
        max = Math.max(max, delta);
        sum += delta;
      }
      // Independently integrate circular area at the worst edge pixel. Canvas and
      // WGSL use different hard-edge rasterizers; geometry must still be correct.
      const { visitStrokeStamps } = await import(
        /* @vite-ignore */ String("/src/engine/drawing.ts")
      );
      let coverage = 0;
      visitStrokeStamps(
        (point: { x: number; y: number; pressure: number }) => {
          let hits = 0;
          for (let y = 0; y < 64; y++)
            for (let x = 0; x < 64; x++) {
              if (
                (37 + (x + 0.5) / 64 - point.x) ** 2 +
                  (39 + (y + 0.5) / 64 - point.y) ** 2 <=
                100
              )
                hits++;
            }
          const alpha = (hits / 4096) * 0.65 * point.pressure;
          coverage = alpha + coverage * (1 - alpha);
        },
        stroke.toJSON(),
        { x: 0, y: 0, width: 64, height: 64 },
      );
      const independentAlpha = Math.round(255 * (1 - coverage * 0.7));
      doc.undo();
      const undone = await read();
      return {
        previewMatches: preview.every(
          (v: number, i: number) => v === committed[i],
        ),
        max,
        worst,
        independentAlpha,
        edgeAlpha: committed[(39 * 64 + 37) * 4 + 3],
        mean: sum / 4096,
        center: committed[(30 * 64 + 32) * 4 + 3],
        protected: committed[(30 * 64 + 20) * 4 + 3],
        undoOpaque: undone.every((v: number) => v === 255),
      };
    } finally {
      gpu.dispose();
    }
  });
  expect(result.previewMatches).toBe(true);
  expect(result.center).toBeLessThan(200);
  expect(result.protected).toBe(255);
  expect(
    Math.abs(result.edgeAlpha - result.independentAlpha),
  ).toBeLessThanOrEqual(2);
  // Hard-edge Canvas rasterization differs from integrated circular coverage.
  expect(result.max, JSON.stringify(result)).toBeLessThanOrEqual(40);
  expect(result.mean).toBeLessThan(0.5);
  expect(result.undoOpaque).toBe(true);
});

test("GPU text textures refresh after a late font load without changing the document", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { AdaptiveRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/adaptive.ts")
    );
    const { editor, Document, TextLayer } = window.luma;
    const renderer = new AdaptiveRenderer({ allowSoftwareAdapter: true });
    if (!(await renderer.gpu.ready)) throw new Error("WebGPU unavailable");
    const doc = new Document({ width: 400, height: 120 });
    doc.layers.add(
      new TextLayer({
        text: "iiii WWWW",
        fontFamily: "Luma GPU Late Font",
        fontSize: 32,
        x: 10,
        y: 10,
      }),
    );
    const before = JSON.stringify(doc.toJSON()),
      history = doc.getSnapshot().past.length;
    const read = async () => {
      const frame = await renderer.prepareViewport(
        doc.toJSON(),
        editor.assetStore,
      );
      try {
        if (frame.backend !== "webgpu" || !frame.readPixels)
          throw new Error("Expected a real GPU frame");
        return await frame.readPixels();
      } finally {
        frame.dispose();
      }
    };
    const face = new FontFace(
      "Luma GPU Late Font",
      "url(/node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2)",
    );
    try {
      const fallback = await read();
      await read();
      const loaded = new Promise<void>((resolve) =>
        document.fonts.addEventListener("loadingdone", () => resolve(), {
          once: true,
        }),
      );
      document.fonts.add(face);
      await document.fonts.load('32px "Luma GPU Late Font"');
      await loaded;
      const refreshed = await read();
      renderer.clearCache();
      const uncached = await read();
      const reference = await renderer.render(doc.toJSON(), editor.assetStore, {
        cache: false,
        readback: true,
      });
      const expected = reference
        .getContext("2d")!
        .getImageData(0, 0, 400, 120).data;
      let max = 0;
      for (let i = 0; i < expected.length; i += 4) {
        for (let c = 0; c < 3; c++)
          max = Math.max(
            max,
            Math.abs(
              refreshed[i + c] -
                Math.round((expected[i + c] * expected[i + 3]) / 255),
            ),
          );
        max = Math.max(max, Math.abs(refreshed[i + 3] - expected[i + 3]));
      }
      reference.width = reference.height = 0;
      return {
        changed: refreshed.some(
          (value: number, index: number) => value !== fallback[index],
        ),
        equal: refreshed.every(
          (value: number, index: number) => value === uncached[index],
        ),
        max,
        unchanged: JSON.stringify(doc.toJSON()) === before,
        history: doc.getSnapshot().past.length - history,
      };
    } finally {
      renderer.dispose();
      document.fonts.delete(face);
    }
  });
  expect(result).toMatchObject({
    changed: true,
    equal: true,
    unchanged: true,
    history: 0,
  });
  expect(result.max).toBeLessThanOrEqual(1);
});

test('cancelled GPU reference work recovers without presenting obsolete pixels', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { AdaptiveRenderer } = await import(/* @vite-ignore */ String('/src/engine/adaptive.ts'));
    const { Document, PaintLayer, PaintFill, editor } = window.luma;
    const renderer = new AdaptiveRenderer({ allowSoftwareAdapter: true });
    const ready = await renderer.gpu.ready;
    if (!ready) { renderer.dispose(); return { ready }; }
    const doc = new Document({ width: 64, height: 64 });
    const layer = doc.layers.add(new PaintLayer());
    layer.strokes.add(new PaintFill({ bounds: { x: 0, y: 0, width: 64, height: 64 }, color: '#207040' }));
    let cancelled = false, aborted = false;
    const render = renderer.render.bind(renderer);
    // Cancel when an actual Canvas reference upload has finished preparation.
    renderer.render = async (...args: Parameters<typeof render>) => {
      const canvas = await render(...args);
      cancelled = true;
      return canvas;
    };
    try {
      try { const frame = await renderer.prepareViewport(doc.getSnapshot().document, editor.assetStore, { isCancelled: () => cancelled }); frame.dispose(); }
      catch (error) { aborted = error instanceof DOMException && error.name === 'AbortError'; }
      renderer.render = render;
      const frame = await renderer.prepareViewport(doc.getSnapshot().document, editor.assetStore);
      const backend = frame.backend;
      if (!frame.readPixels) throw new Error('GPU readback unavailable');
      const pixels = await frame.readPixels();
      const offset = (20 * 64 + 20) * 4;
      const pixel = [...pixels.slice(offset, offset + 4)];
      frame.dispose();
      return { ready, aborted, backend, pixel, state: renderer.gpu.diagnostics.state };
    } finally { renderer.dispose(); }
  });
  expect(result).toEqual({ ready: true, aborted: true, backend: 'webgpu', pixel: [32,112,64,255], state: 'ready' });
});

test('GPU numeric replay failure releases buffers and recovers a valid frame',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')),{editor,Document,PaintLayer,BrushStroke,PaintFill}=window.luma,gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error('WebGPU unavailable');
  const buffers:{buffer:GPUBuffer;destroyed:boolean}[]=[],device=gpu.device!,create=device.createBuffer.bind(device);
  device.createBuffer=(descriptor:GPUBufferDescriptor)=>{const buffer=create(descriptor),destroy=buffer.destroy.bind(buffer),record={buffer,destroyed:false};buffers.push(record);buffer.destroy=()=>{record.destroyed=true;destroy();};return buffer;};
  const doc=new Document({width:64,height:64}),paint=doc.layers.add(new PaintLayer());paint.strokes.add(new BrushStroke({points:[{x:-9e15,y:32},{x:9e15,y:32}],size:2}));const before=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision;
  try{
   const frame=await gpu.prepare(doc.toJSON(),editor.assetStore),reason=gpu.diagnostics.reason,allocated=buffers.length,retained=buffers.filter(record=>!record.destroyed).length,retainedBytes=gpu.diagnostics.retainedBytes;frame?.dispose();
   const retry=new Document({width:64,height:64}),layer=retry.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#207040'}));const recovered=await gpu.prepare(retry.toJSON(),editor.assetStore);if(!recovered)throw new Error(JSON.stringify(gpu.diagnostics));const backend=recovered.backend,pixels=await recovered.readPixels(),pixel=Array.from(pixels.slice((20*64+20)*4,(20*64+20)*4+4));recovered.dispose();
   return{rejected:!frame,reason,allocated,retained,retainedBytes,backend,pixel,unchanged:before===JSON.stringify(doc.toJSON()),revision,after:doc.getSnapshot().revision};
  }finally{device.createBuffer=create;for(const record of buffers)record.buffer.destroy();gpu.dispose();}
 });expect(result.rejected).toBe(true);expect(result.reason).toContain('numeric precision');expect(result.allocated).toBeGreaterThan(0);expect(result.retained).toBe(0);expect(result.retainedBytes).toBe(0);expect(result.backend).toBe('webgpu');expect(result.pixel).toEqual([32,112,64,255]);expect(result.unchanged).toBe(true);expect(result.revision).toBe(result.after);
 const{writeFile}=await import('node:fs/promises');await writeFile('/tmp/canoli-svg-paint-gpu-precision-final.json',JSON.stringify(result,null,2)+'\n');
});

test('GPU vector stroke reference uploads retain cap/join/dashes and invalidate only changed content',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,VectorLayer,VectorPath,LayerGroup,AffineTransform}=window.luma,doc=new Document({width:160,height:128}),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new VectorLayer()),path=layer.paths.add(VectorPath.fromSvgPath('M24 112L64 16L104 112',{fill:null,stroke:'#804020',strokeWidth:12,strokeCap:'square',strokeJoin:'miter',strokeMiterLimit:12,strokeDashArray:[24,8,4],strokeDashOffset:-7}));const point=layer.paths.add(VectorPath.fromSvgPath('M128 96L128 96',{fill:null,stroke:'#00ff00',strokeWidth:12,strokeCap:'round'}));group.transform=new AffineTransform(.9,.1,-.05,.8,10,8);const gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));
  const results=[];let before:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat'] as const){if(stage==='changed'){path.update({strokeCap:'butt',strokeJoin:'bevel',strokeDashArray:[8,4],strokeDashOffset:7});point.strokeCap='square';}const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,160,128).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(actual[i+c]-expected[i+c]*expected[i+3]/255));}results.push({stage,alpha,premult,point:Array.from(expected.slice((98*160+120)*4,(98*160+120)*4+4)),uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i])});before=new Uint8ClampedArray(actual);}return{results,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });await writeFile('/tmp/canoli-vector-stroke-gpu.json',JSON.stringify(result,null,2)+'\n');for(const r of result.results){expect(r.point).toEqual([0,255,0,255]);expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);
});

test('GPU vector gradient reference uploads retain transparent transformed paint and invalidate after stop edits',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,VectorLayer,VectorPath}=window.luma,doc=new Document({width:160,height:128}),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:16,y:16,width:128,height:96},0,{fillGradient:{kind:'radial',start:{x:80,y:64,radius:0},end:{x:80,y:64,radius:64},transform:{a:.8,b:.2,c:.3,d:1,e:0,f:-12},stops:[{position:0,color:'#ff0000',opacity:.3},{position:1,color:'#0000ff'}]},stroke:null})),gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));const results=[];let before:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat'] as const){if(stage==='changed'){const g=p.fillGradient!;g.stops[0].color='#00ff00';p.fillGradient=g;}const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,160,128).data;native.width=native.height=0;let alpha=0,premult=0,coverage=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));coverage+=expected[i+3];for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(actual[i+c]-expected[i+c]*expected[i+3]/255));}results.push({stage,alpha,premult,coverage,uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i])});before=new Uint8ClampedArray(actual);}return{results,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });const{writeFile}=await import('node:fs/promises');await writeFile('/tmp/canoli-vector-gradient-gpu.json',JSON.stringify(result,null,2)+'\n');for(const r of result.results){expect(r.coverage).toBeGreaterThan(100000);expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);
});

test('GPU compound reference uploads retain holes and islands and invalidate after contour edits',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,VectorLayer,VectorPath,VectorContour}=window.luma,doc=new Document({width:160,height:128}),layer=doc.layers.add(new VectorLayer()),p=layer.paths.add(VectorPath.rectangle({x:8,y:8,width:104,height:112},0,{fill:'#804020',stroke:null,fillRule:'evenodd'}));p.subpaths.add(new VectorContour({points:VectorPath.rectangle({x:40,y:40,width:40,height:40}).points}));p.subpaths.add(new VectorContour({points:VectorPath.rectangle({x:128,y:8,width:24,height:112}).points}));const gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));const results=[];let before:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat'] as const){if(stage==='changed')p.subpaths.at(0)!.setPoint(0,{x:64});const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,160,128).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(actual[i+c]-expected[i+c]*expected[i+3]/255));}results.push({stage,alpha,premult,hole:Array.from(actual.slice((64*160+64)*4,(64*160+64)*4+4)),island:Array.from(actual.slice((64*160+140)*4,(64*160+140)*4+4)),uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i])});before=new Uint8ClampedArray(actual);}return{results,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });await writeFile('/tmp/canoli-vector-compound-gpu.json',JSON.stringify(result,null,2)+'\n');for(const r of result.results){expect(r.hole).toEqual([0,0,0,0]);expect(r.island).toEqual([128,64,32,255]);expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);
});

test('GPU Boolean result geometry invalidates vector textures and preserves native curved cutout coverage',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,VectorLayer,VectorPath}=window.luma;editor.newDocument({width:160,height:128});const doc=editor.document,layer=doc.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:8,y:8,width:144,height:112},0,{fill:'#804020',stroke:null}));layer.paths.add(VectorPath.ellipse({x:40,y:32,width:80,height:64},{fill:'#00ff00',stroke:null}));const gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));const results=[];let before:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat'] as const){if(stage==='changed')await layer.combinePaths('subtract');const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,160,128).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let c=0;c<3;c++)premult=Math.max(premult,Math.abs(actual[i+c]-expected[i+c]*expected[i+3]/255));}results.push({stage,alpha,premult,center:[...actual.slice((64*160+80)*4,(64*160+80)*4+4)],uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i])});before=new Uint8ClampedArray(actual);}return{results,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });expect(result.results[0].center).toEqual([0,255,0,255]);for(const r of result.results){expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);}expect(result.results[1].center).toEqual([0,0,0,0]);expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);await writeFile('/tmp/canoli-vector-boolean-gpu.json',JSON.stringify(result,null,2)+'\n');
});

test('GPU typography spacing changes refresh native glyph textures and reuse unchanged output',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,TextLayer}=window.luma,doc=new Document({width:400,height:100}),text=doc.layers.add(new TextLayer({text:'AVATAR WA To',fontSize:36,fontFamily:'serif',wordSpacing:4,fontKerning:'normal',x:8,y:8,color:'#2050a0'})),gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));let before:Uint8ClampedArray|undefined;const results=[];
  try{for(const stage of ['initial','changed','repeat'] as const){if(stage==='changed')text.update({wordSpacing:18,fontKerning:'none'});const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,400,100).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(actual[i+k]-expected[i+k]*expected[i+3]/255));}results.push({stage,alpha,premult,uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i]),coverage:actual.filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0)});before=new Uint8ClampedArray(actual);}return{results,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });for(const r of result.results){expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);expect(r.coverage).toBeGreaterThan(100000);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);await writeFile('/tmp/canoli-text-spacing-gpu.json',JSON.stringify(result,null,2)+'\n');
});

test('GPU paragraph changes refresh native glyph textures, reuse repeats and restore undo',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,TextLayer}=window.luma,doc=new Document({width:400,height:240}),text=doc.layers.add(new TextLayer({text:'Paragraph text wraps into editable lines.\nSecond paragraph',fontSize:24,fontFamily:'monospace',wrapWidth:230,paragraphSpacing:9,firstLineIndent:12,x:10,y:10,color:'#2050a0'})),gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));const original=JSON.stringify(doc.toJSON());const results=[];let before:Uint8ClampedArray|undefined,initial:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat','undo'] as const){if(stage==='changed')doc.transaction('Paragraph layout',()=>{text.wrapWidth=150;text.paragraphSpacing=18;text.firstLineIndent=-6;});if(stage==='undo')doc.undo();const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,400,240).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(actual[i+k]-expected[i+k]*expected[i+3]/255));}if(!initial)initial=new Uint8ClampedArray(actual);results.push({stage,alpha,premult,uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i]),initialExact:actual.every((v,i)=>v===initial![i]),coverage:actual.filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0)});before=new Uint8ClampedArray(actual);}return{results,exactModel:JSON.stringify(doc.toJSON())===original,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });for(const r of result.results){expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);expect(r.coverage).toBeGreaterThan(100000);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);expect(result.results[3].initialExact).toBe(true);expect(result.exactModel).toBe(true);await info.attach('paragraph-gpu',{body:JSON.stringify(result),contentType:'application/json'});
});

test('GPU justification alone refreshes native glyph textures, reuses repeats and restores undo',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{WebGpuRenderer}=await import(/* @vite-ignore */String('/src/engine/gpu/renderer.ts')) as typeof import('../src/engine/gpu/renderer'),{editor,Document,TextLayer}=window.luma,doc=new Document({width:400,height:240}),text=doc.layers.add(new TextLayer({text:'Paragraph text wraps into editable lines.\nSecond paragraph',fontSize:24,fontFamily:'monospace',wrapWidth:230,paragraphJustify:'inter-word',paragraphSpacing:9,firstLineIndent:12,x:10,y:10,color:'#2050a0'})),gpu=new WebGpuRenderer(editor.renderer,{allowSoftwareAdapter:true});if(!await gpu.ready)throw new Error(JSON.stringify(gpu.diagnostics));const original=JSON.stringify(doc.toJSON());const results=[];let before:Uint8ClampedArray|undefined,initial:Uint8ClampedArray|undefined;
  try{for(const stage of ['initial','changed','repeat','undo'] as const){if(stage==='changed')doc.transaction('Justification',()=>{text.paragraphJustify='none';});if(stage==='undo')doc.undo();const frame=await gpu.prepare(doc.getSnapshot().document,editor.assetStore);if(!frame?.readPixels)throw new Error(JSON.stringify(gpu.diagnostics));const actual=await frame.readPixels();frame.dispose();const native=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),expected=native.getContext('2d')!.getImageData(0,0,400,240).data;native.width=native.height=0;let alpha=0,premult=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(actual[i+k]-expected[i+k]*expected[i+3]/255));}if(!initial)initial=new Uint8ClampedArray(actual);results.push({stage,alpha,premult,uploads:gpu.diagnostics.uploads,changed:!before||actual.some((v,i)=>v!==before![i]),initialExact:actual.every((v,i)=>v===initial![i]),coverage:actual.filter((_,i)=>i%4===3).reduce((a,b)=>a+b,0)});before=new Uint8ClampedArray(actual);}return{results,exactModel:JSON.stringify(doc.toJSON())===original,diagnostics:gpu.diagnostics};}finally{gpu.dispose();}
 });for(const r of result.results){expect(r.alpha).toBeLessThanOrEqual(2);expect(r.premult).toBeLessThanOrEqual(2);expect(r.coverage).toBeGreaterThan(100000);}expect(result.results[1].changed).toBe(true);expect(result.results[1].uploads).toBeGreaterThan(result.results[0].uploads);expect(result.results[2].changed).toBe(false);expect(result.results[2].uploads).toBe(result.results[1].uploads);expect(result.results[3].initialExact).toBe(true);expect(result.exactModel).toBe(true);await info.attach('justification-gpu',{body:JSON.stringify(result),contentType:'application/json'});
});
