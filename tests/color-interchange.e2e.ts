import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import * as path from "path";

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

test.describe("Color Management and PSD Interchange (T17: F10, F11)", () => {
  test("F10: color profile management, ICC inspector, and soft-proofing workflow", async ({
    page,
  }) => {
    await setup(page);

    // 1. Verify TopBar has "Color" button
    const colorBtn = page.getByRole("button", { name: "Color", exact: true });
    await expect(colorBtn).toBeVisible();
    await colorBtn.click();

    // 2. Verify Color Profile modal opens
    const dialog = page.locator(".color-profile-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#color-profile-dialog-title")).toHaveText(
      "Color Settings & ICC Profile",
    );

    // 3. Inspect default profile (sRGB) and change to Display P3
    const profileSelect = dialog.locator("select").first();
    await expect(profileSelect).toBeVisible();
    await profileSelect.selectOption("display-p3");

    // 4. Verify ICC Profile Inspector displays parsed ICC tags
    const iccBox = dialog.locator(".icc-inspector-box");
    await expect(iccBox).toBeVisible();
    await expect(iccBox.getByText("RGB", { exact: false })).toBeVisible();
    await expect(iccBox.getByText("XYZ", { exact: false })).toBeVisible();

    // 5. Test Soft-Proofing toggle and controls
    const softProofCheckbox = dialog.getByLabel(
      "Simulate Output Gamut (Soft Proof)",
    );
    await expect(softProofCheckbox).toBeVisible();
    await softProofCheckbox.check();
    await expect(softProofCheckbox).toBeChecked();

    const gamutWarningCheckbox = dialog.locator(
      ".gamut-warning-checkbox input",
    );
    await expect(gamutWarningCheckbox).toBeVisible();
    await gamutWarningCheckbox.check();
    await expect(gamutWarningCheckbox).toBeChecked();

    // 6. Apply settings
    const applyBtn = dialog.getByRole("button", { name: "Apply Settings" });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();
    await expect(dialog).toBeHidden();

    // 7. Verify status bar reflects active profile and proofing
    const statusFooter = page.locator(".canvas-status");
    await expect(statusFooter).toBeVisible();
    await expect(
      statusFooter.getByText("Display P3", { exact: false }),
    ).toBeVisible();
    await expect(
      statusFooter.getByText("Proof:", { exact: false }),
    ).toBeVisible();
  });

  test("F11: multi-format export dialog includes PSD with capability reporting", async ({
    page,
  }) => {
    await setup(page);

    // Add a paint layer so hasLayers is true and Export is active
    await page.evaluate(() => {
      const { editor, PaintLayer } = window.luma;
      const pLayer = new PaintLayer({ name: "Export Layer" });
      editor.document.layers.add(pLayer);
    });

    // 1. Open Export modal via TopBar
    const exportBtn = page.getByRole("button", {
      name: "Export…",
      exact: true,
    });
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // 2. Verify Export Dialog is visible
    const dialog = page.locator(".export-dialog");
    await expect(dialog).toBeVisible();

    // 3. Select PSD format
    const formatSelect = dialog.locator("select").first();
    await formatSelect.selectOption("psd");

    // 4. Verify capability scorecard reports preserved PSD features
    const grid = dialog.locator(".export-capabilities-grid");
    await expect(grid).toBeVisible();
    await expect(
      grid.getByText("Preserved features", { exact: false }),
    ).toBeVisible();
    await expect(
      grid.getByText("Individual raster layers preserved", { exact: false }),
    ).toBeVisible();

    // 5. Verify Export button shows PSD extension
    const submitBtn = dialog.getByRole("button", { name: /Export \.psd/ });
    await expect(submitBtn).toBeVisible();

    // 6. Close export dialog
    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await closeBtn.click();
    await expect(dialog).toBeHidden();
  });

  test("F11: preflight inspection and layered import of PSD fixture", async ({
    page,
  }) => {
    await setup(page);

    // 1. Upload independent disk fixture: basic-rgb-8bit.psd (160 x 120 px)
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/psd/basic-rgb-8bit.psd",
    );
    const psdInput = page.locator("input[data-testid='psd-input']");
    await psdInput.setInputFiles(fixturePath);

    // 2. Verify PSD Preflight Inspection modal appears
    const preflightDialog = page.locator(".psd-import-dialog");
    await expect(preflightDialog).toBeVisible();
    await expect(
      preflightDialog.getByText("Import PSD — Preflight Inspection"),
    ).toBeVisible();

    // 3. Verify metadata summary
    await expect(preflightDialog.getByText("160 × 120 px")).toBeVisible();
    await expect(
      preflightDialog.getByText("RGB", { exact: true }),
    ).toBeVisible();

    // 4. Verify Layer Tree shows 2 layers
    const layerRows = preflightDialog.locator(".psd-layer-row");
    await expect(layerRows).toHaveCount(2);
    await expect(layerRows.first()).toContainText("Background");
    await expect(layerRows.nth(1)).toContainText("Blue Card");

    // 5. Verify mode toggle has "Layered" selected
    const layeredRadio = preflightDialog.locator('input[value="layered"]');
    await expect(layeredRadio).toBeChecked();

    // 6. Commit import
    const importBtn = preflightDialog.getByRole("button", {
      name: "Import Layers",
    });
    await importBtn.click();
    await expect(preflightDialog).toBeHidden();

    // 7. Verify document dimensions updated
    const statusFooter = page.locator(".canvas-status");
    await expect(statusFooter).toContainText("160 × 120 px");
  });

  test("F11: preflight inspection of CMYK PSD fixture warns and selects flattened mode", async ({
    page,
  }) => {
    await setup(page);

    // 1. Upload CMYK unsupported fixture
    const fixturePath = path.resolve(
      process.cwd(),
      "tests/fixtures/psd/cmyk-unsupported.psd",
    );
    const psdInput = page.locator("input[data-testid='psd-input']");
    await psdInput.setInputFiles(fixturePath);

    // 2. Verify preflight inspection dialog
    const preflightDialog = page.locator(".psd-import-dialog");
    await expect(preflightDialog).toBeVisible();

    // 3. Verify CMYK mode is identified
    await expect(
      preflightDialog.getByText("CMYK", { exact: true }),
    ).toBeVisible();

    // 4. Verify warning banner is displayed
    const warningBox = preflightDialog.locator(".psd-warnings-box");
    await expect(warningBox).toBeVisible();
    await expect(warningBox).toContainText("CMYK");

    // 5. Verify flattened mode is selected by default for unsupported color mode
    const flattenRadio = preflightDialog.locator('input[value="flatten"]');
    await expect(flattenRadio).toBeChecked();

    // 6. Dismiss dialog
    const cancelBtn = preflightDialog.getByRole("button", { name: "Cancel" });
    await cancelBtn.click();
    await expect(preflightDialog).toBeHidden();
  });
});
