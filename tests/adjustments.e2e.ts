import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

async function setNumber(page: Page, label: string, value: string) {
  const input = page.getByRole("spinbutton", {
    name: `${label} value`,
    exact: true,
  });
  await input.fill(value);
  await input.press("Enter");
  return input;
}
async function startSlide(page: Page, slider: Locator, fraction: number) {
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, {
    steps: 6,
  });
}

test("every numeric tool setting has synchronized quick and precise adjustment", async ({
  page,
}) => {
  await page.goto("/");
  const variants = [
    { tool: "Brush tool (B)", labels: ["Size", "Hardness", "Tool opacity"] },
    { tool: "Pencil tool (N)", labels: ["Size", "Tool opacity"] },
    { tool: "Clone brush (S)", labels: ["Size", "Hardness", "Tool opacity"] },
    { tool: "Vector pen (P)", labels: ["Pen width"] },
  ];
  for (const { tool, labels } of variants) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    for (const label of labels) {
      const slider = page.getByRole("slider", { name: label, exact: true });
      await expect(slider).toBeVisible();
      const input = await setNumber(page, label, "32.5");
      await expect(input).toHaveValue("32.5");
      expect(
        await input.evaluate((node: HTMLInputElement) => node.validity.valid),
      ).toBe(true);
      await expect(slider).toHaveAttribute("aria-valuenow", "32.5");
      await startSlide(page, slider, 0.6);
      await page.mouse.up();
      expect(Number(await input.inputValue())).toBeGreaterThan(32.5);
      await slider.focus();
      await slider.press("Home");
      await expect(input).toHaveValue(label === "Size" ? "0.1" : "0");
      await slider.press("End");
      await expect(input).toHaveValue(
        label === "Size" ? "2048" : label === "Pen width" ? "1024" : "100",
      );
    }
  }
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Brush tool (B)", exact: true })
    .click();
  await setNumber(page, "Size", "37.25");
  const input = page.getByRole("spinbutton", {
    name: "Size value",
    exact: true,
  });
  await input.fill("99999");
  await input.press("Enter");
  await expect(input).toHaveValue("37.25");
  await input.fill("12");
  await input.press("Escape");
  await expect(input).toHaveValue("37.25");
  await input.fill("");
  await input.press("Tab");
  await expect(input).toHaveValue("37.25");
  await expect(
    page.getByRole("button", { name: "Brush tool (B)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1180, height: 850 });
  const bar = await page.locator(".tool-options").boundingBox();
  for (const label of ["Size", "Hardness", "Tool opacity"]) {
    const field = await page
      .getByRole("spinbutton", { name: `${label} value`, exact: true })
      .boundingBox();
    expect(field!.x + field!.width).toBeLessThanOrEqual(bar!.x + bar!.width);
  }
  await page.screenshot({ path: "test-results/luma-paired-tool-sliders.png" });
});

test("inspector sliders preview, commit once, cancel and accept precise values", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sample composition", exact: true })
    .click();
  const history = () =>
    page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  const opacity = () =>
    page.evaluate(() => window.luma.editor.document.selectedLayer!.opacity);
  const before = await history();
  const slider = page.getByRole("slider", { name: "Opacity", exact: true });
  await startSlide(page, slider, 0.4);
  expect(await opacity()).toBe(1);
  expect(await history()).toBe(before);
  expect(
    Number(
      await page
        .getByRole("spinbutton", { name: "Opacity value", exact: true })
        .inputValue(),
    ),
  ).toBeLessThan(100);
  await page.mouse.up();
  expect(await opacity()).toBeLessThan(1);
  expect(await history()).toBe(before + 1);
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+z");
  expect(await opacity()).toBe(1);
  await startSlide(page, slider, 0.25);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await opacity()).toBe(1);
  expect(await history()).toBe(before);
  await setNumber(page, "Opacity", "42.5");
  expect(await opacity()).toBe(0.425);
  await setNumber(page, "Exposure", "0.35");
  expect(
    await page.evaluate(() => {
      const layer = window.luma.editor.document.selectedLayer;
      return layer instanceof window.luma.RasterLayer
        ? layer.adjustments.at(0)!.exposure
        : null;
    }),
  ).toBe(0.35);
  await page.getByLabel("Enable drop shadow").check();
  await setNumber(page, "Shadow x", "-12.5");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.selectedLayer!.styles.dropShadow.x,
    ),
  ).toBe(-12.5);
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.x = 9007199254740001;
  });
  const exactPosition = page.getByRole("spinbutton", {
    name: "X",
    exact: true,
  });
  await expect(exactPosition).toHaveValue("9007199254740001");
  const positionHistory = await history();
  await exactPosition.focus();
  await exactPosition.press("Tab");
  expect(await history()).toBe(positionHistory);
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer!.locked = true;
  });
  await expect(slider).toBeDisabled();
  await expect(
    page.getByRole("spinbutton", { name: "Opacity value", exact: true }),
  ).toBeDisabled();
});

