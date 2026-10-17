import { test, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("rendered PSD exports masks, transforms, groups, text, paint and adjustments with independent layer recomposition", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, PaintFill, VectorLayer, VectorPath, TextLayer, LayerGroup, RasterLayer,
      AdjustmentLayer, LayerMask, MarqueeSelection, AffineTransform } = window.luma;
    const { parsePsd } = await import(/* @vite-ignore */ String("/src/core/interchange/psd/parser.ts"));
    editor.newDocument({ width: 96, height: 64 }); const doc = editor.document;
    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 18;
    const c = canvas.getContext("2d")!, image = c.createImageData(20, 18);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 20; x++) image.data.set([80, 120, 150, x < 10 ? 255 : 128], (y * 20 + x) * 4);
    c.putImageData(image, 0, 0); const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const asset = await editor.assetStore.add(blob, "Original", undefined, false), original = Array.from(new Uint8Array(await blob.arrayBuffer()));
    const source = doc.layers.add(new RasterLayer({ name: "Placed original", assetId: asset.id, width: 30, height: 27, x: -3, y: 4 }));
    source.clear(new MarqueeSelection({ shape: "rectangle", x: 0, y: 8, width: 4, height: 5 }));
    const paint = doc.layers.add(new PaintLayer({ name: "Paint" }));
    paint.strokes.add(new PaintFill({ color: "#ca7030", bounds: { x: 32, y: 2, width: 20, height: 30 } }));
    const group = doc.layers.add(new LayerGroup({ name: "Isolated shapes" }));
    const shape = group.layers.add(new VectorLayer({ name: "Shape" }));
    shape.paths.add(VectorPath.rectangle({ x: 0, y: 0, width: 16, height: 20 }, 0, { fill: "#3060d0", stroke: null }));
    shape.transform = AffineTransform.translation(48, 22).multiply(AffineTransform.rotation(17));
    group.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "ellipse", x: 40, y: 12, width: 32, height: 40 }) });
    const text = doc.layers.add(new TextLayer({ name: "Caption", text: "PSD", fontSize: 13, fontFamily: "sans-serif", color: "#42bd70", x: 54, y: 4 }));
    const settings = { kind: "gradient-map" as const, reverse: false, stops: [{ position: 0, color: "#171b46" }, { position: 1, color: "#ffe4a0" }] };
    const gradient = doc.layers.add(new AdjustmentLayer({ name: "Gradient", adjustment: settings, opacity: .7 }));
    gradient.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 50, height: 64 }) });
    const top = doc.layers.add(new PaintLayer({ name: "Top pixel layer", opacity: .6, blendMode: "multiply" }));
    top.strokes.add(new PaintFill({ color: "#b13974", bounds: { x: 14, y: 44, width: 66, height: 12 } }));
    const hidden = doc.layers.add(new PaintLayer({ name: "Hidden work", visible: false }));
    hidden.strokes.add(new PaintFill({ color: "#00ff00", bounds: { x: 0, y: 0, width: 96, height: 64 } }));
    await document.fonts.ready; const before = doc.toJSON();
    const png = await editor.exportPng(), bitmap = await createImageBitmap(png), target = document.createElement("canvas"); target.width = 96; target.height = 64;
    const ctx = target.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const expected = Array.from(ctx.getImageData(0, 0, 96, 64).data), exports = [];
    for (const mode of ["layers", "flatten"] as const) {
      const output = await editor.export({ format: "psd", psdMode: mode }), bytes = new Uint8Array(await output.blob.arrayBuffer());
      const parsed = parsePsd(bytes); let maxError = 0, alphaMismatch = 0;
      for (let i = 0; i < expected.length; i += 4) {
        if (expected[i + 3] !== parsed.composite!.data[i + 3]) alphaMismatch++;
        for (let c = 0; c < 3; c++) maxError = Math.max(maxError, Math.abs(expected[i + c] - parsed.composite!.data[i + c]) * expected[i + 3] / 255);
      }
      exports.push({ mode, bytes: Array.from(bytes), names: parsed.layers.map((layer: any) => layer.name),
        visibility: parsed.layers.map((layer: any) => layer.flags.visible), maxError, alphaMismatch, report: output.report });
    }
    return { expected, exports, unchanged: JSON.stringify(before) === JSON.stringify(doc.toJSON()), original,
      after: Array.from(new Uint8Array(await editor.assetStore.get(asset.id).blob.arrayBuffer())), text: text.text };
  });
  expect(result.unchanged).toBe(true); expect(result.original).toEqual(result.after);
  expect(result.exports[0].names).toEqual(["Merged through Gradient", "Top pixel layer", "Hidden work"]);
  expect(result.exports[0].visibility).toEqual([true, true, false]); expect(result.exports[1].names).toHaveLength(1);
  for (const output of result.exports) { expect(output.maxError).toBeLessThanOrEqual(.51); expect(output.alphaMismatch).toBe(0); }
  const directory = test.info().outputPath("independent"); await mkdir(directory, { recursive: true });
  const cases = [];
  for (const output of result.exports) {
    const path = directory + "/" + output.mode + ".psd"; await writeFile(path, new Uint8Array(output.bytes));
    cases.push({ path, width: 96, height: 64, expected: result.expected, names: output.names, visibility: output.visibility });
  }
  const manifest = directory + "/cases.json"; await writeFile(manifest, JSON.stringify(cases));
  // Optional extra dependency; the normal browser checks above always run.
  if (process.env.PSD_READER_PYTHONPATH) {
    const checked = spawnSync("python3", ["scripts/check-rendered-psd.py", manifest], {
      encoding: "utf8", timeout: 30000, env: { ...process.env, PYTHONPATH: process.env.PSD_READER_PYTHONPATH },
    });
    expect(checked.status, checked.stderr || checked.stdout).toBe(0);
    await test.info().attach("independent-psd-reader", { body: checked.stdout, contentType: "application/json" });
    console.log(checked.stdout);
  }
});

