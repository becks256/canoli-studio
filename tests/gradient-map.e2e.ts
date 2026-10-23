import {SCHEMA_VERSION} from "../src/core/model";
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    editor.newDocument({ width: 64, height: 32 });
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, 64, 32);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)));
    const asset = await editor.assetStore.add(blob, "Original", undefined, false);
    editor.document.selectedLayer = editor.document.layers.add(new RasterLayer({ assetId: asset.id, width: 64, height: 32 }));
  });
});

test("palette creates gradient maps with editable stops, color preview/cancel, reset and locks", async ({ page }) => {
  await page.keyboard.press("Control+k"); await page.getByLabel("Search commands").fill("gradient map");
  await page.getByRole("option", { name: "New Gradient Map adjustment layer" }).click();
  await expect(page.getByLabel("Adjustment type", { exact: true })).toHaveValue("gradient-map");
  await expect(page.getByRole("button", { name: "Remove stop 1", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Add gradient stop", exact: true }).click();
  const position = page.getByRole("spinbutton", { name: "Stop 2 position", exact: true });
  await expect(position).toHaveValue("50");
  const revision = await page.evaluate(() => window.luma.editor.document.getSnapshot().revision);
  await position.fill("40"); expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision);
  await position.press("Enter"); expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision + 1);
  await position.fill("0"); await position.press("Enter"); await expect(position).toHaveValue("40");
  const color = page.getByLabel("Stop 2 color", { exact: true });
  const original = await color.inputValue();
  await color.evaluate((node: HTMLInputElement) => { node.value = "#ff0000"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(color).toHaveValue("#ff0000");
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision + 1);
  await color.press("Escape"); await expect(color).toHaveValue(original);
  await color.evaluate((node: HTMLInputElement) => {
    node.value = "#ff0000"; node.dispatchEvent(new Event("input", { bubbles: true })); node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().revision)).toBe(revision + 2);
  await page.getByLabel("Reverse gradient map", { exact: true }).check();
  await page.getByRole("button", { name: "Remove stop 2", exact: true }).click();
  await expect(page.getByLabel("Stop 3 color", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset adjustment", exact: true }).click();
  await expect(page.getByLabel("Reverse gradient map", { exact: true })).not.toBeChecked();
  await page.getByLabel("Editing canvas", { exact: true }).focus(); await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Reverse gradient map", { exact: true })).toBeChecked();
  await page.evaluate(() => { window.luma.editor.document.selectedLayer!.locked = true; });
  await expect(page.getByLabel("Stop 1 color", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add gradient stop", exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const layer = window.luma.editor.document.selectedLayer as import("../src/dom").AdjustmentLayer; layer.locked = false;
    layer.adjustment = { kind: "gradient-map", reverse: false, stops: Array.from({ length: 32 }, (_, i) => ({ position: i / 31, color: i % 2 ? "#fac28a" : "#194e73" })) };
  });
  await expect(page.getByRole("button", { name: "Add gradient stop", exact: true })).toBeDisabled();
  await page.getByLabel("Stop 32 color", { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.locator(".gradient-map-controls").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/canoli-gradient-map-inspector.png" });
});

test("gradient maps render masks, reverse, opacity and project round trips while preserving originals", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, AdjustmentLayer, LayerMask, MarqueeSelection } = window.luma;
    const original = Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer()));
    const adjustment = { kind: "gradient-map" as const, stops: [{ position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" }], reverse: false };
    const layer = editor.document.layers.add(new AdjustmentLayer({ adjustment }));
    layer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: "rectangle", x: 0, y: 0, width: 32, height: 32 }) });
    const pixels = async () => {
      const image = await createImageBitmap(await editor.exportPng()), canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
      const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0); image.close();
      return [4, 48].map(x => Array.from(ctx.getImageData(x, 8, 1, 1).data));
    };
    const forward = await pixels(); layer.adjustment = { ...adjustment, reverse: true }; const reversed = await pixels();
    editor.document.undo(); const undo = await pixels(); editor.document.redo();
    layer.opacity = .5; const faded = await pixels();
    const project = await editor.saveProject(); await editor.openProject(new File([project], "gradient.luma"));
    return { forward, reversed, undo, faded, reopened: await pixels(), original,
      after: Array.from(new Uint8Array(await editor.assetStore.values()[0].blob.arrayBuffer())), schema: editor.document.toJSON().schemaVersion };
  });
  expect(result.forward).toEqual([[127, 0, 128, 255], [128, 128, 128, 255]]);
  expect(result.reversed).toEqual([[128, 0, 127, 255], [128, 128, 128, 255]]);
  expect(result.undo).toEqual(result.forward); expect(result.faded[0]).toEqual([128, 64, 128, 255]);
  expect(result.reopened).toEqual(result.faded); expect(result.original).toEqual(result.after); expect(result.schema).toBe(SCHEMA_VERSION);
});