test("path width uses the same preview and single-undo slider behavior", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, VectorLayer, VectorPath } = window.luma;
    const layer = editor.document.layers.add(new VectorLayer());
    layer.paths.add(
      new VectorPath({
        points: [
          { x: 20, y: 20 },
          { x: 200, y: 200 },
        ],
        strokeWidth: 3,
      }),
    );
    editor.document.selectedLayer = layer;
  });
  const width = () =>
    page.evaluate(() => {
      const layer = window.luma.editor.document.selectedLayer;
      return layer instanceof window.luma.VectorLayer
        ? layer.paths.at(0)!.strokeWidth
        : null;
    });
  const before = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().past.length,
  );
  await startSlide(
    page,
    page.getByRole("slider", { name: "Path stroke width", exact: true }),
    0.35,
  );
  expect(await width()).toBe(3);
  await page.mouse.up();
  expect(await width()).toBeGreaterThan(3);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(before + 1);
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+z");
  expect(await width()).toBe(3);
});

test("Adjustment layer creation, inspector controls, histogram display, and undo/redo in UI", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open sample composition", exact: true })
    .click();

  const historyLength = () =>
    page.evaluate(() => window.luma.editor.document.getSnapshot().past.length);
  const initialHistory = await historyLength();

  // Add adjustment layer via the UI button in LayersPanel
  const addBtn = page.getByTitle("New adjustment layer");
  await expect(addBtn).toBeVisible();
  await addBtn.click();
  await expect(page.locator(".toast.error")).toHaveCount(0);

  // Verify adjustment layer is added and selected
  const isAdjustment = await page.evaluate(() => {
    const selected = window.luma.editor.document.selectedLayer;
    return selected instanceof window.luma.AdjustmentLayer;
  });
  expect(isAdjustment).toBe(true);
  expect(await historyLength()).toBe(initialHistory + 1);

  // Inspector should show Adjustment heading, type dropdown, and curves svg
  await expect(
    page.getByRole("heading", { name: "Adjustment", exact: false }),
  ).toBeVisible();
  const typeSelect = page.getByLabel("Adjustment type");
  await expect(typeSelect).toBeVisible();
  await expect(typeSelect).toHaveValue("curves");
  await expect(page.locator(".curves-svg")).toBeVisible();
  await expect(page.locator(".histogram-svg")).toBeVisible();

  // Switch to Levels
  await typeSelect.selectOption("levels");
  await expect(page.locator(".levels-editor")).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Black point value" }),
  ).toHaveValue("0");

  // Edit black point via number input
  await setNumber(page, "Black point", "28");
  const inputBlack = await page.evaluate(() => {
    const selected = window.luma.editor.document.selectedLayer;
    return (selected as any).adjustment.rgb.inputBlack;
  });
  expect(inputBlack).toBe(28);

  // Undo edit
  await page.keyboard.press("Control+z");
  const undoneBlack = await page.evaluate(() => {
    const selected = window.luma.editor.document.selectedLayer;
    return (selected as any).adjustment.rgb.inputBlack;
  });
  expect(undoneBlack).toBe(0);

  // Redo edit
  await page.keyboard.press("Control+Shift+z");
  const redoneBlack = await page.evaluate(() => {
    const selected = window.luma.editor.document.selectedLayer;
    return (selected as any).adjustment.rgb.inputBlack;
  });
  expect(redoneBlack).toBe(28);
});

