import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.luma.editor.newDocument({ width: 600, height: 400 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("Professional foundation increments (T16: F06, F07, F08, F11)", () => {
  test("F06: rich artist brush engine and eraser tool with dynamics", async ({
    page,
  }) => {
    await setup(page);

    // 1. Select Eraser tool via ToolRail
    const eraserButton = page.getByRole("button", {
      name: "Eraser tool (E)",
      exact: true,
    });
    await expect(eraserButton).toBeVisible();
    await eraserButton.click();
    await expect(eraserButton).toHaveClass(/active/);

    // 2. Verify tool options header indicates Eraser
    const toolOptions = page.locator(".tool-options");
    await expect(toolOptions).toBeVisible();
    await expect(toolOptions.locator("strong")).toHaveText("Eraser");

    // 3. Verify Flow, Spacing, Smoothing sliders and pressure checkboxes are present
    const flowSlider = toolOptions.getByRole("slider", { name: "Flow" });
    await expect(flowSlider).toBeVisible();

    const spacingSlider = toolOptions.getByRole("slider", { name: "Spacing" });
    await expect(spacingSlider).toBeVisible();

    const smoothingSlider = toolOptions.getByRole("slider", {
      name: "Smoothing",
    });
    await expect(smoothingSlider).toBeVisible();

    const pressureSizeCheck = toolOptions.getByLabel("Pressure controls size");
    await expect(pressureSizeCheck).toBeVisible();
    await pressureSizeCheck.check();
    await expect(pressureSizeCheck).toBeChecked();

    const pressureOpacityCheck = toolOptions.getByLabel(
      "Pressure controls opacity",
    );
    await expect(pressureOpacityCheck).toBeVisible();
    await pressureOpacityCheck.check();
    await expect(pressureOpacityCheck).toBeChecked();

    // 4. Perform an eraser gesture on canvas
    const viewport = page.locator(".viewport");
    await viewport.hover({ position: { x: 250, y: 180 } });
    await page.mouse.down();
    await page.mouse.move(300, 220);
    await page.mouse.move(350, 240);
    await page.mouse.up();

    // Verify a paint layer was created and selected
    const layerCount = await page.evaluate(() => {
      return window.luma.editor.document.layers.length;
    });
    expect(layerCount).toBeGreaterThan(0);

    // 5. Test undo
    const canUndo = await page.evaluate(
      () => window.luma.editor.document.canUndo,
    );
    expect(canUndo).toBe(true);

    await page.keyboard.press("Control+z");
    const canRedo = await page.evaluate(
      () => window.luma.editor.document.canRedo,
    );
    expect(canRedo).toBe(true);
  });

  test("F07: vector & shape editing with rectangle, ellipse, and polygon primitives", async ({
    page,
  }) => {
    await setup(page);

    // 1. Switch to Pen tool (P)
    await page.keyboard.press("p");
    const toolOptions = page.locator(".tool-options");
    await expect(toolOptions.locator("strong")).toHaveText("Pen");

    // 2. Click + Rectangle button
    const addRectBtn = toolOptions.getByRole("button", { name: "+ Rectangle" });
    await expect(addRectBtn).toBeVisible();
    await addRectBtn.click();

    // Verify vector layer created with rectangle path
    let pathInfo = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      if (!selected || selected.kind !== "vector") return null;
      return {
        pathCount: (selected as any).paths.length,
        anchors: (selected as any).paths.at(0).points.length,
        closed: (selected as any).paths.at(0).closed,
      };
    });
    expect(pathInfo).not.toBeNull();
    expect(pathInfo?.pathCount).toBe(1);
    expect(pathInfo?.anchors).toBe(4);
    expect(pathInfo?.closed).toBe(true);

    // 3. Click + Ellipse button
    const addEllipseBtn = toolOptions.getByRole("button", {
      name: "+ Ellipse",
    });
    await expect(addEllipseBtn).toBeVisible();
    await addEllipseBtn.click();

    pathInfo = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      if (!selected || selected.kind !== "vector") return null;
      return {
        pathCount: (selected as any).paths.length,
        anchors: (selected as any).paths.at(1).points.length,
        closed: (selected as any).paths.at(1).closed,
      };
    });
    expect(pathInfo?.pathCount).toBe(2);
    expect(pathInfo?.anchors).toBe(4);

    // 4. Click + Polygon button
    const addPolygonBtn = toolOptions.getByRole("button", {
      name: "+ Polygon",
    });
    await expect(addPolygonBtn).toBeVisible();
    await addPolygonBtn.click();

    pathInfo = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      if (!selected || selected.kind !== "vector") return null;
      return {
        pathCount: (selected as any).paths.length,
        anchors: (selected as any).paths.at(2).points.length,
        closed: (selected as any).paths.at(2).closed,
      };
    });
    expect(pathInfo?.pathCount).toBe(3);
    expect(pathInfo?.anchors).toBe(5); // Default 5 sides

    // 5. Test undo reverts the polygon
    await page.keyboard.press("Control+z");
    const countAfterUndo = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      return (selected as any)?.paths?.length ?? 0;
    });
    expect(countAfterUndo).toBe(2);
  });

  test("F08: professional typography with font styling, weight, tracking, and direction", async ({
    page,
  }) => {
    await setup(page);

    // 1. Add a text layer programmatically
    await page.evaluate(() => {
      const { editor, TextLayer } = window.luma;
      const textLayer = new TextLayer({
        text: "Professional Typography Increment",
        fontSize: 32,
        fontFamily: "sans-serif",
      });
      editor.document.layers.add(textLayer);
      editor.document.selectedLayer = textLayer;
    });

    // 2. Locate Typography section in inspector
    const typoSection = page.locator(".typography-panel");
    await expect(typoSection).toBeVisible();

    // 3. Check Weight selector
    const weightSelect = typoSection.getByLabel("Weight");
    await expect(weightSelect).toBeVisible();
    await weightSelect.selectOption("bold");

    // 4. Check Style toggle
    const italicOption = typoSection.getByRole("button", { name: "Italic" });
    await expect(italicOption).toBeVisible();
    await italicOption.click();

    // 5. Check Tracking slider
    const trackingSlider = typoSection.getByRole("slider", {
      name: "Tracking",
    });
    await expect(trackingSlider).toBeVisible();

    // 6. Check Direction toggle
    const rtlOption = typoSection.getByRole("button", { name: "RTL" });
    await expect(rtlOption).toBeVisible();
    await rtlOption.click();

    // Verify text layer properties were committed to document
    const textProps = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer as any;
      return {
        fontWeight: selected?.fontWeight,
        fontStyle: selected?.fontStyle,
        direction: selected?.direction,
      };
    });
    expect(textProps.fontWeight).toBe("bold");
    expect(textProps.fontStyle).toBe("italic");
    expect(textProps.direction).toBe("rtl");
  });

  test("F11: multi-format export with honest capability reports", async ({
    page,
  }) => {
    await setup(page);

    // 1. Add a vector layer and paint layer so Export... button is active and mixed content exists
    await page.evaluate(() => {
      const { editor, VectorLayer, VectorPath, PaintLayer, PaintFill } = window.luma;
      const vLayer = new VectorLayer({ name: "Branding Shape" });
      vLayer.paths.add(
        VectorPath.rectangle({ x: 50, y: 50, width: 200, height: 100 }),
      );
      editor.document.layers.add(vLayer);
      const pLayer = new PaintLayer({ name: "Paint Art" });
      pLayer.strokes.add(new PaintFill({bounds:{x:20,y:200,width:100,height:50},color:"#804020"}));
      editor.document.layers.add(pLayer);
      editor.document.selectedLayer = vLayer;
    });

    // 2. Open Export Dialog via TopBar button
    const exportBtn = page.getByRole("button", {
      name: "Export…",
      exact: true,
    });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // 3. Verify dialog is open
    const exportDialog = page.locator(".export-dialog");
    await expect(exportDialog).toBeVisible();
    await expect(exportDialog.locator("#export-dialog-title")).toHaveText(
      "Export Document",
    );

    // 4. Check PNG capability report
    await expect(
      exportDialog.locator(".export-capabilities-grid"),
    ).toBeVisible();
    await expect(exportDialog).toContainText(
      "Full alpha channel (transparency)",
    );

    // 5. Switch to JPEG format
    const formatSelect = exportDialog.getByLabel("Format");
    await formatSelect.selectOption("jpeg");

    // Verify JPEG-specific controls and warnings
    await expect(
      exportDialog.getByLabel("JPEG background color"),
    ).toBeVisible();
    await expect(
      exportDialog.getByRole("slider", { name: "Quality" }),
    ).toBeVisible();
    await expect(exportDialog).toContainText("does not support transparency");

    // 6. Switch to WebP format
    await formatSelect.selectOption("webp");
    await expect(
      exportDialog.getByRole("slider", { name: "Quality" }),
    ).toBeVisible();

    // 7. Switch to SVG format
    await formatSelect.selectOption("svg");
    await expect(exportDialog).toContainText(
      "Infinitely scalable Bézier vector paths",
    );
    await expect(exportDialog).toContainText(
      "Editable paint dab/fill geometry",
    );

    // 8. Trigger SVG export and verify clean completion
    const submitExportBtn = exportDialog.getByRole("button", {
      name: /Export \.svg/i,
    });
    await expect(submitExportBtn).toBeVisible();
    await submitExportBtn.click();

    // Dialog should dismiss on export completion
    await expect(exportDialog).toHaveCount(0);
  });
});