test("context action fits and the worker owns its stop/pixel snapshot, including native tile seams", async ({ page }) => {
  await page.locator(".viewport").click({ button: "right", position: { x: 50, y: 50 } });
  expect(await page.locator(".canvas-context-menu").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator(".canvas-context-menu").getByRole("button", { name: "Gradient Map", exact: true }).click();
  await expect(page.getByLabel("Adjustment type", { exact: true })).toHaveValue("gradient-map");
  const result = await page.evaluate(async () => {
    const { PixelProcessor } = await import(/* @vite-ignore */ String("/src/engine/processor.ts"));
    const { adjustGradientMap } = await import(/* @vite-ignore */ String("/src/engine/gradient-map.ts"));
    const options = window.luma.defaultGradientMapAdjustment(), pixels = new Uint8ClampedArray([80, 120, 150, 128]);
    const processor = new PixelProcessor(), expected = Array.from(adjustGradientMap(pixels, options));
    const pending = processor.gradientMap(pixels, options); options.stops[0].color = "#ff0000"; pixels.fill(0);
    let actual: number[];
    try { actual = Array.from(await pending); } finally { processor.dispose(); }
    const { editor, AdjustmentLayer, PaintLayer, PaintFill } = window.luma;
    editor.newDocument({ width: 2050, height: 2 });
    const paint = editor.document.layers.add(new PaintLayer()); paint.strokes.add(new PaintFill({ color: "#507896", bounds: { x: 0, y: 0, width: 2050, height: 2 } }));
    editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "gradient-map", reverse: false, stops: [{ position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" }] } }));
    const image = await createImageBitmap(await editor.exportPng()), canvas = document.createElement("canvas"); canvas.width = 2050; canvas.height = 2;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0); image.close();
    return { actual, expected, seams: [0, 1023, 1024, 2047, 2048, 2049].map(x => Array.from(ctx.getImageData(x, 0, 1, 1).data)) };
  });
  expect(result.actual).toEqual(result.expected); for (const pixel of result.seams) expect(pixel).toEqual([141, 0, 114, 255]);
});

test("documented gradient script runs atomically and rejects invalid edits and plugin write revocation", async ({ page }) => {
  const guide = await readFile("docs/SCRIPTING_API.md", "utf8");
  const source = guide.match(/```js\n\/\/ example: gradient-map\n([\s\S]*?)```/)![1];
  const result = await page.evaluate(async source => {
    const editor = window.luma.editor, before = editor.document.toJSON(); await editor.runScript(source);
    const after = editor.document.toJSON(); editor.document.undo(); const undone = editor.document.toJSON(); editor.document.redo();
    let error = "";
    try { await editor.runScript(`document.name = 'Must roll back'; document.layers.at(document.layers.length - 1).adjustment = {kind:'gradient-map',reverse:false,stops:[{position:.5,color:'#000000'},{position:.5,color:'#ffffff'}]};`); }
    catch (value) { error = String(value); }
    return { before, after, undone, current: editor.document.toJSON(), error };
  }, source);
  expect(result.after.children).toHaveLength(result.before.children.length + 1); expect(result.undone).toEqual(result.before);
  expect(result.current).toEqual(result.after); expect(result.error).toContain("strictly increasing");
  // Permission enforcement is exercised through the actual plugin runner, not a script shortcut.
  const plugin = await page.evaluate(async source => {
    const editor = window.luma.editor;
    const before = editor.document.toJSON();
    editor.plugins.install({ format: "luma-plugin", apiVersion: 1, id: "test.gradient", name: "Gradient", version: "1.0.0",
      permissions: ["document:read", "document:write"], commands: [{ id: "create", title: "Create", source: `await new Promise(resolve => setTimeout(resolve, 200));\n${source}` }] });
    const installed = editor.document.toJSON();
    const pending = editor.runPlugin("test.gradient", "create");
    editor.plugins.revokePermission("test.gradient", "document:write");
    let error = ""; try { await pending; } catch (value) { error = String(value); }
    const denied = editor.document.toJSON(); editor.plugins.grantPermission("test.gradient", "document:write");
    const removing = editor.runPlugin("test.gradient", "create"); editor.plugins.remove("test.gradient");
    let removalError = ""; try { await removing; } catch (value) { removalError = String(value); }
    const removed = editor.document.toJSON();
    editor.plugins.install({ format: "luma-plugin", apiVersion: 1, id: "test.gradient", name: "Gradient", version: "1.0.0",
      permissions: ["document:read", "document:write"], commands: [{ id: "create", title: "Create", source }] });
    await editor.runPlugin("test.gradient", "create");
    return { before, installed, denied, error, removed, removalError, after: editor.document.toJSON() };
  }, source);
  expect(plugin.installed).toEqual(plugin.before); expect(plugin.denied).toEqual(plugin.before);
  expect(plugin.error).toMatch(/permission|write/i); expect(plugin.after.children).toHaveLength(plugin.before.children.length + 1);
  expect(plugin.removed).toEqual(plugin.before); expect(plugin.removalError).toContain("no longer installed");
});

test("gradient map workspace restoration retains current settings and redo-only stop edits", async ({ page }) => {
  const saved = await page.evaluate(async () => {
    const { editor, AdjustmentLayer, defaultGradientMapAdjustment } = window.luma;
    const layer = editor.document.layers.add(new AdjustmentLayer({ adjustment: defaultGradientMapAdjustment() }));
    const next = defaultGradientMapAdjustment(); next.stops.splice(1, 0, { position: .3, color: "#ff3300" }); layer.adjustment = next; editor.document.undo();
    const version = await editor.saveWorkspaceVersion("Gradient history");
    return { version, before: editor.document.toJSON(), expected: next };
  });
  await page.reload();
  const restored = await page.evaluate(async version => {
    const editor = window.luma.editor; await editor.restoreWorkspace(version); const before = editor.document.toJSON(); editor.document.redo();
    return { before, adjustment: (editor.document.layers.at(1) as import("../src/dom").AdjustmentLayer).adjustment };
  }, saved.version);
  expect(restored.before).toEqual(saved.before); expect(restored.adjustment).toEqual(saved.expected);
});

test("reordering gradient and tone layers changes exported pixels and undo restores the previous stack", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, AdjustmentLayer } = window.luma;
    const gradient = editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "gradient-map", reverse: false,
      stops: [{ position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" }] } }));
    const tone = editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "tone", exposure: 1, contrast: 0, saturation: 0 } }));
    const pixel = async () => {
      const bitmap = await createImageBitmap(await editor.exportPng()), canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 32;
      const c = canvas.getContext("2d")!; c.drawImage(bitmap, 0, 0); bitmap.close(); return Array.from(c.getImageData(4, 4, 1, 1).data);
    };
    const afterTone = await pixel(); tone.moveBefore(gradient); const afterGradient = await pixel(); editor.document.undo();
    return { afterTone, afterGradient, undone: await pixel() };
  });
  expect(result.afterTone).toEqual([254, 0, 255, 255]); expect(result.afterGradient).toEqual([0, 0, 255, 255]);
  expect(result.undone).toEqual(result.afterTone);
});

