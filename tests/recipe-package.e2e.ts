import type { Recipe } from "../src/ai/recipes/types";
import { expect, test } from "@playwright/test";

test("portable recipe container preserves decodable original image pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { serializeRecipePackage, readRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const recipe = {
      schemaVersion: 1,
      id: "image",
      name: "Image",
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
              name: "Red",
              assetId: "red",
              width: 2,
              height: 2,
            },
          },
        },
      ],
    };
    const file = await serializeRecipePackage(recipe, {
      get: () => ({ id: "red", name: "Red", width: 2, height: 2, blob }),
    });
    const restored = await readRecipePackage(file);
    const bitmap = await createImageBitmap(restored.assets[0].blob);
    ctx.clearRect(0, 0, 2, 2);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      pixel: [...ctx.getImageData(0, 0, 1, 1).data],
      sameBytes:
        JSON.stringify([...new Uint8Array(await blob.arrayBuffer())]) ===
        JSON.stringify([
          ...new Uint8Array(await restored.assets[0].blob.arrayBuffer()),
        ]),
      assetId: restored.recipe.steps[0].action.layerTemplate.assetId,
    };
  });
  expect(result).toEqual({
    pixel: [255, 0, 0, 255],
    sameBytes: true,
    assetId: "red",
  });
});

test("package execution remaps colliding sources, preserves undo/redo and rejects wrong dimensions without mutation", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { serializeRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    const red = await canvas.convertToBlob({ type: "image/png" });
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, 0, 2, 2);
    const blue = await canvas.convertToBlob({ type: "image/png" });
    await editor.assetStore.add(blue, "Existing blue", "collision", false);
    const recipe = {
      schemaVersion: 1,
      id: "portable",
      name: "Portable",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add red",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "raster",
              name: "Red",
              assetId: "collision",
              width: 2,
              height: 2,
            },
          },
        },
      ],
    };
    const source = (width: number) => ({
      get: () => ({
        id: "collision",
        name: "Red",
        width,
        height: 2,
        blob: red,
      }),
    });
    const valid = await serializeRecipePackage(recipe, source(2));
    await editor.recipes.executeRecipePackage(valid);
    const layer = editor.document.toJSON().children[0];
    if (layer.kind !== "raster") throw new Error("Expected raster");
    ctx.drawImage(editor.assetStore.get(layer.assetId).bitmap, 0, 0);
    const pixel = [...ctx.getImageData(0, 0, 1, 1).data];
    editor.document.undo();
    const undone = editor.document.layers.length === 0;
    editor.document.redo();
    const before = JSON.stringify(editor.document.toJSON());
    const assetIds = editor.assetStore.values().map((asset) => asset.id);
    let error = "";
    try {
      await editor.recipes.executeRecipePackage(
        await serializeRecipePackage(recipe, source(3)),
      );
    } catch (e) {
      error = String(e);
    }
    let replayError = "";
    const invalidRecipe = {
      ...recipe,
      steps: [
        ...recipe.steps,
        {
          id: "missing",
          name: "Missing target",
          target: { by: "name", pattern: "Absent" },
          action: { type: "layer.remove" },
        },
      ],
    };
    try {
      await editor.recipes.executeRecipePackage(
        await serializeRecipePackage(invalidRecipe, source(2)),
      );
    } catch (e) {
      replayError = String(e);
    }
    return {
      replayError,
      remapped: layer.assetId !== "collision",
      pixel,
      undone,
      redo: editor.document.layers.length === 1,
      unchanged: before === JSON.stringify(editor.document.toJSON()),
      assetsUnchanged:
        JSON.stringify(assetIds) ===
        JSON.stringify(editor.assetStore.values().map((asset) => asset.id)),
      error,
    };
  });
  expect(result.remapped).toBe(true);
  expect(result.pixel).toEqual([255, 0, 0, 255]);
  expect(result.undone).toBe(true);
  expect(result.redo).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.assetsUnchanged).toBe(true);
  expect(result.error).toContain("dimensions");
  expect(result.replayError).toContain("Absent");
});

