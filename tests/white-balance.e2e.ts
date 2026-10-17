import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma; editor.newDocument({ width: 64, height: 32 });
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
    const c = canvas.getContext("2d")!; c.fillStyle = "#808080"; c.fillRect(0, 0, 64, 32);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!))), asset = await editor.assetStore.add(blob, "Original", undefined, false);
    editor.document.selectedLayer = editor.document.layers.add(new RasterLayer({ assetId: asset.id, width: 64, height: 32 }));
  });
});

test("palette white balance controls preview, cancel, commit once, reset, validate bounds and respect locks", async ({ page }) => {
  await page.keyboard.press("Control+k"); await page.getByLabel("Search commands").fill("white balance");
  await page.getByRole("option", { name: "New White Balance adjustment layer" }).click();
  await expect(page.getByLabel("Adjustment type", { exact: true })).toHaveValue("white-balance");
  const temperature = page.getByRole("spinbutton", { name: "Temperature value", exact: true }), tint = page.getByRole("spinbutton", { name: "Tint value", exact: true });
  await expect(temperature).toHaveValue("6504"); await expect(tint).toHaveValue("0");
  const revision = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await temperature.fill("9000"); expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  await temperature.press("Escape"); await expect(temperature).toHaveValue("6504");
  await temperature.fill("9000"); await temperature.press("Enter");
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision + 1);
  await temperature.fill("1500"); await temperature.press("Enter"); await expect(temperature).toHaveValue("9000");
  await tint.fill("20"); await tint.press("Enter");
  await page.getByRole("button", { name: "Reset adjustment", exact: true }).click();
  await expect(temperature).toHaveValue("6504"); await expect(tint).toHaveValue("0");
  await page.getByLabel("Editing canvas", { exact: true }).focus(); await page.keyboard.press("Control+z");
  await expect(temperature).toHaveValue("9000"); await expect(tint).toHaveValue("20");
  await page.evaluate(() => { window.luma.editor.document.selectedLayer!.locked = true; });
  await expect(temperature).toBeDisabled(); await expect(tint).toBeDisabled();
  await page.screenshot({ path: "/tmp/canoli-white-balance-inspector.png" });
});

test("context creation and type switching expose white balance without overflowing the menu", async ({ page }) => {
  await page.locator(".viewport").click({ button: "right", position: { x: 50, y: 50 } });
  expect(await page.locator(".canvas-context-menu").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator(".canvas-context-menu").getByRole("button", { name: "White Balance", exact: true }).click();
  await expect(page.getByLabel("Adjustment type", { exact: true })).toHaveValue("white-balance");
  await page.getByLabel("Adjustment type", { exact: true }).selectOption("hsl");
  await page.getByLabel("Adjustment type", { exact: true }).selectOption("white-balance");
  await expect(page.getByRole("spinbutton", { name: "Temperature value", exact: true })).toHaveValue("6504");
});

test("masked white balance exports, reorders, undoes and reopens projects without changing original bytes", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, AdjustmentLayer, LayerMask, MarqueeSelection } = window.luma;
    const { adjustWhiteBalance } = await import(/* @vite-ignore */ String("/src/engine/white-balance.ts"));
    const source = editor.assetStore.values()[0], original = Array.from(new Uint8Array(await source.blob.arrayBuffer()));
    const settings = { kind: "white-balance" as const, temperature: 12000, tint: 20 };
    const layer = editor.document.layers.add(new AdjustmentLayer({ adjustment: settings }));
    layer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 32, height: 32 }) });
    const pixels = async () => {
      const image = await createImageBitmap(await editor.exportPng()), canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
      const c = canvas.getContext("2d")!; c.drawImage(image, 0, 0); image.close(); return [4, 48].map(x => Array.from(c.getImageData(x, 8, 1, 1).data));
    };
    const balanced = await pixels(), expected = Array.from(adjustWhiteBalance(new Uint8ClampedArray([128, 128, 128, 255]), settings));
    const tone = editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "tone", exposure: 0, contrast: 50, saturation: -30 } }));
    const afterTone = await pixels(); tone.moveBefore(layer); const afterMove = await pixels(); editor.document.undo(); const afterUndo = await pixels();
    const snapshot = editor.document.toJSON(), project = await editor.saveProject(); await editor.openProject(new File([project], "white-balance.luma"));
    return { balanced, expected, afterTone, afterMove, afterUndo, reopened: await pixels(), snapshot, after: editor.document.toJSON(), original,
      originalAfter: Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer())) };
  });
  expect(result.balanced).toEqual([result.expected, [128, 128, 128, 255]]);
  expect(result.afterMove).not.toEqual(result.afterTone); expect(result.afterUndo).toEqual(result.afterTone);
  expect(result.reopened).toEqual(result.afterTone); expect(result.snapshot).toEqual(result.after); expect(result.original).toEqual(result.originalAfter);
});