test("Adjustment layer masked stack ordering and alpha preservation in document rendering", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      AdjustmentLayer,
      LayerMask,
      MarqueeSelection,
    } = window.luma;

    const doc = new Document({ width: 64, height: 64 });
    const paint = doc.layers.add(new PaintLayer());
    // Fill left half (x: 0..32) with #4488cc, right half (x: 32..64) transparent
    paint.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 32, height: 64 },
        color: "#4488cc",
      }),
    );

    // Initial render of backdrop
    const unadjusted = await editor.renderer.render(
      doc.getSnapshot().document,
      editor.assetStore,
      { cache: false, readback: true },
    );
    const unadjustedPixels = unadjusted
      .getContext("2d")!
      .getImageData(0, 0, 64, 64).data;

    // Add Levels adjustment layer that brightens significantly
    const adj = doc.layers.add(new AdjustmentLayer());
    adj.setLevels({
      inputBlack: 0,
      inputWhite: 128,
      gamma: 1.5,
      outputBlack: 50,
      outputWhite: 255,
    });

    const adjusted = await editor.renderer.render(
      doc.getSnapshot().document,
      editor.assetStore,
      { cache: false, readback: true },
    );
    const adjustedPixels = adjusted
      .getContext("2d")!
      .getImageData(0, 0, 64, 64).data;

    let transparentPixelsPreserved = true;
    let opaquePixelsAdjusted = false;

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        if (x >= 32) {
          // Transparent region must strictly stay 0 alpha and 0 color
          if (
            adjustedPixels[i] !== 0 ||
            adjustedPixels[i + 1] !== 0 ||
            adjustedPixels[i + 2] !== 0 ||
            adjustedPixels[i + 3] !== 0
          ) {
            transparentPixelsPreserved = false;
          }
        } else {
          // Opaque region should be modified
          if (adjustedPixels[i] !== unadjustedPixels[i]) {
            opaquePixelsAdjusted = true;
          }
          // But alpha should stay 255
          if (adjustedPixels[i + 3] !== 255) {
            transparentPixelsPreserved = false;
          }
        }
      }
    }

    // Now attach a selection mask covering only top-left quarter (x: 0..16, y: 0..32)
    adj.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 16,
        height: 32,
      }),
    });

    const masked = await editor.renderer.render(
      doc.getSnapshot().document,
      editor.assetStore,
      { cache: false, readback: true },
    );
    const maskedPixels = masked
      .getContext("2d")!
      .getImageData(0, 0, 64, 64).data;

    let maskedRegionAdjusted = false;
    let unmaskedRegionUnchanged = true;

    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const i = (y * 64 + x) * 4;
        if (x < 16 && y < 32) {
          // Inside mask: should match adjusted
          if (Math.abs(maskedPixels[i] - adjustedPixels[i]) <= 1) {
            maskedRegionAdjusted = true;
          }
        } else {
          // Outside mask: should match original unadjusted backdrop
          if (Math.abs(maskedPixels[i] - unadjustedPixels[i]) > 1) {
            unmaskedRegionUnchanged = false;
          }
        }
      }
    }

    return {
      transparentPixelsPreserved,
      opaquePixelsAdjusted,
      maskedRegionAdjusted,
      unmaskedRegionUnchanged,
    };
  });

  expect(result.transparentPixelsPreserved).toBe(true);
  expect(result.opaquePixelsAdjusted).toBe(true);
  expect(result.maskedRegionAdjusted).toBe(true);
  expect(result.unmaskedRegionUnchanged).toBe(true);
});

