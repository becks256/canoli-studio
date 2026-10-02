import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    registerSimulationAdapters(window.luma.editor.ai.providerRegistry);
    // Create base document
    window.luma.editor.newDocument({ width: 608, height: 400 });
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("Protected Masked Edit & Result-Diff Inspector (T13)", () => {
  test("opens dialog in Generative Fill modality via context menu when selection exists", async ({
    page,
  }) => {
    await setup(page);

    // 1. Establish an active marquee selection on the canvas
    await page.evaluate(() => {
      window.luma.editor.document.selectAll();
    });

    // 2. Right-click on the canvas to open the context menu
    const viewport = page.locator(".viewport");
    await viewport.click({ button: "right", position: { x: 300, y: 200 } });

    const contextMenu = page.locator(".canvas-context-menu");
    await expect(contextMenu).toBeVisible();

    // 3. Verify 'Generative fill...' menu item is visible
    const genFillItem = contextMenu.getByRole("menuitem", {
      name: "Generative fill...",
    });
    await expect(genFillItem).toBeVisible();
    await genFillItem.click();

    // 4. Verify dialog opens in 'masked-edit' modality
    const dialog = page.locator(".generate-asset-dialog");
    await expect(dialog).toBeVisible();

    const genFillPill = dialog.getByRole("button", { name: "Generative Fill" });
    await expect(genFillPill).toBeVisible();
    await expect(genFillPill).toHaveClass(/active/);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("generates masked edit, inspects diff scorecard, and toggles split wiper / heatmap", async ({
    page,
  }) => {
    await setup(page);

    // Set a rectangular selection for generative fill
    await page.evaluate(() => {
      (window.luma.editor.document as any)._dispatch({
        type: "selection.set",
        selection: {
          regions: [
            {
              x: 100,
              y: 100,
              width: 200,
              height: 150,
              shape: "rectangle",
              operation: "add",
            },
          ],
        },
      });
    });

    // Open Generative Fill via context menu
    const viewport = page.locator(".viewport");
    await viewport.click({ button: "right", position: { x: 200, y: 175 } });
    const contextMenu = page.locator(".canvas-context-menu");
    await contextMenu
      .getByRole("menuitem", { name: "Generative fill..." })
      .click();

    const dialog = page.locator(".generate-asset-dialog");
    await expect(dialog).toBeVisible();

    // Fill inpainting prompt
    const promptInput = dialog.locator("textarea");
    await promptInput.fill("Sunlit forest glade with wildflowers");

    // Submit inpainting generation
    const generateBtn = dialog.locator(".submit-generate-btn");
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Wait for candidate to be generated and displayed on review shelf
    const candidateCard = dialog.locator(".candidate-active-card");
    await expect(candidateCard).toBeVisible({ timeout: 10000 });

    // Verify Result-Diff Inspector is rendered
    const diffInspector = dialog.locator(".result-diff-inspector");
    await expect(diffInspector).toBeVisible();

    // Verify Invariant Scorecard
    const scorecard = diffInspector.locator(".diff-scorecard-grid");
    await expect(scorecard).toBeVisible();
    await expect(scorecard).toContainText("Protected Area");
    await expect(scorecard).toContainText("Violations (Δ > 0)");
    await expect(scorecard).toContainText("0 px");
    await expect(scorecard).toContainText("Max Channel Δ");
    await expect(scorecard).toContainText("0 / 255");
    await expect(scorecard).toContainText("Preserved");
    await expect(scorecard).toContainText("100.0%");

    // Verify Verified Invariant Badge
    const verifiedBadge = diffInspector.locator(".status-badge.passed");
    await expect(verifiedBadge).toBeVisible();
    await expect(verifiedBadge).toContainText(
      "Protected Invariant: Verified (Δ = 0)",
    );

    // Verify View Mode Toggles
    const splitWiperBtn = diffInspector.getByRole("tab", {
      name: "Split Wiper",
    });
    const heatmapBtn = diffInspector.getByRole("tab", { name: "Diff Heatmap" });
    const sideBySideBtn = diffInspector.getByRole("tab", {
      name: "Side by Side",
    });

    await expect(splitWiperBtn).toBeVisible();
    await expect(heatmapBtn).toBeVisible();
    await expect(sideBySideBtn).toBeVisible();

    // Test Split Wiper view (active by default)
    const wiperSlider = diffInspector.getByRole("slider", {
      name: "Before/After Split Wiper",
    });
    await expect(wiperSlider).toBeVisible();
    await expect(wiperSlider).toHaveAttribute("aria-valuenow", "50");

    // Test Difference Heatmap view
    await heatmapBtn.click();
    const heatmapCanvas = diffInspector.locator(".diff-heatmap-canvas");
    await expect(heatmapCanvas).toBeVisible();

    // Test Side by Side view
    await sideBySideBtn.click();
    await expect(
      diffInspector.locator(".side-by-side-container"),
    ).toBeVisible();
    await expect(diffInspector.getByText("Before (Reference)")).toBeVisible();
    await expect(diffInspector.getByText("After (Candidate)")).toBeVisible();

    // Switch back to Split Wiper view
    await splitWiperBtn.click();
    await expect(wiperSlider).toBeVisible();

    // Accept & Apply candidate as layer
    const applyBtn = candidateCard.getByRole("button", {
      name: "Accept & Apply as Layer",
    });
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // Dialog closes upon application
    await expect(dialog).toHaveCount(0);

    // Verify new layer created with provenance and mask
    const layerCount = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(layerCount).toBe(1);

    const layerName = await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.name,
    );
    expect(layerName).toContain("Sunlit forest glade");

    const keywords = await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.metadata?.keywords,
    );
    expect(keywords).toContain("protected-invariant-verified");

    // Verify Layer Mask was attached
    const hasMask = await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.mask !== null,
    );
    expect(hasMask).toBe(true);

    // Undo: single-transaction removes the layer
    await page.keyboard.press("Control+z");
    const countAfterUndo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterUndo).toBe(0);

    // Redo: restores the layer
    await page.keyboard.press("Control+Shift+z");
    const countAfterRedo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterRedo).toBe(1);
  });
});