test("worker white balance snapshots caller settings and pixels before asynchronous readiness", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String("/src/engine/processor.ts"));
    const { adjustWhiteBalance } = await import(/* @vite-ignore */ String("/src/engine/white-balance.ts"));
    const processor = new PixelProcessor(), source = new Uint8ClampedArray([80, 120, 150, 128, 10, 40, 90, 255]);
    const options = { kind: "white-balance" as const, temperature: 2856, tint: 20 }, expected = Array.from(adjustWhiteBalance(source, options));
    const pending = processor.whiteBalance(source, options); source.fill(0); options.temperature = 25000; options.tint = -100;
    try { return { expected, actual: Array.from(await pending), sourceSize: source.byteLength }; } finally { processor.dispose(); }
  });
  expect(result.actual).toEqual(result.expected); expect(result.sourceSize).toBe(8);
});

test("PSD layered and flattened exports retain masked white balance pixels and leave editable source state intact", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, AdjustmentLayer, LayerMask, MarqueeSelection } = window.luma;
    const { parsePsd } = await import(/* @vite-ignore */ String("/src/core/interchange/psd/parser.ts"));
    const { adjustWhiteBalance } = await import(/* @vite-ignore */ String("/src/engine/white-balance.ts"));
    const adjustment = { kind: "white-balance" as const, temperature: 12000, tint: 20 };
    const balance = editor.document.layers.add(new AdjustmentLayer({ name: "White balance", adjustment }));
    balance.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 32, height: 32 }) });
    const expected = Array.from(adjustWhiteBalance(new Uint8ClampedArray([128, 128, 128, 255]), adjustment));
    const before = editor.document.toJSON(), exports = [];
    for (const mode of ["layers", "flatten"] as const) {
      const output = await editor.export({ format: "psd", psdMode: mode });
      const parsed = parsePsd(new Uint8Array(await output.blob.arrayBuffer()));
      exports.push({ mode, layerCount: parsed.layers.length, pixels: [4, 48].map(x => Array.from(parsed.composite!.data.slice((8 * 64 + x) * 4, (8 * 64 + x) * 4 + 4))) });
    }
    return { expected, exports, before, after: editor.document.toJSON() };
  });
  expect(result.before).toEqual(result.after);
  for (const output of result.exports) {
    expect(output.layerCount).toBe(1); expect(output.pixels).toEqual([result.expected, [128, 128, 128, 255]]);
  }
});

