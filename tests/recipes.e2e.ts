import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    // Initialize document with a sample raster layer
    const editor = window.luma.editor;
    editor.newDocument({ width: 800, height: 600 });
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#34495e";
    ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = "#e74c3c";
    ctx.beginPath();
    ctx.arc(400, 300, 150, 0, Math.PI * 2);
    ctx.fill();

    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const file = new File([blob], "hero.png", { type: "image/png" });
    await editor.assetStore.add(file, "hero.png");

    // Add raster layer to document
    await editor.importImage(file);
  });
  await page
    .getByRole("button", { name: "Move tool (V)", exact: true })
    .click();
  await page.keyboard.press("Control+1");
}

test.describe("T14: Recipes & Deterministic Recorder E2E", () => {
  test("opens dialog via TopBar Recipes button and keyboard shortcut (Mod+Shift+R)", async ({
    page,
  }) => {
    await setup(page);

    // 1. Open via TopBar Recipes button
    const topBarRecipesBtn = page.getByRole("button", {
      name: "Recipes",
      exact: true,
    });
    await expect(topBarRecipesBtn).toBeVisible();
    await topBarRecipesBtn.click();

    const dialog = page.locator(".recipe-dialog");
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recipes & Automation" }),
    ).toBeVisible();

    // Close via Escape
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // 2. Open via Keyboard Shortcut (Mod+Shift+R)
    await page.keyboard.press("Control+Shift+R");
    await expect(dialog).toBeVisible();

    // Close via Close button
    const closeBtn = dialog.getByRole("button", { name: "Close" });
    await closeBtn.click();
    await expect(dialog).toHaveCount(0);
  });

  test("inspects preset recipes, dynamic parameters, and executes with 1-step undo", async ({
    page,
  }) => {
    await setup(page);

    // Open Recipe dialog
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    const dialog = page.locator(".recipe-dialog");
    await expect(dialog).toBeVisible();

    // Verify presets are listed
    await expect(
      dialog
        .locator(".recipe-card-name")
        .filter({ hasText: "Warm Tone & Contrast" }),
    ).toBeVisible();
    await expect(
      dialog
        .locator(".recipe-card-name")
        .filter({ hasText: "Create Product Drop Shadow" }),
    ).toBeVisible();
    await expect(
      dialog
        .locator(".recipe-card-name")
        .filter({ hasText: "Watermark Stamp" }),
    ).toBeVisible();

    // Inspect "Warm Tone & Contrast" details
    await dialog
      .locator(".recipe-card")
      .filter({ hasText: "Warm Tone & Contrast" })
      .click();

    // Verify dry-run scorecard status
    const statusBadge = dialog.locator(".dryrun-status-badge");
    await expect(statusBadge).toContainText("Valid - Ready to Run");

    // Verify scorecard metrics
    const scorecard = dialog.locator(".dryrun-scorecard-grid");
    await expect(scorecard).toContainText("+1"); // 1 layer added

    // Verify planned execution sequence
    const stepsList = dialog.locator(".dryrun-steps-list");
    await expect(stepsList).toBeVisible();
    await expect(stepsList).toContainText("Adjust Image Tone");
    await expect(stepsList).toContainText("Add Warm Color Curve");

    // Execute the recipe
    const runBtn = dialog.getByRole("button", { name: "Run Recipe" });
    await expect(runBtn).toBeEnabled();
    await runBtn.click();

    // Verify execution success alert
    await expect(dialog.locator(".dryrun-alert-box.success")).toBeVisible();
    await expect(dialog.locator(".dryrun-alert-box.success")).toContainText(
      "Executed",
    );

    // Close dialog
    await page.keyboard.press("Escape");

    // Verify document layers: should have 2 layers now (Hero + Adjustment layer)
    const countAfterRun = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterRun).toBe(2);

    // Test 1-step Undo
    await page.keyboard.press("Control+z");
    const countAfterUndo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterUndo).toBe(1);

    // Test 1-step Redo
    await page.keyboard.press("Control+Shift+z");
    const countAfterRedo = await page.evaluate(
      () => window.luma.editor.document.layers.length,
    );
    expect(countAfterRedo).toBe(2);
  });

  test("records live document actions and saves as custom recipe", async ({
    page,
  }) => {
    await setup(page);

    // Open Recipe dialog
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    const dialog = page.locator(".recipe-dialog");
    await expect(dialog).toBeVisible();

    // Switch to Action Recorder tab
    await dialog.getByRole("tab", { name: "Action Recorder" }).click();

    // Verify Ready to Record
    await expect(dialog.getByText("Ready to Record")).toBeVisible();
    const startRecordBtn = dialog.getByRole("button", {
      name: "Start Recording",
    });
    await expect(startRecordBtn).toBeVisible();

    // Click Start Recording
    await startRecordBtn.click();
    await expect(dialog.getByText("Recording Actions Live...")).toBeVisible();

    // Close dialog to perform edits in editor
    await page.keyboard.press("Escape");

    // Perform an edit: duplicate layer via shortcut Mod+J
    await page.keyboard.press("Control+j");

    // Reopen Recipe dialog
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    await dialog.getByRole("tab", { name: "Action Recorder" }).click();

    // Check captured step appeared
    await expect(dialog.locator(".recorder-step-card")).toBeVisible();
    await expect(dialog.locator(".recorder-stream-list")).toContainText(
      "Duplicate",
    );

    // Stop and save
    const stopBtn = dialog.getByRole("button", { name: "Stop & Save Recipe" });
    await expect(stopBtn).toBeEnabled();
    await stopBtn.click();

    // Automatically switches back to library tab with newly recorded recipe selected
    await expect(dialog.locator(".recipe-list-col")).toContainText(
      "Recorded Action",
    );
  });
});