test("50 MP gradient mapping exports native dimensions and consistent colors across the canvas", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, PaintFill, AdjustmentLayer } = window.luma;
    editor.newDocument({ width: 10000, height: 5000 });
    const paint = editor.document.layers.add(new PaintLayer());
    paint.strokes.add(new PaintFill({ color: "#808080", bounds: { x: 0, y: 0, width: 10000, height: 5000 } }));
    editor.document.layers.add(new AdjustmentLayer({ adjustment: { kind: "gradient-map", reverse: false,
      stops: [{ position: 0, color: "#ff0000" }, { position: 1, color: "#0000ff" }] } }));
    const start = performance.now(), blob = await editor.exportPng(), milliseconds = performance.now() - start;
    const image = await createImageBitmap(blob), dimensions = [image.width, image.height];
    // Read small regions rather than materializing another full-canvas pixel array.
    const c = document.createElement("canvas"); c.width = c.height = 1; const context = c.getContext("2d")!;
    const samples = [[0, 0], [1023, 1023], [1024, 1024], [9999, 4999]].map(([x, y]) => {
      context.clearRect(0, 0, 1, 1); context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
    image.close(); return { dimensions, samples, milliseconds };
  });
  expect(result.dimensions).toEqual([10000, 5000]);
  for (const sample of result.samples) expect(sample).toEqual([127, 0, 128, 255]);
  console.log(`50 MP gradient map export: ${result.milliseconds.toFixed(1)} ms`);
});