test("independent layers preserve native raster bounds, hidden content and blend keys", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer, TextLayer, PaintLayer, PaintFill } = window.luma;
    const { parsePsd } = await import(/* @vite-ignore */ String("/src/core/interchange/psd/parser.ts"));
    editor.newDocument({ width: 64, height: 48 });
    const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 6; const c = canvas.getContext("2d")!; c.fillStyle = "#f08030"; c.fillRect(0, 0, 8, 6);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!))), asset = await editor.assetStore.add(blob, "Native", undefined, false);
    editor.document.layers.add(new RasterLayer({ name: "Positioned", assetId: asset.id, width: 8, height: 6, x: -2, y: 5 }));
    const paint = editor.document.layers.add(new PaintLayer({ name: "Invisible paint", visible: false, opacity: .8, blendMode: "screen" }));
    paint.strokes.add(new PaintFill({ color: "#ff0000", bounds: { x: 1, y: 1, width: 30, height: 20 } }));
    editor.document.layers.add(new TextLayer({ name: "Editable source text", text: "Hello", fontSize: 14, x: 16, y: 20 }));
    const output = await editor.export({ format: "psd" }), parsed = parsePsd(await output.blob.arrayBuffer());
    return parsed.layers.map((layer: any) => ({ name: layer.name, rect: [layer.left, layer.top, layer.width, layer.height], visible: layer.flags.visible,
      blend: layer.blendModeKey, opacity: layer.opacity, nonempty: layer.imageData.data.some((value: number, i: number) => i % 4 === 3 && value > 0) }));
  });
  expect(result[0]).toMatchObject({ rect: [-2, 5, 8, 6], name: "Positioned", nonempty: true });
  expect(result[1]).toMatchObject({ name: "Invisible paint", visible: false, opacity: 204, blend: "scrn", nonempty: true });
  expect(result[2]).toMatchObject({ name: "Editable source text", nonempty: true });
});