test("saved package survives reload and an aborted overwrite preserves its original recipe", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { serializeRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const recipe = {
      schemaVersion: 1,
      id: "durable",
      name: "Original package",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add red",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "raster",
              name: "Red",
              assetId: "red",
              width: 2,
              height: 2,
            },
          },
        },
      ],
    };
    const source = {
      get: () => ({ id: "red", name: "Red", width: 2, height: 2, blob }),
    };
    await window.luma.editor.recipes.packages.save(
      await serializeRecipePackage(recipe, source),
    );
    const replacement = await serializeRecipePackage(
      { ...recipe, name: "Must not persist" },
      source,
    );
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = original.apply(this, args);
      if (this.name === "packages") this.transaction.abort();
      return request;
    };
    let rejected = false;
    try {
      await window.luma.editor.recipes.packages.save(replacement);
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    if (!rejected)
      throw new Error("Aborted overwrite was reported as committed");
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    const recipes = await editor.recipes.packages.list();
    await editor.recipes.executeSavedPackage("durable");
    const layer = editor.document.toJSON().children[0];
    if (layer.kind !== "raster") throw new Error("Expected raster");
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(editor.assetStore.get(layer.assetId).bitmap, 0, 0);
    const pixel = [...ctx.getImageData(0, 0, 1, 1).data];
    await editor.recipes.packages.delete("durable");
    return {
      names: recipes.map((recipe) => recipe.name),
      pixel,
      remaining: (await editor.recipes.packages.list()).length,
    };
  });
  expect(result).toEqual({
    names: ["Original package"],
    pixel: [255, 0, 0, 255],
    remaining: 0,
  });
});

test("portable package UI imports without editing, persists, runs and exports after reload", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await editor.assetStore.add(blob, "Red", "ui-red", false);
    const file = await editor.recipes.exportRecipePackage({
      schemaVersion: 1,
      id: "ui-package",
      name: "Portable red artwork",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add red",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "raster",
              name: "Red",
              assetId: "ui-red",
              width: 2,
              height: 2,
            },
          },
        },
      ],
    });
    editor.newDocument({ width: 2, height: 2 });
    return [...new Uint8Array(await file.arrayBuffer())];
  });
  const open = async () => {
    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    await page
      .getByRole("tab", { name: "Portable packages", exact: true })
      .click();
  };
  await open();
  await page
    .getByLabel("Import portable recipe package")
    .setInputFiles({
      name: "red.luma-recipe",
      mimeType: "application/x-luma-recipe",
      buffer: Buffer.from(bytes),
    });
  await expect(
    page.getByRole("status").filter({ hasText: "Package imported" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);
  await page.reload();
  await open();
  await expect(
    page.getByRole("combobox", { name: "Saved package" }),
  ).toContainText("Portable red artwork");
  await page
    .getByRole("combobox", { name: "Saved package" })
    .selectOption("ui-package");
  await expect(
    page.getByRole("button", { name: "Run package", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run package", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Package executed" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export package", exact: true })
    .click();
  expect((await downloading).suggestedFilename()).toBe(
    "Portable_red_artwork.luma-recipe",
  );
  await page
    .getByRole("button", { name: "Delete package", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Saved package" }),
  ).not.toContainText("Portable red artwork");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(0);
});

test("image recordings retain source blobs for failed-save export and portable replay after reload", async ({
  page,
}) => {
  await page.goto("/");
  const savedId = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    editor.recipes.startRecording();
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    await editor.importImage(
      new File(
        [await canvas.convertToBlob({ type: "image/png" })],
        "recorded.png",
        { type: "image/png" },
      ),
    );
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = original.apply(this, args);
      if (this.name === "packages") this.transaction.abort();
      return request;
    };
    let failed = false;
    try {
      await editor.recipes.stopRecording({ name: "Recorded red source" });
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    if (!failed || !editor.recipes.pendingRecordingHasAssets)
      throw new Error("Missing failed-save recovery");
    const previousAssets = editor.assetStore;
    editor.newDocument({ width: 2, height: 2 });
    previousAssets.dispose();
    const recovery = await editor.recipes.exportPendingRecordingPackage();
    const { readRecipePackage } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/package.ts")
    );
    if ((await readRecipePackage(recovery)).assets.length !== 1)
      throw new Error("Recorded source bytes lost");
    const recipe = await editor.recipes.savePendingRecording();
    if (
      editor.recipes.pendingRecording ||
      editor.recipes.lastSavedRecordingFormat !== "package"
    )
      throw new Error("Retry did not finish");
    return recipe.id;
  });
  await page.reload();
  const result = await page.evaluate(async (id) => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 2, height: 2 });
    await editor.recipes.executeSavedPackage(id);
    const layer = editor.document.toJSON().children[0];
    if (layer.kind !== "raster") throw new Error("Missing image");
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(editor.assetStore.get(layer.assetId).bitmap, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, savedId);
  expect(result).toEqual([255, 0, 0, 255]);
});

