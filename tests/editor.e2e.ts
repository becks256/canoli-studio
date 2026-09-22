import { test, expect } from "@playwright/test";
import { createDeflate } from "node:zlib";
import { once } from "node:events";
import type { EditorApplication } from "../src/editor";
import type * as DOM from "../src/dom";
declare global {
  interface Window {
    luma: { editor: EditorApplication } & typeof DOM;
  }
}

function pngChunk(name: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(name, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++) {
    crc ^= result[i];
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
async function sourcePng(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x++) {
    row[1 + x * 4] = 40;
    row[2 + x * 4] = 60;
    row[3 + x * 4] = 80;
    row[4 + x * 4] = 255;
  }
  const deflate = createDeflate();
  const chunks: Buffer[] = [];
  deflate.on("data", (chunk) => chunks.push(chunk));
  const end = once(deflate, "end");
  for (let y = 0; y < height; y++)
    if (!deflate.write(row)) await once(deflate, "drain");
  deflate.end();
  await end;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.concat(chunks)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("editing, constructors in scripts, keyboard focus, and project round trip", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample composition" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await expect(
    page.getByRole("slider", { name: "Exposure", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Scripts (Mod+Shift+K)" }).click();
  await page.getByRole("button", { name: "Run script", exact: true }).click();
  await expect(page.getByLabel("Script output")).toContainText("Finished.", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Close scripts" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(5);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".layer-row")).toHaveCount(3);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".layer-row")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Select A warmer possibility", exact: true })
    .click();
  const name = page.getByRole("textbox", { name: "Layer name", exact: true });
  await name.fill("vhhhh");
  await name.press("Backspace");
  await name.press("Enter");
  await expect(
    page.getByRole("button", { name: "Select vhhh", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Move tool (V)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Keyboard shortcuts (?)", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const roundTrip = await page.evaluate(async () => {
    const { editor } = window.luma;
    const before = editor.document.toJSON();
    const project = editor.saveProject();
    editor.newDocument();
    await editor.openProject(new File([project], "Roundtrip.luma"));
    return { before, after: editor.document.toJSON() };
  });
  expect(roundTrip.after).toEqual(roundTrip.before);
  await page.screenshot({ path: "test-results/luma-studio.png" });
  expect(errors).toEqual([]);
});

test("script isolation, rollback, timeout, and revision protection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample composition" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);
  const results = await page.evaluate(async () => {
    const { editor } = window.luma;
    const before = editor.document.toJSON();
    const revision = editor.document.getSnapshot().revision;
    const failure = async (code: string) => {
      try {
        await editor.runScript(code);
        return "unexpected success";
      } catch (error) {
        return (error as Error).message;
      }
    };
    const thrown = await failure(
      'document.name = "wrong"; throw new Error("intentional");',
    );
    const missing = await failure(
      'document.layers.add(new RasterLayer({ assetId: "missing", width: 10, height: 10 }));',
    );
    const network = await failure(
      'document.name = "wrong"; await fetch("https://example.com");',
    );
    const timeout = await failure('document.name = "wrong"; while (true) {}');
    const untouched =
      JSON.stringify(before) === JSON.stringify(editor.document.toJSON()) &&
      revision === editor.document.getSnapshot().revision;
    const pending = failure(
      'await new Promise(resolve => setTimeout(resolve, 500)); document.name = "old edit";',
    );
    editor.document.name = "Newer edit";
    const conflict = await pending;
    return {
      thrown,
      missing,
      network,
      timeout,
      untouched,
      conflict,
      name: editor.document.name,
    };
  });
  expect(results.thrown).toContain("intentional");
  expect(results.missing).toContain("Missing image");
  expect(results.network).not.toBe("unexpected success");
  expect(results.timeout).toContain("time limit");
  expect(results.untouched).toBe(true);
  expect(results.conflict).toContain("changed");
  expect(results.name).toBe("Newer edit");
});

test("50 MP import retains originals, edits in WASM, saves, reopens, and exports at full resolution", async ({
  page,
}) => {
  await page.goto("/");
  const buffer = await sourcePng(10000, 5000);
  await page.getByTestId("import-input").setInputFiles({
    name: "50-megapixels.png",
    mimeType: "image/png",
    buffer,
  });
  await expect(page.locator(".document-summary")).toContainText("10000 × 5000");
  await expect(
    page.getByRole("slider", { name: "Exposure", exact: true }),
  ).toBeEnabled();
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const layer = editor.document.selectedLayer as InstanceType<
      typeof RasterLayer
    >;
    layer.setTone({ exposure: 1 });
    const source = editor.assetStore.get(layer.assetId);
    const sample = document.createElement("canvas");
    sample.width = sample.height = 1;
    const context = sample.getContext("2d")!;
    context.drawImage(source.bitmap, 0, 0, 1, 1, 0, 0, 1, 1);
    const original = [...context.getImageData(0, 0, 1, 1).data];
    const project = editor.saveProject();
    editor.newDocument();
    await editor.openProject(new File([project], "50MP.luma"));
    const start = performance.now();
    const output = await editor.exportPng();
    const bitmap = await createImageBitmap(output);
    const samples: number[][] = [];
    // Check edges and both sides of tile/strip boundaries, not just dimensions.
    for (const [x, y] of [
      [0, 0],
      [2047, 63],
      [2048, 64],
      [4096, 128],
      [9999, 4999],
    ]) {
      context.clearRect(0, 0, 1, 1);
      context.drawImage(bitmap, x, y, 1, 1, 0, 0, 1, 1);
      samples.push([...context.getImageData(0, 0, 1, 1).data]);
    }
    const dimensions = [bitmap.width, bitmap.height];
    bitmap.close();
    return {
      dimensions,
      original,
      samples,
      elapsed: Math.round(performance.now() - start),
      sourceSize: [source.width, source.height],
      projectSize: [editor.document.width, editor.document.height],
    };
  });
  expect(result.dimensions).toEqual([10000, 5000]);
  expect(result.projectSize).toEqual([10000, 5000]);
  expect(result.sourceSize).toEqual([10000, 5000]);
  expect(result.original).toEqual([40, 60, 80, 255]);
  for (const pixel of result.samples)
    expect(pixel).toEqual([80, 120, 160, 255]);
  console.log("50 MP full-resolution export:", result.elapsed, "ms");
  const preview = await page
    .getByTestId("artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height);
  expect(preview).toBeLessThanOrEqual(4_000_000);
});

