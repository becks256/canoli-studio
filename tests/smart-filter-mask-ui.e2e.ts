import { expect, test, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, Document, TextLayer, SmartToneFilter, MarqueeSelection } =
      window.luma;
    editor.newDocument({ width: 128, height: 64 });
    const master = new Document({ width: 64, height: 64 });
    master.layers.add(new TextLayer({ text: "Art" }));
    const key = editor.document.defineComponent(master),
      first = editor.document.placeSmartObject(key);
    first.addFilter(new SmartToneFilter({ saturation: -100 }));
    editor.document.placeSmartObject(key, { x: 64 });
    editor.document.selectedLayer = first;
    editor.document.selection = new MarqueeSelection({
      shape: "rectangle",
      x: 8,
      y: 8,
      width: 32,
      height: 32,
    });
  });
  await expect(
    page.getByRole("button", { name: "Hide all filters", exact: true }),
  ).toBeEnabled();
}
async function state(page: Page) {
  return page.evaluate(() => {
    const doc = window.luma.editor.document;
    const layer = doc.layers.at(0) as InstanceType<
      typeof window.luma.SmartObjectLayer
    >;
    return {
      mask: layer.filterMask?.toJSON() ?? null,
      history: doc.getSnapshot().past.length,
      source: JSON.stringify(doc.toJSON().components),
    };
  });
}
test("filter-mask controls create, preview, adjust, remove and persist independently of layer masks", async ({
  page,
}) => {
  await setup(page);
  const before = await state(page);
  await page
    .getByRole("button", { name: "Hide all filters", exact: true })
    .click();
  expect((await state(page)).mask).toMatchObject({ kind: "paint", base: 0 });
  const density = page.getByRole("spinbutton", {
    name: "Filter mask density value",
    exact: true,
  });
  await density.fill("70");
  await density.press("Enter");
  expect((await state(page)).mask).toMatchObject({ density: 0.7 });
  const slider = page.getByRole("slider", {
    name: "Filter mask density",
    exact: true,
  });
  const committed = await state(page);
  await slider.focus();
  await page.keyboard.down("ArrowRight");
  await expect(density).toHaveValue("71");
  expect(await state(page)).toEqual(committed);
  await page.keyboard.press("Escape");
  await page.keyboard.up("ArrowRight");
  await expect(density).toHaveValue("70");
  await slider.press("ArrowRight");
  expect((await state(page)).history).toBe(committed.history + 1);
  await page
    .getByRole("checkbox", { name: "Invert filter mask", exact: true })
    .check();
  await page
    .getByRole("button", {
      name: "Replace filter mask from selection",
      exact: true,
    })
    .click();
  expect((await state(page)).mask).toMatchObject({
    kind: "selection",
    linked: false,
  });
  const feather = page.getByRole("spinbutton", {
    name: "Filter mask feather value",
    exact: true,
  });
  await feather.fill("2.5");
  await feather.press("Enter");
  await page
    .getByRole("region", { name: "Filter mask", exact: true })
    .scrollIntoViewIfNeeded();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(
      (theme) =>
        window.dispatchEvent(
          new CustomEvent("luma:set-appearance", { detail: theme }),
        ),
      theme,
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page
      .getByRole("region", { name: "Filter mask", exact: true })
      .screenshot({ path: `/tmp/luma-filter-mask-${theme}.png` });
  }
  await page
    .getByRole("checkbox", { name: "Enable filter mask", exact: true })
    .uncheck();
  await expect(feather).toBeDisabled();
  const saved = await state(page);
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "ui-masks.luma"));
    editor.document.selectedLayer = editor.document.layers.at(0);
  });
  expect((await state(page)).mask).toEqual(saved.mask);
  expect((await state(page)).source).toBe(before.source);
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.at(0)!.mask),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Remove filter mask", exact: true })
    .click();
  expect((await state(page)).mask).toBeNull();
  await page.evaluate(() => window.luma.editor.document.undo());
  expect((await state(page)).mask).toEqual(saved.mask);
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.locked = true;
  });
  await expect(
    page.getByRole("button", { name: "Remove filter mask", exact: true }),
  ).toBeDisabled();
});
test("filter-mask slider rejects stale external edits and cancels on selection changes", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Reveal all filters", exact: true })
    .click();
  const slider = page.getByRole("slider", {
    name: "Filter mask density",
    exact: true,
  });
  await slider.focus();
  await page.keyboard.down("ArrowLeft");
  await page.evaluate(() => {
    window.luma.editor.document.name = "External";
  });
  const changed = await state(page);
  await page.keyboard.up("ArrowLeft");
  expect(await state(page)).toEqual(changed);
  await expect(page.getByRole("alert")).toContainText(
    "filter-mask target changed",
  );
  await slider.focus();
  await page.keyboard.down("ArrowLeft");
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.selectedLayer = doc.layers.at(1);
  });
  await page.keyboard.up("ArrowLeft");
  expect(await state(page)).toEqual(changed);
  await expect(
    page.getByRole("button", { name: "Remove filter mask", exact: true }),
  ).toHaveCount(0);
});

test("Follow artwork toggle preserves transformed filter-mask pixels, undo and script parity", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const {
      editor,
      RasterLayer,
      LayerMask,
      MarqueeSelection,
      GaussianBlurFilter,
      AffineTransform,
    } = window.luma;
    editor.newDocument({ width: 160, height: 100 });
    const canvas = new OffscreenCanvas(32, 24),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#e04020";
    c.fillRect(4, 4, 24, 16);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob(),
      "Source",
      undefined,
      false,
    );
    const raster = editor.document.layers.add(
      new RasterLayer({ assetId: asset.id, width: 32, height: 24 }),
    );
    const instance = raster.convertToSmartObject();
    instance.width = 64;
    instance.height = 36;
    instance.x = 35;
    instance.y = 25;
    instance.transform = AffineTransform.rotation(0.3);
    instance.addFilter(new GaussianBlurFilter({ sigma: 2 }));
    instance.filterMask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "ellipse",
        x: 2,
        y: 2,
        width: 16,
        height: 18,
      }),
      feather: 2,
    });
    editor.document.selectedLayer = instance;
  });
  async function pixels() {
    return page.evaluate(async () => {
      const editor = window.luma.editor;
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const result = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 160, 100).data,
      ];
      canvas.width = canvas.height = 0;
      return result;
    });
  }
  const original = await pixels(),
    before = await state(page);
  const checkbox = page.getByRole("checkbox", {
    name: "Link filter mask to artwork",
    exact: true,
  });
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await expect(checkbox).not.toBeChecked();
  expect((await state(page)).history).toBe(before.history + 1);
  const unlinked = await pixels();
  expect(
    Math.max(...unlinked.map((v, i) => Math.abs(v - original[i]))),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(await pixels()).toEqual(original);
  await page.evaluate(() => window.luma.editor.document.redo());
  await page.evaluate(() =>
    window.luma.editor.runScript(
      "document.selectedLayer.setFilterMaskLinked(true);",
    ),
  );
  await expect(checkbox).toBeChecked();
  const relinked = await pixels();
  expect(
    Math.max(...relinked.map((v, i) => Math.abs(v - original[i]))),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.locked = true;
  });
  await expect(checkbox).toBeDisabled();
});
