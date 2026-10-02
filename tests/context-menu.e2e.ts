import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 400, height: 300 }),
  );
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("Canvas Context Menu", () => {
  test("opens on right click on the canvas viewport and closes on Escape", async ({
    page,
  }) => {
    await setup(page);
    const viewport = page.locator(".viewport");

    // Initially context menu is not visible
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);

    // Right click on viewport
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    const menu = page.locator(".canvas-context-menu");
    await expect(menu).toBeVisible();

    // Verify quick tools toolbar is present
    await expect(menu.locator(".context-tools-grid")).toBeVisible();
    await expect(menu.getByRole("button", { name: "Brush (B)" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Move (V)" })).toBeVisible();

    // Press Escape to dismiss
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("allows switching tools and exposes real-time tool options", async ({
    page,
  }) => {
    await setup(page);
    const viewport = page.locator(".viewport");

    // Right click to open menu
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    const menu = page.locator(".canvas-context-menu");
    await expect(menu).toBeVisible();

    // Switch to Brush tool from context menu
    const brushBtn = menu.getByRole("button", { name: "Brush (B)" });
    await brushBtn.click();

    // Context menu should remain open with Brush Options
    await expect(menu.locator(".context-tool-options-title")).toContainText(
      "Brush Options",
    );
    await expect(
      menu.getByRole("group", { name: "Size adjustment" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("group", { name: "Hardness adjustment" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("group", { name: "Opacity adjustment" }),
    ).toBeVisible();

    // Tool rail should also reflect active Brush tool
    await expect(
      page.getByRole("button", { name: "Brush tool (B)" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Now switch to Marquee tool
    const marqueeBtn = menu.getByRole("button", { name: "Marquee (M)" });
    await marqueeBtn.click();
    await expect(menu.locator(".context-tool-options-title")).toContainText(
      "Marquee Options",
    );
    await expect(menu.getByRole("combobox", { name: "Shape" })).toBeVisible();
    await expect(menu.getByRole("combobox", { name: "Mode" })).toBeVisible();

    // Close using close icon button
    await menu.getByRole("button", { name: "Close menu (Esc)" }).click();
    await expect(menu).toHaveCount(0);
  });

  test("executes selection and view actions from the context menu", async ({
    page,
  }) => {
    await setup(page);
    const viewport = page.locator(".viewport");

    // Open context menu and click "Select all"
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    const menu = page.locator(".canvas-context-menu");
    await expect(menu).toBeVisible();

    await menu.getByRole("menuitem", { name: "Select all" }).click();
    await expect(menu).toHaveCount(0);

    // Selection should now be active
    const hasSelection = await page.evaluate(
      () => !!window.luma.editor.document.selection,
    );
    expect(hasSelection).toBe(true);

    // Open context menu again: "Deselect" should now be enabled
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    const deselectBtn = page
      .locator(".canvas-context-menu")
      .getByRole("menuitem", { name: "Deselect" });
    await expect(deselectBtn).toBeEnabled();

    // Click Deselect
    await deselectBtn.click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);
    const hasSelectionAfter = await page.evaluate(
      () => !!window.luma.editor.document.selection,
    );
    expect(hasSelectionAfter).toBe(false);

    // Test Fit canvas
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    await page
      .locator(".canvas-context-menu")
      .getByRole("menuitem", { name: "Fit canvas" })
      .click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);
  });

  test("executes layer actions (new paint layer, adjustment layer, duplicate, delete)", async ({
    page,
  }) => {
    await setup(page);
    const viewport = page.locator(".viewport");

    // Add a paint layer via context menu
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    await page
      .locator(".canvas-context-menu")
      .getByRole("menuitem", { name: "New paint layer" })
      .click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);

    let layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(1);

    // Add a curves adjustment layer via context menu
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    await page
      .locator(".canvas-context-menu")
      .getByRole("button", { name: "Curves" })
      .click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);

    layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(2);

    // Duplicate selected layer
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    await page
      .locator(".canvas-context-menu")
      .getByRole("menuitem", { name: "Duplicate layer" })
      .click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);

    layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(3);

    // Delete selected layer
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    await page
      .locator(".canvas-context-menu")
      .getByRole("menuitem", { name: "Delete layer" })
      .click();
    await expect(page.locator(".canvas-context-menu")).toHaveCount(0);

    layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(2);
  });

  test("dismisses on click outside", async ({ page }) => {
    await setup(page);
    const viewport = page.locator(".viewport");

    // Open context menu
    await viewport.click({ button: "right", position: { x: 200, y: 150 } });
    const menu = page.locator(".canvas-context-menu");
    await expect(menu).toBeVisible();

    // Click on canvas background away from menu
    await page.mouse.click(10, 10);
    await expect(menu).toHaveCount(0);
  });
});