test("documented white balance scripts run atomically and plugin installation/revocation stays isolated", async ({ page }) => {
  const guide = await readFile("docs/SCRIPTING_API.md", "utf8"), source = guide.match(/```js\n\/\/ example: white-balance\n([\s\S]*?)```/)![1];
  const result = await page.evaluate(async source => {
    const editor = window.luma.editor, before = editor.document.toJSON(); await editor.runScript(source);
    const after = editor.document.toJSON(); editor.document.undo(); const undone = editor.document.toJSON(); editor.document.redo();
    let error = ""; try { await editor.runScript(`document.name='Must roll back'; document.layers.add(new AdjustmentLayer({adjustment:{kind:'white-balance',temperature:1000,tint:0}}));`); } catch (value) { error = String(value); }
    const failed = editor.document.toJSON();
    editor.plugins.install({ format: "luma-plugin", apiVersion: 1, id: "test.white-balance", name: "White balance", version: "1.0.0", permissions: ["document:read", "document:write"],
      commands: [{ id: "create", title: "Create", source: `await new Promise(resolve=>setTimeout(resolve,200));\n${source}` }] });
    const installed = editor.document.toJSON(), pending = editor.runPlugin("test.white-balance", "create"); editor.plugins.revokePermission("test.white-balance", "document:write");
    let denied = ""; try { await pending; } catch (value) { denied = String(value); }
    const rejected = editor.document.toJSON(); editor.plugins.grantPermission("test.white-balance", "document:write"); await editor.runPlugin("test.white-balance", "create");
    return { before, after, undone, failed, error, installed, rejected, denied, final: editor.document.toJSON() };
  }, source);
  expect(result.after.children).toHaveLength(result.before.children.length + 1); expect(result.undone).toEqual(result.before);
  expect(result.error).toBeTruthy(); expect(result.failed).toEqual(result.after); expect(result.installed).toEqual(result.after); expect(result.rejected).toEqual(result.after);
  expect(result.denied).toContain("document:write"); expect(result.final.children).toHaveLength(result.after.children.length + 1);
});

test("white balance workspace history retains current and redo-only parameters across reload", async ({ page }) => {
  const saved = await page.evaluate(async () => {
    const { editor, AdjustmentLayer } = window.luma;
    const layer = editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "white-balance", temperature: 2856, tint: 20 } }));
    layer.adjustment = { kind: "white-balance", temperature: 12000, tint: -20 }; editor.document.undo();
    const version = await editor.saveWorkspaceVersion("White balance history"); return { version, before: editor.document.toJSON() };
  });
  await page.reload();
  const restored = await page.evaluate(async version => {
    const editor = window.luma.editor; await editor.restoreWorkspace(version); const before = editor.document.toJSON(); editor.document.redo();
    return { before, adjustment: (editor.document.layers.at(1) as import("../src/dom").AdjustmentLayer).adjustment };
  }, saved.version);
  expect(restored.before).toEqual(saved.before); expect(restored.adjustment).toEqual({ kind: "white-balance", temperature: 12000, tint: -20 });
});

test("50 MP white balance preserves native dimensions and colors across tile boundaries", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, PaintFill, AdjustmentLayer } = window.luma;
    const { adjustWhiteBalance } = await import(/* @vite-ignore */ String("/src/engine/white-balance.ts"));
    editor.newDocument({ width: 10000, height: 5000 });
    const paint = editor.document.layers.add(new PaintLayer());
    paint.strokes.add(new PaintFill({ color: "#507896", bounds: { x: 0, y: 0, width: 10000, height: 5000 } }));
    const adjustment = { kind: "white-balance" as const, temperature: 9000, tint: 12 };
    editor.document.layers.add(new AdjustmentLayer({ adjustment }));
    const expected = Array.from(adjustWhiteBalance(new Uint8ClampedArray([80, 120, 150, 255]), adjustment));
    const start = performance.now(), blob = await editor.exportPng(), milliseconds = performance.now() - start;
    const image = await createImageBitmap(blob), dimensions = [image.width, image.height];
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const samples = [[0, 0], [1023, 1023], [1024, 1024], [2048, 2048], [9999, 4999]].map(([x, y]) => {
      context.clearRect(0, 0, 1, 1); context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    image.close(); return { dimensions, samples, expected, milliseconds };
  });
  expect(result.dimensions).toEqual([10000, 5000]);
  for (const sample of result.samples) expect(sample).toEqual(result.expected);
  console.log(`50 MP white balance export: ${JSON.stringify(result)}`);
});