test("browser import distinguishes independent merged transparency, extra alpha and the explicit legacy override", async ({ page }) => {
  const transparency = Array.from(await readFile("tests/fixtures/psd/psd-tools-transparency.psd"));
  const extra = Array.from(await readFile("tests/fixtures/psd/psd-tools-extra-alpha.psd"));
  await page.goto("/");
  const pixels = await page.evaluate(async ({ transparency, extra }) => {
    const editor = window.luma.editor, pixels = [];
    for (const [bytes, options] of [
      [transparency, { mode: "layered" }], [extra, { mode: "flatten" }], [extra, { mode: "flatten", legacyStraightAlpha: true }],
    ] as const) {
      await editor.openPsd(new Uint8Array(bytes), options);
      const image = await createImageBitmap(await editor.exportPng()), canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const c = canvas.getContext("2d")!; c.drawImage(image, 0, 0); image.close(); pixels.push(Array.from(c.getImageData(0, 0, 1, 1).data));
    }
    return pixels;
  }, { transparency, extra });
  expect(pixels[0][3]).toBe(128);
  for (let c = 0; c < 3; c++) expect(Math.abs(pixels[0][c] - [80, 120, 150][c]) * 128 / 255).toBeLessThanOrEqual(1);
  expect(pixels[1]).toEqual([30, 100, 210, 255]); expect(pixels[2][3]).toBe(0);
});

test("PSD dialog offers layered and explicit flattened output with accurate preflight", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { const { editor, PaintLayer, PaintFill, AdjustmentLayer, defaultGradientMapAdjustment } = window.luma;
    editor.newDocument({ width: 32, height: 32 }); const paint = editor.document.layers.add(new PaintLayer());
    paint.strokes.add(new PaintFill({ color: "#ff0000", bounds: { x: 0, y: 0, width: 32, height: 32 } }));
    editor.document.layers.add(new AdjustmentLayer({ name: "Gradient", adjustment: defaultGradientMapAdjustment() })); });
  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.locator(".export-dialog"); await dialog.getByLabel("Format", { exact: true }).selectOption("psd");
  await expect(dialog).toContainText("bottom 2 top-level layers are merged");
  await dialog.getByLabel("PSD layers", { exact: true }).selectOption("flatten");
  await expect(dialog).toContainText("All visible artwork is merged into one pixel layer");
  await page.screenshot({ path: "/tmp/canoli-psd-export.png" });
  const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Export .psd", exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.psd$/); await expect(dialog).toHaveCount(0);
});

test("isolated group adjustments stay local and top-level Blend If merges its actual backdrop", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const { editor, PaintLayer, PaintFill, LayerGroup, AdjustmentLayer, LayerStyle } = window.luma;
    const { parsePsd } = await import(/* @vite-ignore */ String("/src/core/interchange/psd/parser.ts"));
    editor.newDocument({ width: 32, height: 16 }); const doc = editor.document;
    const background = doc.layers.add(new PaintLayer({ name: "Background" }));
    background.strokes.add(new PaintFill({ color: "#6080a0", bounds: { x: 0, y: 0, width: 32, height: 16 } }));
    const group = doc.layers.add(new LayerGroup({ name: "Isolated", opacity: .8, blendMode: "screen" }));
    const inside = group.layers.add(new PaintLayer()); inside.strokes.add(new PaintFill({ color: "#d06020", bounds: { x: 4, y: 4, width: 16, height: 8 } }));
    group.layers.add(new AdjustmentLayer({ adjustment: { kind: "hsl", hue: 80, saturation: 20, lightness: 0 } }));
    const pixelLayer = doc.layers.add(new PaintLayer({ name: "Dependent" }));
    pixelLayer.strokes.add(new PaintFill({ color: "#f080b0", bounds: { x: 8, y: 1, width: 20, height: 14 } }));
    const results = [];
    for (const blendIf of [false, true]) {
      pixelLayer.styles = new LayerStyle({ blendIf: { enabled: blendIf, underlying: [0, 80, 170, 240] } });
      const output = await editor.export({ format: "psd" }), parsed = parsePsd(await output.blob.arrayBuffer());
      const rendered = await editor.renderer.render(doc.getSnapshot().document, editor.assetStore, { cache: false, readback: true });
      const expected = rendered.getContext("2d")!.getImageData(0, 0, 32, 16).data; rendered.width = rendered.height = 0;
      let max = 0; for (let i = 0; i < expected.length; i++) max = Math.max(max, Math.abs(expected[i] - parsed.composite!.data[i]));
      results.push({ blendIf, max, names: parsed.layers.map((layer: any) => layer.name),
        group: parsed.layers.find((layer: any) => layer.name === "Isolated")?.imageData?.data.some((value: number, i: number) => i % 4 === 3 && value > 0) });
    }
    return results;
  });
  expect(results[0]).toMatchObject({ max: 0, names: ["Background", "Isolated", "Dependent"], group: true });
  expect(results[1]).toMatchObject({ max: 0, names: ["Merged through Dependent"] });
});