test("verifies final alpha composition across tiles, rejects changes, and preserves undo/redo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const { encodeRgbaPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const editor = window.luma.editor;
    const width = 1030,
      height = 2;
    editor.newDocument({ width, height });
    const reference = new Uint8Array(width * height * 4);
    for (let i = 0; i < reference.length; i += 4) {
      reference[i] = 255;
      reference[i + 3] = 128;
    }
    const asset = await editor.assetStore.add(
      await encodeRgbaPng(reference, width, height),
      "reference.png",
    );
    editor.document.layers.add(
      new window.luma.RasterLayer({ assetId: asset.id, width, height }),
    );
    const original = JSON.stringify(editor.document.toJSON());
    const revision = editor.document.getSnapshot().revision;
    const assetsBefore = editor.assetStore.values().length;
    const protectedMask = new Uint8Array(width * height).fill(255);
    for (let y = 0; y < height; y++)
      protectedMask.fill(0, y * width + 1020, (y + 1) * width);
    const candidate = await editor.ai.staging.stageCandidate(
      "alpha-composite",
      {
        id: "alpha-composite",
        providerId: "fixture",
        durationMs: 0,
        costCents: 0,
        width,
        height,
        hasAlpha: true,
        mimeType: "image/png",
        imageData: reference,
      },
      {
        prompt: "Composite verification fixture",
        modality: "masked-edit",
        targetWidth: width,
        targetHeight: height,
        referenceImage: {
          width,
          height,
          data: reference,
          mimeType: "image/png",
        },
        protectedMask: { width, height, coverage: protectedMask },
      },
    );
    const rawPassed = candidate.diffReport?.passed;
    let error = "";
    try {
      await editor.applyGeneratedCandidate(candidate.id);
    } catch (e) {
      error = String(e);
    }
    const rejected = {
      error,
      unchanged: JSON.stringify(editor.document.toJSON()) === original,
      revision: editor.document.getSnapshot().revision === revision,
      assets: editor.assetStore.values().length === assetsBefore,
      violations: candidate.diffReport?.violatedPixelCount,
      reviewState: candidate.reviewState,
    };
    await editor.applyGeneratedCandidate(candidate.id, {
      maskSelection: {
        regions: [
          {
            shape: "rectangle",
            operation: "add",
            x: 1020,
            y: 0,
            width: 10,
            height,
          },
        ],
      },
    });
    const renderer = new CanvasRenderer();
    async function pixels() {
      const canvas = await renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      try {
        return Array.from(
          canvas.getContext("2d")!.getImageData(0, 0, width, height).data,
        );
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    const after = await pixels();
    editor.document.undo();
    const undone = JSON.stringify(editor.document.toJSON()) === original;
    editor.document.redo();
    const redone = JSON.stringify(await pixels()) === JSON.stringify(after);
    renderer.dispose();
    return {
      rawPassed,
      rejected,
      passed: candidate.diffReport?.passed,
      undone,
      redone,
      protectedAlpha: after[1019 * 4 + 3],
      editableAlpha: after[1025 * 4 + 3],
    };
  });
  expect(result.rawPassed).toBe(true);
  expect(result.rejected.error).toContain(
    "rendered edit changes protected pixels",
  );
  expect(result.rejected).toMatchObject({
    unchanged: true,
    revision: true,
    assets: true,
    violations: 2040,
    reviewState: "staged",
  });
  expect(result).toMatchObject({
    passed: true,
    undone: true,
    redone: true,
    protectedAlpha: 128,
    editableAlpha: 192,
  });
});