test("batch package snapshots survive library deletion and reload and render captured source pixels", async ({
  page,
}) => {
  await page.goto("/");
  const runId = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    const red = await canvas.convertToBlob({ type: "image/png" });
    await editor.assetStore.add(red, "Red", "batch-red", false);
    const file = await editor.recipes.exportRecipePackage({
      schemaVersion: 1,
      id: "batch-package",
      name: "Captured red",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "add",
          name: "Add red",
          action: {
            type: "layer.add",
            layerTemplate: {
              kind: "raster",
              name: "Red",
              assetId: "batch-red",
              width: 16,
              height: 16,
            },
          },
        },
      ],
    });
    await editor.recipes.packages.save(file);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(0, 0, 16, 16);
    const blue = await canvas.convertToBlob({ type: "image/png" });
    const run = await editor.batch.createBatch(
      {
        name: "Package snapshot",
        budgetId: "default-budget",
        recipePackageId: "batch-package",
        variants: [
          {
            id: "png",
            name: "PNG",
            targetWidth: 16,
            targetHeight: 16,
            format: "png",
            fit: "fill",
          },
        ],
      },
      [
        {
          id: "source",
          name: "Blue.png",
          width: 16,
          height: 16,
          mimeType: "image/png",
          byteLength: blue.size,
          blob: blue,
        },
      ],
    );
    await editor.recipes.packages.delete("batch-package");
    return run.id;
  });
  await page.reload();
  const result = await page.evaluate(async (runId) => {
    const editor = window.luma.editor;
    await editor.batch.start(runId);
    const run = await editor.batch.waitForRun(runId);
    if (run.items[0].status !== "succeeded")
      throw new Error(JSON.stringify(run.items[0]));
    const blob = await editor.batch.getDeliverableBlob(
      run.items[0].deliverables[0].id,
    );
    const bitmap = await createImageBitmap(blob!);
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      status: run.status,
      pixel: [...ctx.getImageData(0, 0, 1, 1).data],
      packages: (await editor.recipes.packages.list()).length,
    };
  }, runId);
  expect(result).toEqual({
    status: "completed",
    pixel: [255, 0, 0, 255],
    packages: 0,
  });
});

test("package loading rejects a changed selected target without editing", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { TextLayer } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    editor.newDocument({ width: 100, height: 100 });
    const a = editor.document.layers.add(
      new TextLayer({ name: "A", text: "A" }),
    );
    const b = editor.document.layers.add(
      new TextLayer({ name: "B", text: "B" }),
    );
    const recipe: Recipe = {
      schemaVersion: 1,
      id: "selection-race",
      name: "Selection race",
      description: "",
      version: 1,
      parameters: [],
      steps: [
        {
          id: "hide",
          name: "Hide selected",
          target: { role: "selected" },
          action: { type: "layer.update", patch: { visible: false } },
        },
      ],
    };
    const file = await editor.recipes.exportRecipePackage(recipe);
    await editor.recipes.packages.save(file);
    const before = JSON.stringify(editor.document.toJSON());
    const revision = editor.document.getSnapshot().revision;
    const errors: string[] = [];
    for (const run of [
      () => editor.recipes.executeRecipePackage(file),
      () => editor.recipes.executeSavedPackage(recipe.id),
    ]) {
      editor.document.selectedLayer = a;
      const pending = run();
      editor.document.selectedLayer = b;
      try {
        await pending;
      } catch (error) {
        errors.push(String(error));
      }
    }
    const unchanged =
      before === JSON.stringify(editor.document.toJSON()) &&
      revision === editor.document.getSnapshot().revision;
    editor.document.selectedLayer = a;
    await editor.recipes.executeSavedPackage(recipe.id);
    const correctTarget = !a.visible && b.visible;
    editor.document.undo();
    return { errors, unchanged, correctTarget, undone: a.visible && b.visible };
  });
  expect(result.errors).toHaveLength(2);
  expect(
    result.errors.every((error) => error.includes("Layer selection changed")),
  ).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.correctTarget).toBe(true);
  expect(result.undone).toBe(true);
});
