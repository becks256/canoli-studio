import { test, expect } from "@playwright/test";

test("generation rejects unconfigured providers and validates decoded alpha and corrupt payloads", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StagedAssetRepository } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/staging.ts")
    );
    const editor = window.luma.editor;
    const registry = editor.ai.providerRegistry;
    let unavailable = "";
    try {
      registry.getAdapter("flux-1-pro");
    } catch (e) {
      unavailable = String(e);
    }
    const staging = new StagedAssetRepository();
    const request = { targetWidth: 16, targetHeight: 16, requireAlpha: true };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const base = {
      width: 16,
      height: 16,
      hasAlpha: true,
      mimeType: "image/png",
    };
    const opaque = await staging.stageCandidate(
      "opaque",
      { ...base, imageData: new Uint8Array(await blob.arrayBuffer()) },
      request,
    );
    const corrupt = await staging.stageCandidate(
      "corrupt",
      { ...base, imageData: new Uint8Array([1, 2, 3]) },
      request,
    );
    let promotion = "";
    try {
      await staging.promote(opaque.id, editor.assetStore);
    } catch (e) {
      promotion = String(e);
    }
    const data = {
      adapters: registry.listAdapters().length,
      unavailable,
      opaque: opaque.validation,
      corrupt: corrupt.validation,
      promotion,
    };
    staging.dispose();
    return data;
  });
  expect(result.adapters).toBe(0);
  expect(result.unavailable).toContain("unconfigured");
  expect(result.opaque.valid).toBe(false);
  expect(result.opaque.hasAlpha).toBe(false);
  expect(result.corrupt.valid).toBe(false);
  expect(result.promotion).toContain("invalid candidate");
});

test("masked edit reference matches composed groups and propagates renderer failures", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { captureReferenceSnapshot } = await import(
      /* @vite-ignore */ String("/src/ui/GenerateAssetDialog.tsx")
    );
    const { CanvasRenderer } = await import(
      /* @vite-ignore */ String("/src/engine/renderer.ts")
    );
    const { LayerGroup, RasterLayer } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    const editor = window.luma.editor;
    editor.newDocument({ width: 32, height: 32 });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const asset = await editor.assetStore.add(blob, "green");
    const group = new LayerGroup({ name: "Group", x: 4, y: 4, opacity: 0.5 });
    group.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 16, x: 2, y: 2 }),
    );
    editor.document.layers.add(group);
    const snapshot = await captureReferenceSnapshot(editor, 32, 32);
    const renderer = new CanvasRenderer();
    const expected = await renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { readback: true, cache: false },
    );
    const pixels = expected.getContext("2d")!.getImageData(0, 0, 32, 32).data;
    const equal = pixels.every(
      (v: number, i: number) => v === snapshot.data[i],
    );
    const alpha = snapshot.data[(8 * 32 + 8) * 4 + 3];
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = () => {
      throw new Error("reference renderer failed");
    };
    let error = "";
    try {
      await captureReferenceSnapshot(editor, 32, 32);
    } catch (e) {
      error = String(e);
    } finally {
      HTMLCanvasElement.prototype.getContext = original;
      renderer.dispose();
    }
    return { equal, alpha, error, transparent: snapshot.data[3] };
  });
  expect(result.equal).toBe(true);
  expect(result.alpha).toBe(128);
  expect(result.transparent).toBe(0);
  expect(result.error).toContain("reference renderer failed");
});