test("50 MP rendered PSD preserves native dimensions and edge pixels with bounded native tiles", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, PaintFill, AdjustmentLayer } = window.luma;
    const { decodePackBits } = await import(/* @vite-ignore */ String("/src/core/interchange/psd/packbits.ts"));
    const { exportPsd } = await import(/* @vite-ignore */ String("/src/engine/psd.ts"));
    editor.newDocument({ width: 10000, height: 5000 });
    const paint = editor.document.layers.add(new PaintLayer()); paint.strokes.add(new PaintFill({ color: "#808080", bounds: { x: 0, y: 0, width: 10000, height: 5000 } }));
    editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "gradient-map", reverse: false,
      stops: [{ position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" }] } }));
    let maximumTilePixels = 0;
    // Instrument this export only; concurrent viewport frames have different budgets.
    const renderer = { render: async (...args: Parameters<typeof editor.renderer.render>) => {
      const canvas = await editor.renderer.render(...args); maximumTilePixels = Math.max(maximumTilePixels, canvas.width * canvas.height); return canvas;
    }, clearCache() {}, dispose() {} };
    const start = performance.now(), output = await exportPsd(editor.document.toJSON(), editor.assetStore, renderer);
    const elapsedMs = performance.now() - start, bytes = new Uint8Array(await output.arrayBuffer()), view = new DataView(bytes.buffer);
    const width = view.getUint32(18), height = view.getUint32(14); let section = 26;
    for (let i = 0; i < 3; i++) section += 4 + view.getUint32(section);
    const table = section + 2, payload = table + height * 4 * 2;
    const samples = [[0, 0], [2047, 63], [2048, 64], [9999, 4999]].map(([x, y]) => {
      const pixel = []; for (let c = 0; c < 4; c++) {
        let offset = payload; for (let row = 0; row < c * height + y; row++) offset += view.getUint16(table + row * 2);
        const size = view.getUint16(table + (c * height + y) * 2); pixel.push(decodePackBits(bytes.subarray(offset, offset + size), width)[x]);
      } return pixel;
    });
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(output);
    });
    return { width, height, samples, maximumTilePixels, elapsedMs, base64, byteLength: bytes.length };
  });
  expect([result.width, result.height]).toEqual([10000, 5000]); for (const pixel of result.samples) expect(pixel).toEqual([127, 0, 128, 255]);
  expect(result.maximumTilePixels).toBeLessThanOrEqual(250000);
  const path = test.info().outputPath("native-50mp.psd"); await writeFile(path, Buffer.from(result.base64, "base64"));
  let independent = "Optional independent reader not requested";
  if (process.env.PSD_READER_PYTHONPATH) {
    const checked = spawnSync("python3", ["-c", "from PIL import Image; import sys; i=Image.open(sys.argv[1]); assert i.size==(10000,5000); assert all(i.getpixel(p)==(127,0,128,255) for p in [(0,0),(2048,64),(9999,4999)]); print('Pillow: native 50 MP PSD dimensions and samples passed')", path], { encoding: "utf8", timeout: 30000 });
    expect(checked.status, checked.stderr || checked.stdout).toBe(0); independent = checked.stdout.trim();
  }
  console.log(JSON.stringify({ elapsedMs: result.elapsedMs, maximumTilePixels: result.maximumTilePixels, byteLength: result.byteLength, independent }));
});