test("rejects document edits made during composite verification even with stale placement authorized", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const { applyCandidateToDocument } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/apply.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    const pixels = new Uint8Array(16).fill(255);
    const candidate = await editor.ai.staging.stageCandidate(
      "composite-race",
      {
        id: "composite-race",
        providerId: "fixture",
        durationMs: 0,
        costCents: 0,
        width: 2,
        height: 2,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: pixels,
      },
      {
        prompt: "Composite verification fixture",
        modality: "masked-edit",
        targetWidth: 2,
        targetHeight: 2,
        referenceImage: {
          width: 2,
          height: 2,
          data: pixels,
          mimeType: "image/png",
        },
        protectedMask: {
          width: 2,
          height: 2,
          coverage: new Uint8Array(4).fill(255),
        },
      },
    );
    const renderer = new CanvasRenderer();
    const render = renderer.render.bind(renderer);
    renderer.render = async (...args: Parameters<typeof render>) => {
      const canvas = await render(...args);
      editor.document.name = "Concurrent edit";
      return canvas;
    };
    let error = "";
    try {
      await applyCandidateToDocument({
        candidateId: candidate.id,
        document: editor.document,
        assetStore: editor.assetStore,
        staging: editor.ai.staging,
        records: new Map(),
        options: { allowStaleRevision: true },
        renderer,
      });
    } catch (e) {
      error = String(e);
    }
    renderer.dispose();
    return {
      error,
      name: editor.document.name,
      layers: editor.document.layers.length,
      assets: editor.assetStore.values().length,
    };
  });
  expect(result.error).toContain("Document changed while verifying");
  expect(result).toMatchObject({
    name: "Concurrent edit",
    layers: 0,
    assets: 0,
  });
});

test("candidate switching resets approval and displays each captured reference", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    for (const id of ["first-review", "second-review"]) {
      const reference = new Uint8Array(16);
      for (let i = 0; i < 16; i += 4) {
        reference[i + (id === "first-review" ? 0 : 2)] = 255;
        reference[i + 3] = 255;
      }
      await editor.ai.staging.stageCandidate(
        id,
        {
          id,
          providerId: "fixture",
          durationMs: 0,
          costCents: 0,
          width: 2,
          height: 2,
          hasAlpha: false,
          mimeType: "image/png",
          imageData: new Uint8Array(16).fill(255),
        },
        {
          prompt: id,
          modality: "masked-edit",
          targetWidth: 2,
          targetHeight: 2,
          referenceImage: {
            width: 2,
            height: 2,
            data: reference,
            mimeType: "image/png",
          },
          protectedMask: {
            width: 2,
            height: 2,
            coverage: new Uint8Array(4).fill(255),
          },
        },
      );
    }
  });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const dialog = page.locator(".generate-asset-dialog");
  const approval = dialog.getByRole("checkbox", {
    name: "Acknowledge violation and authorize override",
  });
  const referencePixel = async () =>
    dialog.getByAltText("Reference source (Before)").evaluate(async (node) => {
      const image = node as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    });
  await expect(approval).not.toBeChecked();
  expect(await referencePixel()).toEqual([255, 0, 0, 255]);
  await approval.check();
  await expect(approval).toBeChecked();
  await dialog.locator(".cand-thumb-btn").nth(1).click();
  expect(await referencePixel()).toEqual([0, 0, 255, 255]);
  await expect(approval).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: /Override Required/ }),
  ).toBeDisabled();
  await dialog.locator(".cand-thumb-btn").nth(0).click();
  expect(await referencePixel()).toEqual([255, 0, 0, 255]);
  await expect(approval).not.toBeChecked();
});