test("batch exports real JPEG and WebP pixels at requested dimensions and fails missing sources", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.ai.budgetLedger.setConsent("default-budget", true, "test");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d")!.fillStyle = "#ff0000";
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const source = {
      id: "red",
      name: "red.png",
      width: 16,
      height: 16,
      mimeType: "image/png",
      byteLength: blob.size,
      blob,
    };
    const variants = ["jpeg", "webp"].map((format) => ({
      id: format,
      name: format,
      format,
      targetWidth: 5000,
      targetHeight: 16,
      fit: "fill",
    }));
    const run = await editor.batch.createBatch(
      {
        name: "Real formats",
        budgetId: "default-budget",
        variants: variants as any,
      },
      [source],
    );
    await editor.batch.start(run.id);
    const done = await editor.batch.waitForRun(run.id);
    const outputs = [];
    for (const d of done.items[0].deliverables) {
      const blob = (await editor.batch.getDeliverableBlob(d.id))!;
      const bitmap = await createImageBitmap(blob);
      const sample = document.createElement("canvas");
      sample.width = sample.height = 1;
      const ctx = sample.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0, 1, 1);
      outputs.push({
        type: blob.type,
        width: bitmap.width,
        height: bitmap.height,
        pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data),
      });
      bitmap.close();
    }
    const bad = await editor.batch.createBatch(
      {
        name: "Missing source",
        budgetId: "default-budget",
        variants: variants as any,
      },
      [{ ...source, blob: undefined }],
    );
    await editor.batch.start(bad.id);
    const failed = await editor.batch.waitForRun(bad.id);
    return {
      status: done.items[0].status,
      outputs,
      failed: failed.items[0].status,
      error: failed.items[0].error,
      deliverables: failed.items[0].deliverables.length,
    };
  });
  expect(result.status).toBe("succeeded");
  expect(result.outputs.map((o) => o.type)).toEqual([
    "image/jpeg",
    "image/webp",
  ]);
  for (const output of result.outputs) {
    expect([output.width, output.height]).toEqual([5000, 16]);
    expect(output.pixel[0]).toBeGreaterThan(245);
    expect(output.pixel[1]).toBeLessThan(10);
  }
  expect(result.failed).toBe("failed");
  expect(result.error).toContain("Source image bytes are missing");
  expect(result.deliverables).toBe(0);
});

test("batch resumes from IndexedDB after a real page reload without replacing completed exports", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.ai.budgetLedger.setConsent("default-budget", true, "test");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    const recipe = structuredClone(editor.recipes.getPresets()[0]);
    recipe.id = "reload-snapshot";
    recipe.steps = [
      {
        id: "rename",
        name: "Rename",
        target: { role: "selected" },
        action: { type: "layer.update", patch: { name: "Frozen recipe" } },
      },
    ];
    await editor.recipes.saveRecipe(recipe);
    const run = await editor.batch.createBatch(
      {
        name: "Reload recovery",
        budgetId: "default-budget",
        recipeId: recipe.id,
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
      [0, 1].map((i) => ({
        id: String(i),
        name: `image${i}.png`,
        width: 16,
        height: 16,
        byteLength: blob.size,
        mimeType: "image/png",
        blob,
      })),
    );
    await editor.batch.start(run.id);
    const done = await editor.batch.waitForRun(run.id);
    const completed = done.items[0].deliverables[0];
    // Persist an interrupted run; both source blobs and one completed output survive reload.
    done.status = "running";
    done.items[1].status = "running";
    done.items[1].deliverables = [];
    await editor.recipes.deleteRecipe(recipe.id);
    await editor.batch.storage.saveRun(done);
    return {
      runId: run.id,
      completedId: completed.id,
      completedAt: completed.createdAt,
      sha256: completed.sha256,
    };
  });
  await page.reload();
  const after = await page.evaluate(async (runId) => {
    const editor = window.luma.editor;
    editor.ai.budgetLedger.setConsent("default-budget", true, "test");
    await editor.batch.resume(runId);
    const done = await editor.batch.waitForRun(runId);
    return {
      recipeNames: done.items.map((i) => i.checkpoint?.children[0].name),
      status: done.status,
      states: done.items.map((i) => i.status),
      completed: done.items[0].deliverables[0],
      outputExists: !!(await editor.batch.getDeliverableBlob(
        done.items[1].deliverables[0].id,
      )),
    };
  }, before.runId);
  expect(after.recipeNames).toEqual(["Frozen recipe", "Frozen recipe"]);
  expect(after.status).toBe("completed");
  expect(after.states).toEqual(["succeeded", "succeeded"]);
  expect(after.completed.id).toBe(before.completedId);
  expect(after.completed.createdAt).toBe(before.completedAt);
  expect(after.completed.sha256).toBe(before.sha256);
  expect(after.outputExists).toBe(true);
});

