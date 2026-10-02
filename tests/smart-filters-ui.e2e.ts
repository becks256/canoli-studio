import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    editor.newDocument({ width: 96, height: 64 });
    const canvas = new OffscreenCanvas(32, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#e85630";
    c.fillRect(8, 8, 16, 16);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob(),
      "Original",
      undefined,
      false,
    );
    const raster = editor.document.layers.add(
      new RasterLayer({
        assetId: asset.id,
        width: 32,
        height: 32,
        x: 8,
        y: 16,
      }),
    );
    const first = raster.convertToSmartObject();
    first.name = "First";
    const second = editor.document.placeSmartObject(first.componentId, {
      name: "Second",
      x: 56,
      y: 16,
    });
    editor.document.selectedLayer = first;
    return second.id;
  });
  await expect(
    page.getByRole("button", { name: "Add filter", exact: true }),
  ).toBeEnabled();
}
async function state(page: Page) {
  return page.evaluate(() => {
    const document = window.luma.editor.document,
      layer = document.selectedLayer as InstanceType<
        typeof window.luma.SmartObjectLayer
      >;
    return {
      filters: layer.smartFilters,
      history: document.getSnapshot().past.length,
      revision: document.getSnapshot().revision,
      source: JSON.stringify(document.toJSON().components),
    };
  });
}

test("Inspector filters pair exact inputs with keyboard and pointer previews in single undo steps", async ({
  page,
}) => {
  await setup(page);
  const original = await state(page);
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  const card = page.getByRole("group", {
    name: "Gaussian blur filter 1",
    exact: true,
  });
  const number = card.getByRole("spinbutton", {
    name: "Blur size value",
    exact: true,
  });
  const slider = card.getByRole("slider", { name: "Blur size", exact: true });
  await number.fill("2.5");
  await number.press("Enter");
  await expect(slider).toHaveAttribute("aria-valuenow", "2.5");
  const precise = await state(page);
  expect(precise.filters[0]).toMatchObject({
    kind: "gaussian-blur",
    sigma: 2.5,
  });
  expect(precise.history).toBe(original.history + 2);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toBeFocused();
  await expect(number).toHaveValue("2.7");
  const keyboard = await state(page);
  expect(keyboard.history).toBe(precise.history + 2);
  await page.keyboard.down("ArrowRight");
  await expect(number).toHaveValue("2.8");
  expect((await state(page)).history).toBe(keyboard.history);
  await page.keyboard.press("Escape");
  await page.keyboard.up("ArrowRight");
  await expect(number).toHaveValue("2.7");
  expect(await state(page)).toEqual(keyboard);
  await slider.scrollIntoViewIfNeeded();
  const bounds = (await slider.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.045,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.09,
    bounds.y + bounds.height / 2,
    { steps: 4 },
  );
  expect((await state(page)).history).toBe(keyboard.history);
  await page.mouse.up();
  const dragged = await state(page);
  expect(dragged.history).toBe(keyboard.history + 1);
  expect(dragged.filters[0]).not.toEqual(keyboard.filters[0]);
  expect(dragged.source).toBe(original.source);
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+z");
  await expect(number).toHaveValue("2.7");
  expect((await state(page)).filters).toEqual(keyboard.filters);
  await number.fill("-1");
  await number.press("Enter");
  await expect(number).toHaveValue("2.7");
});

