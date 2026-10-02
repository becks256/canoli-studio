import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setupWithLayer(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, PaintLayer } = window.luma;
    editor.newDocument({ width: 400, height: 300 });
    const layer = new PaintLayer({ name: "Drawing" });
    editor.document.layers.add(layer);
    editor.document.selectedLayer = layer;
  });
}

test.describe("Collapsible Inspector Sections", () => {
  test("inspector sections render with toggle buttons and can collapse/expand", async ({
    page,
  }) => {
    await setupWithLayer(page);

    const layoutToggle = page.getByRole("button", {
      name: "Layout",
      exact: true,
    });
    const appearanceToggle = page.getByRole("button", {
      name: "Appearance",
      exact: true,
    });

    await expect(layoutToggle).toBeVisible();
    await expect(layoutToggle).toHaveAttribute("aria-expanded", "true");
    await expect(appearanceToggle).toBeVisible();
    await expect(appearanceToggle).toHaveAttribute("aria-expanded", "true");

    // Layout controls are initially visible
    await expect(page.getByLabel("X", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Y", { exact: true })).toBeVisible();

    // Collapse Layout section
    await layoutToggle.click();
    await expect(layoutToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("X", { exact: true })).not.toBeVisible();
    await expect(page.getByLabel("Y", { exact: true })).not.toBeVisible();

    // Re-expand Layout section
    await layoutToggle.click();
    await expect(layoutToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("X", { exact: true })).toBeVisible();

    // Collapse Appearance section
    await appearanceToggle.click();
    await expect(appearanceToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Blend mode")).not.toBeVisible();

    // Re-expand Appearance section
    await appearanceToggle.click();
    await expect(appearanceToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Blend mode")).toBeVisible();
  });

  test("layer styles sections (Blend If, Color overlay, Drop shadow) collapse and expand", async ({
    page,
  }) => {
    await setupWithLayer(page);

    const blendIfToggle = page.getByRole("button", {
      name: "Blend If",
      exact: true,
    });
    const overlayToggle = page.getByRole("button", {
      name: "Color overlay",
      exact: true,
    });
    const shadowToggle = page.getByRole("button", {
      name: "Drop shadow",
      exact: true,
    });

    await expect(blendIfToggle).toBeVisible();
    await expect(blendIfToggle).toHaveAttribute("aria-expanded", "true");
    await expect(overlayToggle).toBeVisible();
    await expect(page.getByLabel("Enable Blend If")).toBeVisible();

    // Collapse Blend If
    await blendIfToggle.click();
    await expect(blendIfToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Enable Blend If")).not.toBeVisible();

    // Re-expand Blend If
    await blendIfToggle.click();
    await expect(blendIfToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Enable Blend If")).toBeVisible();

    // Collapse Drop shadow
    await shadowToggle.click();
    await expect(shadowToggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Enable drop shadow")).not.toBeVisible();

    // Re-expand Drop shadow
    await shadowToggle.click();
    await expect(shadowToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Enable drop shadow")).toBeVisible();
  });

  test("reset action button in section header does not toggle section collapse", async ({
    page,
  }) => {
    await setupWithLayer(page);

    const blendIfToggle = page.getByRole("button", {
      name: "Blend If",
      exact: true,
    });
    await expect(blendIfToggle).toHaveAttribute("aria-expanded", "true");

    const resetButton = page.getByRole("button", {
      name: "Reset layer styles",
      exact: true,
    });
    await expect(resetButton).toBeVisible();

    // Clicking reset should not collapse the section
    await resetButton.click();
    await expect(blendIfToggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Enable Blend If")).toBeVisible();
  });
});
