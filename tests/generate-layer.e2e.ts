import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    registerSimulationAdapters(window.luma.editor.ai.providerRegistry);
    return window.luma.editor.newDocument({ width: 600, height: 400 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("Generate-as-Layer UI & Candidate Review Workflow (T12)", () => {
  test("opens dialog via TopBar Generate button, Context Menu, and keyboard shortcut", async ({
    page,
  }) => {
    await setup(page);

    // 1. Open via TopBar Generate button
    const topBarGenerateBtn = page.getByRole("button", {
      name: "Generate",
      exact: true,
    });
    await expect(topBarGenerateBtn).toBeVisible();
    await topBarGenerateBtn.click();

    const dialog = page.locator(".generate-asset-dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Generate asset as layer" }),
    ).toBeVisible();

    // Close via Escape
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // 2. Open via Canvas Context Menu
    const viewport = page.locator(".viewport");
    await viewport.click({ button: "right", position: { x: 250, y: 200 } });
    const contextMenu = page.locator(".canvas-context-menu");
    await expect(contextMenu).toBeVisible();

    const contextGenerateItem = contextMenu.getByRole("menuitem", {
      name: "Generate layer...",
    });
    await expect(contextGenerateItem).toBeVisible();
    await contextGenerateItem.click();

    await expect(dialog).toBeVisible();

    // Close via Close button
    const closeBtn = dialog.getByRole("button", { name: "Close (Escape)" });
    await closeBtn.click();
    await expect(dialog).toHaveCount(0);

    // 3. Open via Keyboard Shortcut (Mod+Shift+G)
    await page.keyboard.press("Control+Shift+G");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("configures modalities, dimension presets, and verifies budget estimation", async ({
    page,
  }) => {
    await setup(page);

    // Open Generate dialog
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const dialog = page.locator(".generate-asset-dialog");
    await expect(dialog).toBeVisible();

    // Check default state
    const promptInput = dialog.locator("textarea");
    await expect(promptInput).toBeVisible();

    const generateBtn = dialog.locator(".submit-generate-btn");
    // Initially disabled because prompt is empty
    await expect(generateBtn).toBeDisabled();

    // Type a prompt
    await promptInput.fill("Bioluminescent crystal in a dark cave");
    await expect(generateBtn).toBeEnabled();

    // Modality pills
    const cutoutPill = dialog.getByRole("button", {
      name: "Cutout Object",
      exact: true,
    });
    await cutoutPill.click();

    // Transparency checkbox should be checked now
    const alphaCheckbox = dialog.getByRole("checkbox", {
      name: "Require alpha transparency (isolated cutout)",
    });
    await expect(alphaCheckbox).toBeChecked();

    // Dimension preset selection
    const landscapePreset = dialog.getByRole("button", {
      name: "Landscape (16:9)",
    });
    await landscapePreset.click();

    const widthInput = dialog.getByLabel("Width");
    const heightInput = dialog.getByLabel("Height");
    await expect(widthInput).toHaveValue("1344");
    await expect(heightInput).toHaveValue("768");

    // Spend estimate ledger is visible
    await expect(dialog.locator(".budget-ledger-card")).toBeVisible();

    // Explicit consent toggle
    const consentCheckbox = dialog.getByRole("checkbox", {
      name: /Authorize \(artist\)/,
    });
    await expect(consentCheckbox).toBeChecked();

    // Uncheck consent -> Generate button becomes disabled
    await consentCheckbox.uncheck();
    await expect(generateBtn).toBeDisabled();

    // Re-check consent -> Generate button is enabled
    await consentCheckbox.check();
    await expect(generateBtn).toBeEnabled();

    await page.keyboard.press("Escape");
  });

  test("generates candidate, previews on canvas, and applies as layer with undo/redo", async ({
    page,
  }) => {
    await setup(page);

    // Open dialog
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const dialog = page.locator(".generate-asset-dialog");
    await expect(dialog).toBeVisible();

    // Fill prompt and select Square preset
    await dialog.locator("textarea").fill("Stylized magical potion bottle");
    await dialog.getByRole("button", { name: "Square (1:1)" }).click();

    // Candidate shelf is initially empty
    await expect(dialog.locator(".empty-shelf-card")).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "No candidates generated yet" }),
    ).toBeVisible();

    // Submit generation
    const generateBtn = dialog.locator(".submit-generate-btn");
    await generateBtn.click();

    // Status changes to in-progress indicator
    await expect(dialog.locator(".generating-status-wrap")).toBeVisible();

    // Wait for generation to complete and candidate card to appear in shelf
    const candidateCard = dialog.locator(".candidate-active-card");
    await expect(candidateCard).toBeVisible({ timeout: 10000 });

    // Verify candidate metadata chips
    const metaGrid = candidateCard.locator(".candidate-meta-grid");
    await expect(metaGrid).toContainText("1024 × 1024");
    await expect(metaGrid).toContainText("image/png");

    // Canvas preview toggle
    const previewToggleBtn = dialog.getByRole("button", {
      name: "Preview on Canvas",
    });
    await expect(previewToggleBtn).toBeVisible();
    await previewToggleBtn.click();

    // Transient canvas overlay is visible
    const previewOverlay = page.locator(
      ".generation-candidate-preview-overlay",
    );
    await expect(previewOverlay).toBeVisible();

    const hidePreviewBtn = dialog.getByRole("button", {
      name: "Hide Canvas Preview",
    });
    await expect(hidePreviewBtn).toBeVisible();

    // Toggle off canvas preview
    await hidePreviewBtn.click();
    await expect(previewOverlay).toHaveCount(0);

    // Accept & Apply candidate as layer
    const applyBtn = candidateCard.getByRole("button", {
      name: "Accept & Apply as Layer",
    });
    await applyBtn.click();

    // Dialog closes upon application
    await expect(dialog).toHaveCount(0);

    // Verify document now has the generated layer
    const layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(1);

    const layerName = await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.name,
    );
    expect(layerName).toContain("Stylized magical potion");

    // Check layer provenance metadata
    const metadataKeywords = await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.metadata?.keywords,
    );
    expect(metadataKeywords).toContain("ai-generated");

    // Test Undo: removes the generated layer
    await page.keyboard.press("Control+z");
    const countAfterUndo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterUndo).toBe(0);

    // Test Redo: restores the generated layer
    await page.keyboard.press("Control+Shift+z");
    const countAfterRedo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterRedo).toBe(1);
  });
});