test("Adjustment layer project serialization and load round-trip", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      PaintLayer,
      PaintFill,
      AdjustmentLayer,
      LayerMask,
      MarqueeSelection,
    } = window.luma;
    const projectPath = "/src/core/project.ts";
    const { serializeProject, readProject } = await import(projectPath);

    const doc = new Document({ width: 120, height: 80 });
    const paint = doc.layers.add(new PaintLayer());
    paint.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 120, height: 80 },
        color: "#112233",
      }),
    );

    const adj = doc.layers.add(
      new AdjustmentLayer({
        name: "Graded Curves",
        opacity: 0.85,
        blendMode: "multiply",
      }),
    );
    adj.setCurves({
      rgb: [
        { x: 0, y: 0 },
        { x: 50, y: 30 },
        { x: 200, y: 220 },
        { x: 255, y: 255 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 128, y: 150 },
        { x: 255, y: 255 },
      ],
    });
    adj.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "ellipse",
        x: 10,
        y: 10,
        width: 100,
        height: 60,
      }),
    });

    const blob = await serializeProject(doc.toJSON(), editor.assetStore);
    const read = await readProject(blob);

    const restoredDoc = read.document;
    const restoredLayers = restoredDoc.children;
    const restoredAdj = restoredLayers.find(
      (l: any) => l.name === "Graded Curves",
    ) as any;

    return {
      schemaVersion: restoredDoc.schemaVersion,
      layerCount: restoredLayers.length,
      kind: restoredAdj?.kind,
      opacity: restoredAdj?.opacity,
      blendMode: restoredAdj?.blendMode,
      adjustmentKind: restoredAdj?.adjustment?.kind,
      rgbPoints: restoredAdj?.adjustment?.rgb,
      redPoints: restoredAdj?.adjustment?.red,
      hasMask: Boolean(restoredAdj?.mask),
    };
  });

  expect(result.schemaVersion).toBe(40);
  expect(result.layerCount).toBe(2);
  expect(result.kind).toBe("adjustment");
  expect(result.opacity).toBe(0.85);
  expect(result.blendMode).toBe("multiply");
  expect(result.adjustmentKind).toBe("curves");
  expect(result.rgbPoints).toHaveLength(4);
  expect(result.redPoints).toHaveLength(3);
  expect(result.hasMask).toBe(true);
});

test("Curves adjustment layer multi-tile rendering succeeds without detached ArrayBuffer error", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, AdjustmentLayer, PaintLayer, PaintFill } =
      window.luma;
    const doc = new Document({ width: 1600, height: 1200 });
    const paint = doc.layers.add(new PaintLayer());
    paint.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 1600, height: 1200 },
        color: "#808080",
      }),
    );
    const adj = doc.layers.add(new AdjustmentLayer());
    adj.setCurves({
      rgb: [
        { x: 0, y: 0 },
        { x: 128, y: 160 },
        { x: 255, y: 255 },
      ],
    });
    try {
      const rendered = await editor.renderer.render(
        doc.getSnapshot().document,
        editor.assetStore,
        { cache: false, readback: true },
      );
      return { success: true, width: rendered.width, height: rendered.height };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
});

test("adjustment histogram samples its composed input stack, including paint and preceding adjustments", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/core/histogram.ts";
    const { adjustmentBackdrop, computeHistogram } = await import(path);
    const { PaintLayer, PaintFill, AdjustmentLayer, LayerGroup, editor } =
      window.luma;
    editor.newDocument({ width: 16, height: 16 });
    const doc = editor.document;
    const outer = doc.layers.add(new PaintLayer());
    outer.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        color: "#ff0000",
      }),
    );
    const group = doc.layers.add(new LayerGroup({ opacity: 0.2 }));
    const paint = group.layers.add(new PaintLayer());
    paint.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        color: "#404040",
      }),
    );
    group.layers.add(
      new AdjustmentLayer({
        adjustment: { kind: "tone", exposure: 1, contrast: 0, saturation: 0 },
      }),
    );
    const selected = group.layers.add(new AdjustmentLayer());
    const above = group.layers.add(new PaintLayer());
    above.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 16, height: 16 },
        color: "#ffffff",
      }),
    );
    const backdrop = adjustmentBackdrop(doc.toJSON(), selected.id)!;
    const canvas = await editor.renderer.render(backdrop, editor.assetStore, {
      cache: false,
    });
    const hist = computeHistogram(
      canvas.getContext("2d")!.getImageData(0, 0, 16, 16).data,
    );
    doc.selectedLayer = selected;
    return { red128: hist.red[128], total: hist.totalPixels };
  });
  expect(result).toEqual({ red128: 256, total: 256 });
  await expect(page.locator(".histogram-view").first()).toBeVisible();
});
