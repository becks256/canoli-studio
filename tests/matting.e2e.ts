import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setupWithSubject(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    window.luma.editor.newDocument({ width: 400, height: 300 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");

  // Create a synthetic image with a prominent foreground circle
  await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext("2d")!;

    // Clean background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 120, 120);

    // High contrast salient foreground subject
    ctx.fillStyle = "#c0392b";
    ctx.beginPath();
    ctx.arc(60, 60, 40, 0, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const asset = await editor.assetStore.add(blob, "subject.png");

    const layer = new RasterLayer({
      name: "Subject Layer",
      assetId: asset.id,
      width: 120,
      height: 120,
      x: 140,
      y: 90,
    });
    editor.document.layers.add(layer);
    editor.document.selectedLayer = layer;
  });
}

test.describe("Object Selection and Interactive Matting (T19 / A04)", () => {
  test("selects salient subject from TopBar and context menu with 1-step undo", async ({
    page,
  }) => {
    await setupWithSubject(page);

    // Verify initial state has no selection
    const initialSelection = await page.evaluate(() => {
      return window.luma.editor.document.selection;
    });
    expect(initialSelection).toBeNull();

    // 1. Click "Subject" button in TopBar
    const subjectBtn = page.getByRole("button", {
      name: "Subject",
      exact: true,
    });
    await expect(subjectBtn).toBeVisible();
    await subjectBtn.click();

    // Notification appears
    await expect(page.getByText("Subject selected")).toBeVisible({
      timeout: 5000,
    });

    // Verify document marquee selection has been generated
    const hasSelection = await page.evaluate(() => {
      const sel = window.luma.editor.document.selection;
      return sel !== null && sel.regions.length > 0;
    });
    expect(hasSelection).toBe(true);

    // Single-step undo rolls back selection
    await page.keyboard.press("Control+z");
    const undoneSelection = await page.evaluate(() => {
      return window.luma.editor.document.selection;
    });
    expect(undoneSelection).toBeNull();

    // Redo restores selection
    await page.keyboard.press("Control+Shift+z");
    const redoneSelection = await page.evaluate(() => {
      const sel = window.luma.editor.document.selection;
      return sel !== null && sel.regions.length > 0;
    });
    expect(redoneSelection).toBe(true);

    // Deselect to test Context Menu pathway
    await page.evaluate(() => {
      window.luma.editor.document.deselect();
    });

    // Right-click viewport to open context menu
    const viewport = page.locator(".viewport");
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });

    const contextMenu = page.locator(".canvas-context-menu");
    await expect(contextMenu).toBeVisible();

    const selectSubjectItem = contextMenu.getByRole("menuitem", {
      name: "Select subject",
    });
    await expect(selectSubjectItem).toBeVisible();
    await selectSubjectItem.click();

    await expect(page.getByText("Subject selected")).toBeVisible({
      timeout: 5000,
    });

    // The previous notification can still be visible while the new worker runs.
    await expect.poll(()=>page.evaluate(()=>window.luma.editor.document.selection?.regions.length??0)).toBeGreaterThan(0);
    const ctxMenuSelection = await page.evaluate(() => {
      const sel = window.luma.editor.document.selection;
      return sel !== null && sel.regions.length > 0;
    });
    expect(ctxMenuSelection).toBe(true);
  });

  test("interactive Refine Edge dialog preview modes, slider adjustments, and mask application", async ({
    page,
  }) => {
    await setupWithSubject(page);

    // 1. Open Refine Edge modal via TopBar button
    const refineBtn = page.getByRole("button", {
      name: "Refine",
      exact: true,
    });
    await expect(refineBtn).toBeVisible();
    await refineBtn.click();

    // 2. Verify Refine Edge Dialog opens
    const dialog = page.locator(".refine-edge-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Refine Edge")).toBeVisible();

    // 3. Test Preview Mode selector dropdown
    const viewModeSelect = dialog.locator("select").first();
    await expect(viewModeSelect).toBeVisible();
    await expect(viewModeSelect).toHaveValue("overlay");

    // Switch view modes
    await viewModeSelect.selectOption("on-black");
    await expect(viewModeSelect).toHaveValue("on-black");

    await viewModeSelect.selectOption("on-white");
    await expect(viewModeSelect).toHaveValue("on-white");

    await viewModeSelect.selectOption("on-transparency");
    await expect(viewModeSelect).toHaveValue("on-transparency");

    await viewModeSelect.selectOption("marching-ants");
    await expect(viewModeSelect).toHaveValue("marching-ants");

    // 4. Test slider adjustments
    const smoothInput = dialog.locator("#refine-smooth");
    await expect(smoothInput).toBeVisible();
    await smoothInput.fill("15");

    const featherInput = dialog.locator("#refine-feather");
    await expect(featherInput).toBeVisible();
    await featherInput.fill("3");

    // 5. Test color decontamination toggle
    const decontaminateCheckbox = dialog.locator(
      ".refine-edge-checkbox-label input[type='checkbox']",
    );
    await expect(decontaminateCheckbox).toBeVisible();
    await decontaminateCheckbox.check();
    await expect(decontaminateCheckbox).toBeChecked();

    const decontaminateAmountInput = dialog.locator(
      "#refine-decontaminate-amount",
    );
    await expect(decontaminateAmountInput).toBeVisible();

    // 6. Test Cancel button
    const cancelBtn = dialog.locator("[data-testid='refine-edge-cancel']");
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();
    await expect(dialog).toBeHidden();

    // Verify layer still has no mask
    const hasMaskAfterCancel = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      return selected?.mask !== null && selected?.mask !== undefined;
    });
    expect(hasMaskAfterCancel).toBe(false);

    // 7. Re-open via keyboard shortcut Mod+Alt+R
    await page.keyboard.press("Control+Alt+r");
    await expect(dialog).toBeVisible();

    // 8. Click Apply button to attach bitmap mask
    const applyBtn = dialog.locator("[data-testid='refine-edge-apply']");
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();
    await expect(dialog).toBeHidden();

    await expect(page.getByText("Edge refined")).toBeVisible({
      timeout: 5000,
    });

    // Verify layer has bitmap mask attached
    const maskInfo = await page.evaluate(() => {
      const selected = window.luma.editor.document.selectedLayer;
      return selected?.mask
        ? {
            kind: selected.mask.kind,
            hasAsset: Boolean(selected.mask.assetId),
          }
        : null;
    });

    expect(maskInfo).not.toBeNull();
    expect(maskInfo!.kind).toBe("bitmap");
    expect(maskInfo!.hasAsset).toBe(true);

    // 9. Single-step undo rolls back mask
    await page.keyboard.press("Control+z");
    const maskAfterUndo = await page.evaluate(() => {
      return window.luma.editor.document.selectedLayer?.mask;
    });
    expect(maskAfterUndo).toBeNull();

    // 10. Redo restores the mask
    await page.keyboard.press("Control+Shift+z");
    const maskAfterRedo = await page.evaluate(() => {
      return window.luma.editor.document.selectedLayer?.mask?.kind;
    });
    expect(maskAfterRedo).toBe("bitmap");
  });

  test("removes background directly via context menu with 1-step undo", async ({
    page,
  }) => {
    await setupWithSubject(page);

    // Right-click to open canvas context menu
    const viewport = page.locator(".viewport");
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });

    const contextMenu = page.locator(".canvas-context-menu");
    await expect(contextMenu).toBeVisible();

    const removeBgItem = contextMenu.getByRole("menuitem", {
      name: "Remove background",
    });
    await expect(removeBgItem).toBeVisible();
    await removeBgItem.click();

    // Notification appears
    await expect(page.getByText("Background removed")).toBeVisible({
      timeout: 5000,
    });

    // Verify bitmap mask attached
    const maskKind = await page.evaluate(() => {
      return window.luma.editor.document.selectedLayer?.mask?.kind;
    });
    expect(maskKind).toBe("bitmap");

    // Single-step undo removes mask
    await page.keyboard.press("Control+z");
    const maskUndone = await page.evaluate(() => {
      return window.luma.editor.document.selectedLayer?.mask;
    });
    expect(maskUndone).toBeNull();
  });
});