test("artboard tool opens modal, links aspect ratio, and resizes canvas", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample composition" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);

  // Click Artboard editor tool in tool rail
  await page.getByRole("button", { name: "Artboard editor (A)" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Resize artboard" }),
  ).toBeVisible();

  // Width and height input should be prefilled with current document size (1600 x 1200)
  const widthInput = page.getByPlaceholder("Width");
  const heightInput = page.getByPlaceholder("Height");
  await expect(widthInput).toHaveValue("1600");
  await expect(heightInput).toHaveValue("1200");

  // Since aspect ratio is linked by default (1600 / 1200 = 4 / 3):
  // changing width to 800 should automatically scale height to 600
  await widthInput.fill("800");
  await expect(heightInput).toHaveValue("600");

  // Toggle link off (unlink)
  const linkBtn = page.getByRole("button", { name: /aspect ratio/i });
  await linkBtn.click();
  await expect(linkBtn).toHaveAttribute("aria-pressed", "false");

  // Changing height now does not change width
  await heightInput.fill("1000");
  await expect(widthInput).toHaveValue("800");

  // Apply resize
  await page.getByRole("button", { name: "Apply resize" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Document should now be 800 x 1000
  const dimensions = await page.evaluate(() => {
    const { editor } = window.luma;
    return { width: editor.document.width, height: editor.document.height };
  });
  expect(dimensions).toEqual({ width: 800, height: 1000 });

  // Undo restores 1600 x 1200
  await page.keyboard.press("Control+z");
  const restored = await page.evaluate(() => {
    const { editor } = window.luma;
    return { width: editor.document.width, height: editor.document.height };
  });
  expect(restored).toEqual({ width: 1600, height: 1200 });

  expect(errors).toEqual([]);
});

test("text tool creates text layers, edits content in inspector, and undoes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample composition" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);

  // Select Text tool via button click or keyboard shortcut T
  const textButton = page.getByRole("button", { name: "Text tool (T)" });
  await textButton.click();
  await expect(textButton).toHaveAttribute("aria-pressed", "true");

  // Click canvas to place text layer
  const canvas = page.locator(".canvas-wrap");
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + 200, box.y + 150);

  // Text layer should be added and selected
  await expect(page.locator(".layer-row.selected")).toContainText("Text");
  await expect(page.getByRole("heading", { name: "Text" })).toBeVisible();

  // Content textarea in Inspector
  const contentArea = page.getByLabel("Text content");
  await expect(contentArea).toHaveValue("Text");

  // Edit text content
  await contentArea.fill("Awesome Typography");
  await expect(contentArea).toHaveValue("Awesome Typography");

  // Verify DOM state
  const layerData = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof TextLayer) {
      return {
        text: selected.text,
        fontSize: selected.fontSize,
        fontFamily: selected.fontFamily,
        color: selected.color,
        align: selected.align,
        width: selected.width,
        height: selected.height,
      };
    }
    return null;
  });

  expect(layerData?.text).toBe("Awesome Typography");
  expect(layerData?.width).toBeGreaterThan(0);
  expect(layerData?.height).toBeGreaterThan(0);

  // Undo restores previous text
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Text content")).toHaveValue("Text");

  // Redo brings back the edit
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByLabel("Text content")).toHaveValue("Awesome Typography");

  // Verify font size input is not capped at 256 and accepts large values like 480
  const fontSizeInput = page.getByLabel("Font size", { exact: true });
  await expect(fontSizeInput).toHaveValue("32");
  await fontSizeInput.fill("480");
  await fontSizeInput.press("Enter");
  await expect(fontSizeInput).toHaveValue("480");

  const largeFont = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    return selected instanceof TextLayer ? selected.fontSize : null;
  });
  expect(largeFont).toBe(480);

  expect(errors).toEqual([]);
});