test("failed recording save survives dialog reopening and can be retried durably", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    const editor = window.luma.editor;
    editor.recipes.startRecording();
    editor.document.selectedLayer!.opacity = 0.6;
    const original = Storage.prototype.setItem;
    (window as any).restoreRecipeWrites = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "luma_custom_recipes_v1")
        throw new DOMException("Full", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await dialog.getByRole("tab", { name: /Recorder/ }).click();
  await dialog.getByRole("button", { name: "Stop & Save Recipe" }).click();
  await expect(dialog.getByRole("alert")).toContainText("could not be updated");
  await expect(
    dialog.getByRole("button", { name: "Export unsaved recipe" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.luma.editor.recipes.getCustomRecipes().length,
    ),
  ).toBe(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("not saved");
  await page.evaluate(() => (window as any).restoreRecipeWrites());
  await dialog.getByRole("button", { name: "Retry saving recipe" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.reload();
  expect(
    await page.evaluate(() =>
      window.luma.editor.recipes
        .getCustomRecipes()
        .map((recipe) => recipe.name),
    ),
  ).toContain("Recorded Action");
});

test("unreadable recipe library stays intact and exposes recovery controls", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("luma_custom_recipes_v1", "{unreadable-library"),
  );
  await page.reload();
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "Saved data was preserved",
  );
  const downloadPromise = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "Export unreadable library" })
    .click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("{unreadable-library");
  expect(
    await page.evaluate(() => localStorage.getItem("luma_custom_recipes_v1")),
  ).toBe("{unreadable-library");
  await page.evaluate(() =>
    localStorage.setItem("luma_custom_recipes_v1", "[]"),
  );
  await dialog.getByRole("button", { name: "Retry reading recipes" }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("empty recording reports no recipe and allows a fresh recording", async ({
  page,
}) => {
  await setup(page);
  const before = await page.evaluate(() => ({
    document: window.luma.editor.document.toJSON(),
    count: window.luma.editor.recipes.getCustomRecipes().length,
  }));
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await dialog.getByRole("tab", { name: "Action Recorder" }).click();
  await dialog.getByRole("button", { name: "Start Recording" }).click();
  await dialog.getByRole("button", { name: "Stop & Save Recipe" }).click();
  await expect(
    dialog.getByText(/No supported actions were recorded/),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      document: window.luma.editor.document.toJSON(),
      count: window.luma.editor.recipes.getCustomRecipes().length,
    })),
  ).toEqual(before);
  await dialog.getByRole("button", { name: "Start Recording" }).click();
  await expect(dialog.getByText("Recording Actions Live...")).toBeVisible();
});