test("checking placement displays verified composite pixels without changing document or assets", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { encodeRgbaPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    editor.newDocument({ width: 2, height: 2 });
    const pixels = new Uint8Array(16);
    for (let i = 0; i < 16; i += 4) {
      pixels[i] = 255;
      pixels[i + 3] = 128;
    }
    const asset = await editor.assetStore.add(
      await encodeRgbaPng(pixels, 2, 2),
      "reference.png",
    );
    editor.document.layers.add(
      new window.luma.RasterLayer({ assetId: asset.id, width: 2, height: 2 }),
    );
    const candidate = await editor.ai.staging.stageCandidate(
      "preview",
      {
        id: "preview",
        providerId: "fixture",
        durationMs: 0,
        costCents: 0,
        width: 2,
        height: 2,
        hasAlpha: true,
        imageData: pixels,
        mimeType: "image/png",
      },
      {
        prompt: "preview",
        modality: "masked-edit",
        targetWidth: 2,
        targetHeight: 2,
        referenceImage: {
          width: 2,
          height: 2,
          data: pixels,
          mimeType: "image/png",
        },
        protectedMask: {
          width: 2,
          height: 2,
          coverage: new Uint8Array(4).fill(255),
        },
      },
    );
    (window as any).placementBefore = {
      snapshot: JSON.stringify(editor.document.toJSON()),
      assets: editor.assetStore.values().length,
      reviewState: candidate.reviewState,
    };
  });
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const dialog = page.locator(".generate-asset-dialog");
  await dialog
    .getByRole("button", { name: "Check placement", exact: true })
    .click();
  const after = dialog.getByAltText("Verified composite result (After)");
  await expect(after).toBeVisible();
  const pixel = await after.evaluate(async (node) => {
    const image = node as HTMLImageElement;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, 1, 1);
    return Array.from(context.getImageData(0, 0, 1, 1).data);
  });
  expect(pixel).toEqual([255, 0, 0, 192]);
  await expect(
    dialog.getByText(/Placement checked against document revision/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const editor = window.luma.editor;
      return {
        snapshot: JSON.stringify(editor.document.toJSON()),
        assets: editor.assetStore.values().length,
        reviewState: editor.ai.staging.getCandidate("preview")!.reviewState,
      };
    }),
  ).toEqual(await page.evaluate(() => (window as any).placementBefore));
});

test("a containment mask can safely apply a candidate whose raw protected pixels differ", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 1 });
    const { encodeRgbaPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const reference = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]);
    const asset = await editor.assetStore.add(
      await encodeRgbaPng(reference, 2, 1),
      "reference",
    );
    editor.document.layers.add(
      new window.luma.RasterLayer({ assetId: asset.id, width: 2, height: 1 }),
    );
    const before = JSON.stringify(editor.document.toJSON());
    const candidate = await editor.ai.staging.stageCandidate(
      "contained",
      {
        id: "contained",
        providerId: "fixture",
        durationMs: 0,
        costCents: 0,
        width: 2,
        height: 1,
        hasAlpha: false,
        imageData: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255]),
        mimeType: "image/png",
      },
      {
        prompt: "contained",
        modality: "masked-edit",
        targetWidth: 2,
        targetHeight: 1,
        referenceImage: {
          width: 2,
          height: 1,
          data: reference,
          mimeType: "image/png",
        },
        protectedMask: {
          width: 2,
          height: 1,
          coverage: new Uint8Array([255, 0]),
        },
      },
    );
    const rawPassed = candidate.diffReport!.passed;
    await editor.applyGeneratedCandidate(candidate.id, {
      maskSelection: {
        regions: [
          {
            x: 1,
            y: 0,
            width: 1,
            height: 1,
            shape: "rectangle",
            operation: "add",
          },
        ],
      },
    });
    const renderer = new CanvasRenderer();
    const canvas = await renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const pixels = Array.from(
      canvas.getContext("2d")!.getImageData(0, 0, 2, 1).data,
    );
    canvas.width = canvas.height = 0;
    renderer.dispose();
    const passed = candidate.diffReport!.passed;
    editor.document.undo();
    return {
      rawPassed,
      passed,
      pixels,
      undone: JSON.stringify(editor.document.toJSON()) === before,
    };
  });
  expect(result).toEqual({
    rawPassed: false,
    passed: true,
    pixels: [255, 0, 0, 255, 0, 0, 255, 255],
    undone: true,
  });
});