test("layer can be resized by dragging corner handles with live preview and undo support", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open sample composition" }).click();
  await expect(page.locator(".layer-row")).toHaveCount(3);

  // Select the raster layer Sculptural forms
  await page
    .getByRole("button", { name: "Select Sculptural forms", exact: true })
    .click();

  // Selection outline should have the 4 corner handles
  const outline = page.locator(".selection-outline");
  await expect(outline).toBeVisible();
  const handleSE = outline.locator(".handle-se");
  const handleNW = outline.locator(".handle-nw");
  const handleNE = outline.locator(".handle-ne");
  const handleSW = outline.locator(".handle-sw");

  await expect(handleSE).toBeVisible();
  await expect(handleNW).toBeVisible();
  await expect(handleNE).toBeVisible();
  await expect(handleSW).toBeVisible();

  // Handle cursor checks
  await expect(handleSE).toHaveCSS("cursor", "nwse-resize");
  await expect(handleNE).toHaveCSS("cursor", "nesw-resize");
  await expect(handleSW).toHaveCSS("cursor", "nesw-resize");
  await expect(handleNW).toHaveCSS("cursor", "nwse-resize");

  // Read initial dimensions
  const initDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height, x: selected.x, y: selected.y };
    }
    return null;
  });
  expect(initDims).not.toBeNull();
  const { width: initW, height: initH, x: initX, y: initY } = initDims!;

  // Drag bottom-right (SE) handle to expand layer
  const seBox = (await handleSE.boundingBox())!;
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  // Drag by +60px X, +40px Y
  await page.mouse.move(seBox.x + seBox.width / 2 + 60, seBox.y + seBox.height / 2 + 40);
  await page.mouse.up();

  // Verify dimensions increased in DOM
  const resizedDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height, x: selected.x, y: selected.y };
    }
    return null;
  });
  expect(resizedDims!.width).toBeGreaterThan(initW);
  expect(resizedDims!.height).toBeGreaterThan(initH);
  expect(resizedDims!.x).toBe(initX);
  expect(resizedDims!.y).toBe(initY);

  // Inspector fields match
  await expect(page.getByLabel("Width", { exact: true })).toHaveValue(String(resizedDims!.width));
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue(String(resizedDims!.height));

  // Undo restores initial dimensions
  await page.keyboard.press("Control+z");
  const restoredDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height };
    }
    return null;
  });
  expect(restoredDims!.width).toBe(initW);
  expect(restoredDims!.height).toBe(initH);

  // Redo re-applies the resize
  await page.keyboard.press("Control+Shift+z");
  const redoneDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height, x: selected.x, y: selected.y };
    }
    return null;
  });
  expect(redoneDims!.width).toBe(resizedDims!.width);
  expect(redoneDims!.height).toBe(resizedDims!.height);

  // Drag NW handle to shrink and move top-left corner
  const nwBox = (await handleNW.boundingBox())!;
  await page.mouse.move(nwBox.x + nwBox.width / 2, nwBox.y + nwBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nwBox.x + nwBox.width / 2 + 50, nwBox.y + nwBox.height / 2 + 50);
  await page.mouse.up();

  const nwDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height, x: selected.x, y: selected.y };
    }
    return null;
  });
  // Right edge (x + width) and bottom edge (y + height) remain anchored
  expect(nwDims!.x + nwDims!.width).toBe(redoneDims!.x + redoneDims!.width);
  expect(nwDims!.y + nwDims!.height).toBe(redoneDims!.y + redoneDims!.height);
  expect(nwDims!.x).toBeGreaterThan(redoneDims!.x);
  expect(nwDims!.y).toBeGreaterThan(redoneDims!.y);

  // Test Escape cancellation during resize
  const seBox2 = (await handleSE.boundingBox())!;
  await page.mouse.move(seBox2.x + seBox2.width / 2, seBox2.y + seBox2.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox2.x + seBox2.width / 2 + 80, seBox2.y + seBox2.height / 2 + 80);
  await page.keyboard.press("Escape");
  await page.mouse.up();

  const cancelledDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height, x: selected.x, y: selected.y };
    }
    return null;
  });
  expect(cancelledDims!.width).toBe(nwDims!.width);
  expect(cancelledDims!.height).toBe(nwDims!.height);

  // Test Shift key proportional aspect ratio resize
  const currentRatio = nwDims!.width / nwDims!.height;
  const seBox3 = (await handleSE.boundingBox())!;
  await page.mouse.move(seBox3.x + seBox3.width / 2, seBox3.y + seBox3.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(seBox3.x + seBox3.width / 2 + 100, seBox3.y + seBox3.height / 2 + 30);
  await page.mouse.up();
  await page.keyboard.up("Shift");

  const shiftDims = await page.evaluate(() => {
    const { editor, RasterLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    if (selected instanceof RasterLayer) {
      return { width: selected.width, height: selected.height };
    }
    return null;
  });
  const newRatio = shiftDims!.width / shiftDims!.height;
  expect(Math.abs(newRatio - currentRatio)).toBeLessThan(0.02);

  expect(errors).toEqual([]);
});