test("unsupported recorded edits are visible and prevent saving a partial recipe", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await dialog.getByRole("tab", { name: "Action Recorder" }).click();
  await dialog.getByRole("button", { name: "Start Recording" }).click();
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.name = "Supported edit";
    doc._dispatch({
      type: "document.guides",
      guides: [{ id: "test-guide", orientation: "vertical", position: 12 }],
    });
  });
  await expect(
    dialog.getByText(/This recording cannot be saved/),
  ).toContainText("document.guides");
  await dialog.getByRole("button", { name: "Stop & Save Recipe" }).click();
  await expect(dialog.getByText(/No partial recipe was saved/)).toBeVisible();
  expect(
    await page.evaluate(
      () => window.luma.editor.recipes.getCustomRecipes().length,
    ),
  ).toBe(0);
  await dialog.getByRole("button", { name: "Start Recording" }).click();
  await expect(dialog.getByText(/This recording cannot be saved/)).toHaveCount(
    0,
  );
});

test("multi-target recipe dry-run lists every layer and applies with one undo", async ({
  page,
}) => {
  await setup(page);
  const before = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.document.selectedLayer!.duplicate();
    const snapshot = editor.document.toJSON();
    await editor.recipes.saveRecipe({
      schemaVersion: 1,
      id: "multi-hide",
      name: "Hide all artwork",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "hide",
          name: "Hide layer",
          target: { role: "all" },
          action: { type: "layer.update", patch: { visible: false } },
        },
      ],
    });
    return snapshot;
  });
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await dialog.getByText("Hide all artwork", { exact: true }).click();
  await expect(dialog.locator(".dryrun-step-row")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Run Recipe" }).click();
  await expect(dialog.locator(".dryrun-alert-box.success")).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.luma.editor.document
        .toJSON()
        .children.every((layer) => !layer.visible),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.toJSON()),
  ).toEqual(before);
});

test("records effect removal and reset through the browser service and replays with undo", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const doc = editor.document;
    const layer = doc.selectedLayer!;
    const effect = (id: string) => ({
      id,
      kind: "tone" as const,
      enabled: true,
      exposure: 1,
      contrast: 0,
      saturation: 0,
    });
    doc._dispatch({
      type: "effect.add",
      id: layer.id,
      effect: effect("original"),
    });
    editor.recipes.startRecording();
    doc._dispatch({
      type: "effect.remove",
      id: layer.id,
      effectId: "original",
    });
    doc._dispatch({
      type: "effect.add",
      id: layer.id,
      effect: effect("recorded"),
    });
    doc._dispatch({ type: "effect.reset", id: layer.id });
    const recipe = await editor.recipes.stopRecording({
      name: "Reset effects workflow",
    });
    doc._dispatch({
      type: "effect.add",
      id: layer.id,
      effect: effect("replacement"),
    });
    const before = doc.toJSON();
    const execution = editor.recipes.execute(recipe);
    const edited = doc.toJSON().children[0];
    doc.undo();
    return {
      success: execution.success,
      empty: edited.kind === "raster" && edited.effects.length === 0,
      restored: JSON.stringify(doc.toJSON()) === JSON.stringify(before),
      actions: recipe.steps.map((step) => step.action.type),
    };
  });
  expect(result).toEqual({
    success: true,
    empty: true,
    restored: true,
    actions: ["effect.remove", "effect.add", "effect.reset"],
  });
});

