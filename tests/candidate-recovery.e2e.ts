import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function generate(page: Page) {
  await page.goto("/");
  return page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.newDocument({ width: 16, height: 16 });
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate = async () => {
      const pixels = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255;
        pixels[i + 3] = 255;
      }
      return {
        id: crypto.randomUUID(),
        providerId: "flux-1-pro",
        width: 16,
        height: 16,
        hasAlpha: false,
        imageData: pixels,
        mimeType: "image/png",
        costCents: 4,
        durationMs: 1,
      };
    };
    const job = await editor.ai.submit(
      {
        prompt: "Saved red square",
        modality: "text-to-image",
        targetWidth: 16,
        targetHeight: 16,
      },
      {
        providerId: "flux-1-pro",
        budgetId: "default-budget",
        baseRevision: editor.document.getSnapshot().revision,
        sourceDocumentId: editor.document.id,
        idempotencyKey: "saved-square",
      },
    );
    const candidate = await job.result();
    return {
      id: candidate.id,
      jobId: job.id,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      baseRevision: job.baseRevision,
    };
  });
}

test("saved candidate reopens without a provider, requires placement review, and supports offline undo/redo", async ({
  page,
}) => {
  const saved = await generate(page);
  await page.reload();
  await page.evaluate(() =>
    window.luma.editor.newDocument({ width: 16, height: 16 }),
  );
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".candidate-active-card")).toBeVisible();
  const state = await page.evaluate(async (id) => {
    const editor = window.luma.editor;
    const candidate = editor.ai.staging.getCandidate(id)!;
    const original = JSON.stringify(editor.document.toJSON());
    let error = "";
    try {
      await editor.applyGeneratedCandidate(id);
    } catch (value) {
      error = String(value);
    }
    const unchanged = JSON.stringify(editor.document.toJSON()) === original;
    const layer = await editor.applyGeneratedCandidate(id, {
      allowStaleRevision: true,
    });
    const ctx = new OffscreenCanvas(16, 16).getContext("2d")!;
    ctx.drawImage(editor.assetStore.get(layer.assetId).bitmap, 0, 0);
    const pixel = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    editor.document.undo();
    const undone = JSON.stringify(editor.document.toJSON()) === original;
    editor.document.redo();
    return {
      restored: candidate.restored,
      error,
      unchanged,
      pixel,
      undone,
      redone: editor.document.layers.length,
      adapters: editor.ai.providerRegistry.listProviders().length,
      prompt: editor.ai.getRecord(candidate.jobId)?.prompt,
      spent:
        editor.ai.budgetLedger.getBudget("default-budget")?.spentSoFarCents,
    };
  }, saved.id);
  expect(state).toMatchObject({
    restored: true,
    unchanged: true,
    pixel: [255, 0, 0, 255],
    undone: true,
    redone: 1,
    adapters: 0,
    prompt: "Saved red square",
    spent: 4,
  });
  expect(state.error).toContain("reviewed for the current document");
  await page.evaluate(
    (id) => window.luma.editor.ai.discardCandidate(id),
    saved.id,
  );
  await page.reload();
  expect(
    await page.evaluate(() => window.luma.editor.ai.restoreCandidates()),
  ).toHaveLength(0);
});

test("corrupted stored pixels fail integrity verification without entering the review shelf", async ({
  page,
}) => {
  const saved = await generate(page);
  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("luma-generation-candidates", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("candidates", "readwrite");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
        const store = tx.objectStore("candidates");
        const get = store.get(id);
        get.onsuccess = () => {
          get.result.payload.blob = new Blob(["corrupt"], {
            type: "image/png",
          });
          store.put(get.result, id);
        };
      };
    });
  }, saved.id);
  await page.reload();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".generate-error-banner")).toContainText(
    "integrity verification failed",
  );
  await expect(page.locator(".candidate-active-card")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.luma.editor.ai.staging.listCandidates().length,
    ),
  ).toBe(0);
});

for (const mode of ["abort write", "cancel during save"] as const) {
  test(`candidate recovery handles ${mode} without losing accounting`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (mode) => {
      const { registerSimulationAdapters } = await import(
        /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
      );
      const editor = window.luma.editor;
      registerSimulationAdapters(editor.ai.providerRegistry);
      editor.ai.providerRegistry.getAdapter("flux-1-pro").generate =
        async () => ({
          id: "provider-output",
          providerId: "flux-1-pro",
          width: 16,
          height: 16,
          hasAlpha: false,
          imageData: new Uint8Array(16 * 16 * 4).fill(255),
          mimeType: "image/png",
          costCents: 4,
          durationMs: 1,
        });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const request = put.apply(this, args);
        if (this.transaction.db.name === "luma-generation-candidates") {
          if (mode === "abort write") this.transaction.abort();
          else void editor.ai.cancel(args[0].payload.jobId);
        }
        return request;
      };
      let error = "";
      try {
        const job = await editor.ai.submit(
          {
            prompt: "saved output failure",
            modality: "text-to-image",
            targetWidth: 16,
            targetHeight: 16,
          },
          {
            providerId: "flux-1-pro",
            budgetId: "default-budget",
            baseRevision: 0,
          },
        );
        try {
          await job.result();
        } catch (value) {
          error = String(value);
        }
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      const candidates = await editor.ai.restoreCandidates();
      return {
        error,
        candidates: candidates.length,
        spent:
          editor.ai.budgetLedger.getBudget("default-budget")?.spentSoFarCents,
        prompt: candidates[0]
          ? editor.ai.getRecord(candidates[0].jobId)?.prompt
          : null,
      };
    }, mode);
    expect(result.spent).toBe(4);
    if (mode === "abort write") {
      expect(result.error).toContain("available only in this session");
      expect(result.candidates).toBe(1);
      expect(result.prompt).toBe("saved output failure");
      await page.getByRole("button", { name: "Generate", exact: true }).click();
      await expect(page.locator(".candidate-active-card")).toBeVisible();
    } else {
      expect(result.error).toContain("cancelled");
      expect(result.candidates).toBe(0);
    }
    await page.reload();
    expect(
      await page.evaluate(() => window.luma.editor.ai.restoreCandidates()),
    ).toHaveLength(0);
  });
}