test("add empty layer button and shortcut create paint layers and support undo/redo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Initial state: empty document before any layers
  const initialLayerCount = await page.evaluate(() => {
    return window.luma.editor.document.layers.length;
  });
  expect(initialLayerCount).toBe(0);

  // Click the New layer button in panel-tabs
  const newLayerBtn = page.getByRole("button", {
    name: "New layer (Mod+Shift+N)",
  });
  await expect(newLayerBtn).toBeVisible();
  await newLayerBtn.click();

  // Verify a new empty PaintLayer is created and selected
  const layer1Info = await page.evaluate(() => {
    const { editor, PaintLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    return {
      isPaintLayer: selected instanceof PaintLayer,
      name: selected?.name,
      strokeCount: selected instanceof PaintLayer ? selected.strokes.length : -1,
      totalLayers: editor.document.layers.length,
    };
  });
  expect(layer1Info.isPaintLayer).toBe(true);
  expect(layer1Info.name).toBe("Layer 1");
  expect(layer1Info.strokeCount).toBe(0);
  expect(layer1Info.totalLayers).toBe(1);

  // Verify layer row in the panel
  const layerRows = page.locator(".layer-row");
  await expect(layerRows.filter({ hasText: "Layer 1" })).toHaveClass(/selected/);

  // Use keyboard shortcut to create a second layer
  await page.keyboard.press("Control+Shift+n");

  const layer2Info = await page.evaluate(() => {
    const { editor, PaintLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    return {
      isPaintLayer: selected instanceof PaintLayer,
      name: selected?.name,
      totalLayers: editor.document.layers.length,
    };
  });
  expect(layer2Info.isPaintLayer).toBe(true);
  expect(layer2Info.name).toBe("Layer 2");
  expect(layer2Info.totalLayers).toBe(2);

  // Undo creates atomic removal of Layer 2
  await page.keyboard.press("Control+z");

  const afterUndo = await page.evaluate(() => {
    const { editor } = window.luma;
    return {
      totalLayers: editor.document.layers.length,
      selectedName: editor.document.selectedLayer?.name,
    };
  });
  expect(afterUndo.totalLayers).toBe(1);

  // Redo restores Layer 2
  await page.keyboard.press("Control+Shift+z");

  const afterRedo = await page.evaluate(() => {
    const { editor } = window.luma;
    return {
      totalLayers: editor.document.layers.length,
    };
  });
  expect(afterRedo.totalLayers).toBe(2);

  // Select Layer 2 before grouping
  await page.getByRole("button", { name: "Select Layer 2", exact: true }).click();

  // Test creating inside a group: group Layer 2
  const addGroupBtn = page.getByRole("button", { name: "Add group (Mod+G)" });
  await addGroupBtn.click();

  const afterGroup = await page.evaluate(() => {
    const { editor, LayerGroup } = window.luma;
    const selected = editor.document.selectedLayer;
    return {
      isGroup: selected instanceof LayerGroup,
      childCount: selected instanceof LayerGroup ? selected.layers.length : 0,
    };
  });
  expect(afterGroup.isGroup).toBe(true);
  expect(afterGroup.childCount).toBe(1);

  // With the group selected, click New layer -> should be inside the group
  await newLayerBtn.click();

  const insideGroup = await page.evaluate(() => {
    const { editor, PaintLayer } = window.luma;
    const selected = editor.document.selectedLayer;
    const group = editor.document.layers.at(1) as DOM.LayerGroup;
    return {
      selectedName: selected?.name,
      isPaint: selected instanceof PaintLayer,
      groupChildren: [...group.layers].map((l) => l.name),
    };
  });
  expect(insideGroup.isPaint).toBe(true);
  expect(insideGroup.selectedName).toBe("Layer 3");
  expect(insideGroup.groupChildren).toContain("Layer 3");

  expect(errors).toEqual([]);
});