test("recipe dry-run blocks artwork from another document when its source asset is unavailable", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    await window.luma.editor.recipes.saveRecipe({
      schemaVersion: 1,
      id: "missing-source",
      name: "Unavailable artwork",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add image",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "raster",
              name: "Missing image",
              assetId: "other-document-source",
              width: 16,
              height: 16,
            },
          },
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const dialog = page.locator(".recipe-dialog");
  await dialog.getByText("Unavailable artwork", { exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Run Recipe", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("other-document-source");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
});

test("recordings replay retained edits after undo, redo and branching", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { TextLayer } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    editor.newDocument({ width: 100, height: 100 });
    const layer = editor.document.layers.add(
      new TextLayer({ name: "Caption", text: "Caption" }),
    );
    editor.document.selectedLayer = layer;
    editor.recipes.startRecording();
    layer.opacity = 0.5;
    layer.opacity = 0.25;
    editor.document.undo();
    editor.document.redo();
    editor.document.undo();
    layer.visible = false;
    const recipe = await editor.recipes.stopRecording({
      name: "Retained edits",
    });
    editor.newDocument({ width: 100, height: 100 });
    const target = editor.document.layers.add(
      new TextLayer({ name: "Caption", text: "Caption" }),
    );
    editor.document.selectedLayer = target;
    const applied = editor.recipes.execute(recipe);
    const retained = { opacity: target.opacity, visible: target.visible };
    editor.document.undo();
    return {
      success: applied.success,
      retained,
      undone: { opacity: target.opacity, visible: target.visible },
    };
  });
  expect(result).toEqual({
    success: true,
    retained: { opacity: 0.5, visible: false },
    undone: { opacity: 1, visible: true },
  });
});

test("recipe existence checks retain surviving outputs after deleting the last duplicate", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { TextLayer } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    editor.newDocument({ name: "Original", width: 100, height: 100 });
    for (const name of ["A", "B"])
      editor.document.layers.add(new TextLayer({ name, text: name }));
    const before = JSON.stringify(editor.document.toJSON());
    const recipe = {
      schemaVersion: 1,
      id: "survivor",
      name: "Survivor",
      version: 1,
      description: "",
      parameters: [],
      steps: [
        {
          id: "copies",
          name: "Duplicate",
          target: { by: "kind", kind: "text", allowMultiple: true },
          action: { type: "layer.duplicate" },
        },
        {
          id: "remove",
          name: "Remove last",
          target: { role: "topmost" },
          action: { type: "layer.remove" },
        },
        {
          id: "rename",
          name: "Check survivors",
          condition: {
            op: "layerExists",
            target: { by: "stepResult", stepId: "copies" },
          },
          action: { type: "document.rename", name: "Survivor" },
        },
      ],
    };
    await editor.recipes.saveRecipe(recipe as any);
    const applied = editor.recipes.execute(recipe as any);
    const name = editor.document.name;
    editor.document.undo();
    const restored = JSON.stringify(editor.document.toJSON()) === before;
    editor.document.redo();
    return {
      success: applied.success,
      name,
      restored,
      redone: editor.document.name,
    };
  });
  expect(result).toEqual({
    success: true,
    name: "Survivor",
    restored: true,
    redone: "Survivor",
  });
});

test("saved recordings preserve literal expressions and still bind tone parameters after reload", async ({
  page,
}) => {
  await setup(page);
  const id = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const layer = editor.document.selectedLayer!;
    editor.recipes.startRecording();
    layer.name = "Literal ${exposure}";
    editor.document._dispatch({
      type: "effect.tone",
      id: layer.id,
      values: { exposure: 1 },
    });
    return (
      await editor.recipes.stopRecording({
        name: "Literal recording",
        autoParameterizeTone: true,
      })
    ).id;
  });
  // A fresh page reloads the saved recipe and uses a new source document.
  await setup(page);
  const result = await page.evaluate((id) => {
    const editor = window.luma.editor;
    const before = editor.document.toJSON();
    const layer = editor.document.selectedLayer!;
    const saved = editor.recipes.getRecipe(id)!;
    const result = editor.recipes.execute(saved, { exposure: 2 });
    const name = layer.name;
    const data = layer.toJSON();
    const exposure = data.kind === "raster" ? data.effects[0].exposure : null;
    editor.document.undo();
    return {
      success: result.success,
      name,
      exposure,
      restored:
        JSON.stringify(editor.document.toJSON()) === JSON.stringify(before),
    };
  }, id);
  expect(result).toEqual({
    success: true,
    name: "Literal ${exposure}",
    exposure: 2,
    restored: true,
  });
});