test("protected edit references survive reload and are rechecked during placement", async ({
  page,
}) => {
  await page.goto("/");
  const candidateId = await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate =
      async () => ({
        id: "protected-output",
        providerId: "flux-1-pro",
        width: 16,
        height: 16,
        hasAlpha: false,
        imageData: new Uint8Array(16 * 16 * 4).fill(255),
        mimeType: "image/png",
        costCents: 4,
        durationMs: 1,
      });
    const job = await editor.ai.submit(
      {
        prompt: "protected reference",
        modality: "masked-edit",
        targetWidth: 16,
        targetHeight: 16,
        referenceImage: {
          width: 16,
          height: 16,
          data: new Uint8Array(16 * 16 * 4).fill(255),
          mimeType: "image/png",
        },
        protectedMask: {
          width: 16,
          height: 16,
          coverage: new Uint8Array(16 * 16).fill(255),
        },
      },
      { providerId: "flux-1-pro", budgetId: "default-budget", baseRevision: 0 },
    );
    return (await job.result()).id;
  });
  await page.reload();
  const result = await page.evaluate(async (candidateId) => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 16, height: 16 });
    await editor.ai.restoreCandidates();
    const candidate = editor.ai.staging.getCandidate(candidateId)!;
    const context = editor.ai.staging.getProtectionContext(candidateId)!;
    const protectedBefore = candidate.diffReport?.totalProtectedPixels;
    await editor.applyGeneratedCandidate(candidateId, {
      allowStaleRevision: true,
    });
    return {
      referenceBytes: context.referenceBuffer.length,
      referenceIntact: context.referenceBuffer.every((value) => value === 255),
      maskIntact: context.protectedMask!.every((value) => value === 255),
      protectedBefore,
      passed: candidate.diffReport?.passed,
      protectedAfter: candidate.diffReport?.totalProtectedPixels,
    };
  }, candidateId);
  expect(result).toEqual({
    referenceBytes: 1024,
    referenceIntact: true,
    maskIntact: true,
    protectedBefore: 256,
    passed: true,
    protectedAfter: 256,
  });
});

test("completed idempotent jobs recover their original result without a configured provider or new consent", async ({
  page,
}) => {
  const saved = await generate(page);
  await page.evaluate(() =>
    window.luma.editor.ai.setBudgetConsent("default-budget", false),
  );
  await page.reload();
  const result = await page.evaluate(async () => {
    const service = window.luma.editor.ai;
    const request = {
      prompt: "Saved red square",
      modality: "text-to-image" as const,
      targetWidth: 16,
      targetHeight: 16,
    };
    const options = {
      providerId: "flux-1-pro",
      budgetId: "default-budget",
      baseRevision: 99,
      idempotencyKey: "saved-square",
    };
    const [first, second] = await Promise.all([
      service.submit(request, options),
      service.submit(request, options),
    ]);
    const candidate = await first.result();
    let conflict = "";
    try {
      await service.submit({ ...request, prompt: "different" }, options);
    } catch (error) {
      conflict = String(error);
    }
    return {
      sameJob: first === second,
      id: first.id,
      state: first.state,
      candidateId: candidate.id,
      restored: candidate.restored,
      createdAt: first.createdAt,
      completedAt: first.completedAt,
      baseRevision: first.baseRevision,
      consent: service.budgetLedger.getBudget("default-budget")?.consentGiven,
      spent: service.budgetLedger.getBudget("default-budget")?.spentSoFarCents,
      providers: service.providerRegistry.listProviders().length,
      entries: (await service.recoveredAccounting()).length,
      conflict,
    };
  });
  expect(result).toMatchObject({
    sameJob: true,
    id: saved.jobId,
    state: "succeeded",
    candidateId: saved.id,
    restored: true,
    createdAt: saved.createdAt,
    completedAt: saved.completedAt,
    baseRevision: saved.baseRevision,
    consent: false,
    spent: 4,
    providers: 0,
    entries: 1,
  });
  expect(result.conflict).toContain("different generation request");
});

test("discarded results retain idempotency protection without claiming a recoverable image", async ({
  page,
}) => {
  const saved = await generate(page);
  await page.evaluate(
    (id) => window.luma.editor.ai.discardCandidate(id),
    saved.id,
  );
  await page.reload();
  const result = await page.evaluate(async () => {
    const service = window.luma.editor.ai;
    const job = await service.submit(
      {
        prompt: "Saved red square",
        modality: "text-to-image",
        targetWidth: 16,
        targetHeight: 16,
      },
      {
        providerId: "flux-1-pro",
        budgetId: "default-budget",
        baseRevision: 0,
        idempotencyKey: "saved-square",
      },
    );
    let error = "";
    try {
      await job.result();
    } catch (value) {
      error = String(value);
    }
    return {
      id: job.id,
      state: job.state,
      error,
      spent: service.budgetLedger.getBudget("default-budget")?.spentSoFarCents,
      candidates: service.staging.listCandidates().length,
      entries: (await service.recoveredAccounting()).length,
    };
  });
  expect(result).toMatchObject({
    id: saved.jobId,
    state: "failed",
    spent: 4,
    candidates: 0,
    entries: 1,
  });
  expect(result.error).toContain("No saved result is available");
});