test("Inspector filters reorder, disable, remove and persist independently in both color modes", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Filter type", exact: true })
    .selectOption("unsharp-mask");
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  const sharpen = page.getByRole("group", {
    name: "Unsharp mask filter 2",
    exact: true,
  });
  for (const label of ["Sharpen size", "Amount", "Threshold"]) {
    await expect(
      sharpen.getByRole("slider", { name: label, exact: true }),
    ).toBeVisible();
    await expect(
      sharpen.getByRole("spinbutton", { name: `${label} value`, exact: true }),
    ).toBeVisible();
  }
  await sharpen
    .getByRole("spinbutton", { name: "Amount value", exact: true })
    .fill("1.75");
  await sharpen
    .getByRole("spinbutton", { name: "Amount value", exact: true })
    .press("Enter");
  await page
    .getByRole("combobox", { name: "Filter type", exact: true })
    .selectOption("tone");
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  const tone = page.getByRole("group", { name: "Tone filter 3", exact: true });
  for (const label of ["Exposure", "Contrast", "Saturation"]) {
    await expect(
      tone.getByRole("slider", { name: label, exact: true }),
    ).toBeVisible();
    await expect(
      tone.getByRole("spinbutton", { name: `${label} value`, exact: true }),
    ).toBeVisible();
  }
  const before = await state(page);
  await tone
    .getByRole("button", { name: "Move Tone earlier", exact: true })
    .click();
  expect((await state(page)).filters.map((filter) => filter.kind)).toEqual([
    "gaussian-blur",
    "tone",
    "unsharp-mask",
  ]);
  await page
    .getByRole("checkbox", { name: "Enable Tone filter 2", exact: true })
    .uncheck();
  await expect(
    page
      .getByRole("group", { name: "Tone filter 2", exact: true })
      .getByRole("slider", { name: "Exposure", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove Gaussian blur filter", exact: true })
    .click();
  const removed = await state(page);
  expect(removed.history).toBe(before.history + 3);
  expect(removed.filters.map((filter) => filter.kind)).toEqual([
    "tone",
    "unsharp-mask",
  ]);
  const integrity = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const source = editor.assetStore.values()[0],
      bytes = [...new Uint8Array(await source.blob.arrayBuffer())];
    const id = editor.document.selectedLayer!.id;
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "filters.luma"));
    editor.document.selectedLayer = editor.document.getLayer(id);
    return {
      sourceEqual:
        JSON.stringify(bytes) ===
        JSON.stringify([
          ...new Uint8Array(
            await editor.assetStore.get(source.id).blob.arrayBuffer(),
          ),
        ]),
      otherFilters: (
        editor.document.layers.at(1) as InstanceType<
          typeof window.luma.SmartObjectLayer
        >
      ).smartFilters,
    };
  });
  expect(integrity).toEqual({ sourceEqual: true, otherFilters: [] });
  expect((await state(page)).filters).toEqual(removed.filters);
  await page
    .getByRole("region", { name: "Smart filters", exact: true })
    .scrollIntoViewIfNeeded();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("luma:set-appearance", { detail: "dark" }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "/tmp/luma-smart-filters-dark.png" });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("luma:set-appearance", { detail: "light" }),
    ),
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "/tmp/luma-smart-filters-light.png" });
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.locked = true;
  });
  await expect(
    page.getByRole("button", { name: "Add filter", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("checkbox", { name: "Enable Tone filter 1", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Remove Tone filter", exact: true }),
  ).toBeDisabled();
});

test("external edits and changed selections cannot commit stale filter previews", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Blur size", exact: true });
  await slider.focus();
  await page.keyboard.down("ArrowRight");
  await expect(
    page.getByRole("spinbutton", { name: "Blur size value", exact: true }),
  ).toHaveValue("1.1");
  await page.evaluate(() => {
    window.luma.editor.document.name = "External edit";
  });
  const edited = await state(page);
  await page.keyboard.up("ArrowRight");
  expect(await state(page)).toEqual(edited);
  await expect(page.getByRole("alert")).toContainText("filter target changed");
  await slider.focus();
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.selectedLayer = doc.layers.at(1);
  });
  await page.keyboard.up("ArrowRight");
  expect((await state(page)).filters).toEqual([]);
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.selectedLayer = doc.layers.at(0);
  });
  await expect(
    page.getByRole("spinbutton", { name: "Blur size value", exact: true }),
  ).toHaveValue("1");
});
