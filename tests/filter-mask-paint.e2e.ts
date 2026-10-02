import { expect, test, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const {
      editor,
      RasterLayer,
      SmartToneFilter,
      LayerMask,
      MarqueeSelection,
    } = window.luma;
    editor.newDocument({ width: 160, height: 96 });
    const canvas = new OffscreenCanvas(64, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#ff0000";
    c.fillRect(0, 0, 64, 32);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob(),
      "Red",
      undefined,
      false,
    );
    const raster = editor.document.layers.add(
      new RasterLayer({ assetId: asset.id, width: 64, height: 32 }),
    );
    const instance = raster.convertToSmartObject();
    instance.width = 128;
    instance.height = 64;
    instance.x = 16;
    instance.y = 16;
    instance.addFilter(new SmartToneFilter({ saturation: -100 }));
    instance.filterMask = new LayerMask({ base: 1 });
    editor.document.selectedLayer = instance;
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 40,
      y: 20,
      width: 40,
      height: 50,
    });
    editor.tools.configure({
      size: 12,
      hardness: 1,
      opacity: 1,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
      smoothing: 0,
    });
  });
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Paint target", exact: true })
    .selectOption("filter-mask-hide");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}
async function state(page: Page) {
  return page.evaluate(() => {
    const editor = window.luma.editor,
      layer = editor.document.selectedLayer as InstanceType<
        typeof window.luma.SmartObjectLayer
      >;
    return {
      mask: layer.filterMask!.toJSON(),
      ordinary: layer.mask,
      history: editor.document.getSnapshot().past.length,
    };
  });
}
async function pixels(page: Page) {
  return page.evaluate(async () => {
    const editor = window.luma.editor,
      canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
    const c = canvas.getContext("2d")!;
    const values = [
      ...c.getImageData(64, 48, 1, 1).data,
      ...c.getImageData(100, 48, 1, 1).data,
    ];
    canvas.width = canvas.height = 0;
    return values;
  });
}
test("brush paints filter-mask coverage in native coordinates with selection clipping and one undo", async ({
  page,
}) => {
  await setup(page);
  const before = await state(page);
  expect(await pixels(page)).toEqual([54, 54, 54, 255, 54, 54, 54, 255]);
  const artwork = () =>
    page
      .locator(".canvas-wrap canvas")
      .first()
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL());
  const untouched = await artwork();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.move(box.x + 64, box.y + 48);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 48, { steps: 8 });
  expect((await state(page)).history).toBe(before.history);
  await expect.poll(artwork).not.toBe(untouched);
  await page.mouse.up();
  const after = await state(page);
  expect(after.history).toBe(before.history + 1);
  expect(after.ordinary).toBeNull();
  expect(after.mask.strokes).toHaveLength(1);
  expect(after.mask.strokes![0].mode).toBe("hide");
  expect(after.mask.strokes![0].stroke.points[0].x).toBeCloseTo(24, 1);
  expect(await pixels(page)).toEqual([255, 0, 0, 255, 54, 54, 54, 255]);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect((await state(page)).mask).toEqual(before.mask);
  await page.evaluate(() => window.luma.editor.document.redo());
  expect(await pixels(page)).toEqual([255, 0, 0, 255, 54, 54, 54, 255]);
  await page.evaluate(async () => {
    const editor = window.luma.editor,
      file = await editor.saveProject();
    await editor.openProject(new File([file], "paint-filter.luma"));
    editor.document.selectedLayer = editor.document.layers.at(0);
  });
  expect((await state(page)).mask).toEqual(after.mask);
  expect(await pixels(page)).toEqual([255, 0, 0, 255, 54, 54, 54, 255]);
});
test("pencil reveal, cancellation and stale edits preserve filter-mask history", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { editor, LayerMask } = window.luma;
    const layer = editor.document.selectedLayer as InstanceType<
      typeof window.luma.SmartObjectLayer
    >;
    layer.filterMask = new LayerMask({ base: 0, linked: false });
    editor.document.selection = null;
    const modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.configure({ paintTarget: "filter-mask-reveal", size: 8 });
    const before = editor.document.getSnapshot().past.length;
    editor.tools.begin("pencil", { x: 64, y: 48 }, modifiers, 1);
    editor.tools.cancel();
    const cancelled = layer.filterMask.toJSON();
    editor.tools.begin("pencil", { x: 64, y: 48 }, modifiers, 1);
    await editor.tools.end();
    const painted = layer.filterMask.toJSON();
    const history = editor.document.getSnapshot().past.length;
    editor.tools.begin("brush", { x: 70, y: 48 }, modifiers, 1);
    editor.document.name = "External";
    let error = "";
    try {
      await editor.tools.end();
    } catch (reason) {
      error = String(reason);
    }
    return {
      before,
      history,
      cancelled,
      painted,
      error,
      final: layer.filterMask.toJSON(),
      preview: editor.tools.getSnapshot().preview,
    };
  });
  expect(result.cancelled.strokes ?? []).toHaveLength(0);
  expect(result.history).toBe(result.before + 1);
  expect(result.painted.strokes![0]).toMatchObject({
    mode: "reveal",
    stroke: { kind: "pencil", points: [{ x: 64, y: 48 }] },
  });
  expect(result.final).toEqual(result.painted);
  expect(result.preview).toBeNull();
  expect(result.error).toContain("document changed");
});

test("switching paint targets cancels pending work and eraser always hides filter coverage", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor,
      layer = editor.document.selectedLayer as InstanceType<
        typeof window.luma.SmartObjectLayer
      >;
    const before = editor.document.getSnapshot().past.length,
      modifiers = { alt: false, shift: false, pressure: 1 };
    editor.tools.begin("brush", { x: 64, y: 48 }, modifiers, 1);
    editor.tools.configure({ paintTarget: "filter-mask-reveal" });
    await editor.tools.end();
    const cancelled = {
      history: editor.document.getSnapshot().past.length,
      preview: editor.tools.getSnapshot().preview,
      strokes: layer.filterMask!.strokes.length,
    };
    editor.tools.begin("eraser", { x: 64, y: 48 }, modifiers, 1);
    await editor.tools.end();
    return {
      before,
      cancelled,
      mask: layer.filterMask!.toJSON(),
      history: editor.document.getSnapshot().past.length,
    };
  });
  expect(result.cancelled).toEqual({
    history: result.before,
    preview: null,
    strokes: 0,
  });
  expect(result.history).toBe(result.before + 1);
  expect(result.mask.strokes![0].mode).toBe("hide");
  expect((await pixels(page)).slice(0, 4)).toEqual([255, 0, 0, 255]);
});

test("eraser also commits valid hide refinements to ordinary masks", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { editor, LayerMask } = window.luma;
    const layer = editor.document.selectedLayer!;
    layer.mask = new LayerMask({ base: 1 });
    editor.tools.configure({ paintTarget: "mask-reveal" });
    editor.tools.begin(
      "eraser",
      { x: 64, y: 48 },
      { alt: false, shift: false, pressure: 1 },
      1,
    );
    await editor.tools.end();
    return {
      ordinary: layer.mask.toJSON(),
      filter: (
        layer as InstanceType<typeof window.luma.SmartObjectLayer>
      ).filterMask!.toJSON(),
    };
  });
  expect(result.ordinary.strokes![0]).toMatchObject({
    mode: "hide",
    stroke: { kind: "brush" },
  });
  expect(result.filter.strokes ?? []).toHaveLength(0);
});