test("stale promotion preserves review pixels and retry survives shelf disposal", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StagedAssetRepository } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/staging.ts")
    );
    const { applyCandidateToDocument } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/apply.ts")
    );
    const { Document } = await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    );
    const { AssetStore } = await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    );
    const staging = new StagedAssetRepository();
    const assets = new AssetStore();
    const doc = new Document({ width: 1, height: 1 });
    const candidate = await staging.stageCandidate(
      "race",
      {
        width: 1,
        height: 1,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: new Uint8Array([255, 0, 0, 255]),
      },
      { targetWidth: 1, targetHeight: 1 },
    );
    const apply = (revision: number) =>
      applyCandidateToDocument({
        candidateId: candidate.id,
        document: doc,
        assetStore: assets,
        staging,
        records: new Map(),
        options: { expectedRevision: revision },
      });
    const pending = apply(doc.getSnapshot().revision);
    doc.name = "Intervening edit";
    let error = "";
    try {
      await pending;
    } catch (e) {
      error = String(e);
    }
    const rolledBack =
      !assets.has(candidate.id) && doc.toJSON().children.length === 0;
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(candidate.asset.bitmap, 0, 0);
    const reviewPixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    await apply(doc.getSnapshot().revision);
    staging.dispose();
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(assets.values()[0].bitmap, 0, 0);
    const appliedPixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    assets.dispose();
    return { error, rolledBack, reviewPixel, appliedPixel };
  });
  expect(result.error).toContain("Document changed");
  expect(result.rolledBack).toBe(true);
  expect(result.reviewPixel).toEqual([255, 0, 0, 255]);
  expect(result.appliedPixel).toEqual([255, 0, 0, 255]);
});

test("encoded masked candidates are verified from decoded pixels instead of provider reports", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { StagedAssetRepository } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/staging.ts")
    );
    const { applyCandidateToDocument } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/apply.ts")
    );
    const { evaluateProtectedRegionInvariant } = await import(
      /* @vite-ignore */ String("/src/ai/diff/engine.ts")
    );
    const staging = new StagedAssetRepository();
    const canvas = new OffscreenCanvas(2, 2);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 2, 2);
    const encoded = new Uint8Array(
      await (await canvas.convertToBlob()).arrayBuffer(),
    );
    const reference = new Uint8Array(16).fill(255);
    const protectedMask = new Uint8Array(4).fill(255);
    const report = evaluateProtectedRegionInvariant({
      referenceBuffer: reference,
      candidateBuffer: reference,
      width: 2,
      height: 2,
      protectedMask,
    });
    const candidate = await staging.stageCandidate(
      "encoded",
      {
        width: 2,
        height: 2,
        hasAlpha: false,
        mimeType: "image/png",
        imageData: encoded,
        diffReport: report,
      },
      {
        modality: "masked-edit",
        targetWidth: 2,
        targetHeight: 2,
        referenceImage: { width: 2, height: 2, data: reference },
        protectedMask: { width: 2, height: 2, coverage: protectedMask },
      },
    );
    const failedAtStage = candidate.diffReport?.passed === false;
    candidate.diffReport = report;
    const editor = window.luma.editor;
    editor.document.resize(2, 2);
    const revision = editor.document.getSnapshot().revision;
    let error = "";
    try {
      await applyCandidateToDocument({
        candidateId: candidate.id,
        document: editor.document,
        assetStore: editor.assetStore,
        staging,
        records: new Map(),
        options: {},
      });
    } catch (e) {
      error = String(e);
    }
    const data = {
      failedAtStage,
      error,
      violations: candidate.diffReport?.violatedPixelCount,
      unchanged: editor.document.getSnapshot().revision === revision,
    };
    staging.dispose();
    return data;
  });
  expect(result.failedAtStage).toBe(true);
  expect(result.error).toContain("protected");
  expect(result.violations).toBe(4);
  expect(result.unchanged).toBe(true);
});
