import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function reserve(page: Page, jobId: string, key = jobId, amount = 60) {
  return page.evaluate(
    async ({ jobId, key, amount }) => {
      const { GenerationJournal } = await import(
        /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
      );
      return new GenerationJournal().reserve({
        jobId,
        budgetId: "budget",
        providerId: "fixture",
        requestFingerprint: "same-request",
        idempotencyKey: key,
        estimatedCostCents: amount,
        initialBudget: {
          approvedCeilingCents: 100,
          consentGiven: true,
          approverId: "owner",
          spentSoFarCents: 0,
          approvalTimestamp: new Date().toISOString(),
        },
      });
    },
    { jobId, key, amount },
  );
}

async function read(page: Page) {
  return page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    return new GenerationJournal().read();
  });
}

test("pending accounting survives reload and cannot redispatch or settle twice", async ({
  page,
}) => {
  await page.goto("/");
  await reserve(page, "pending");
  await page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    await new GenerationJournal().beginDispatch("pending");
  });
  await page.reload();
  expect((await reserve(page, "retry", "pending")).jobId).toBe("pending");
  const result = await page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    const journal = new GenerationJournal();
    const before = await journal.read();
    const errors: string[] = [];
    for (const operation of [
      () => journal.beginDispatch("pending"),
      () => journal.cancelQueued("pending"),
    ]) {
      try {
        await operation();
      } catch (error) {
        errors.push(String(error));
      }
    }
    await journal.settle("pending", 75);
    await journal.settle("pending", 75);
    try {
      await journal.settle("pending", 0);
    } catch (error) {
      errors.push(String(error));
    }
    return { before, errors, after: await journal.read() };
  });
  expect(result.before.entries[0].billingState).toBe("pending");
  expect(result.before.ledger.reservations).toHaveLength(1);
  expect(result.errors).toHaveLength(3);
  expect(result.after.ledger.budgets[0].budget.spentSoFarCents).toBe(75);
  expect(result.after.ledger.reservations).toHaveLength(0);
  await page.reload();
  expect((await read(page)).ledger.budgets[0].budget.spentSoFarCents).toBe(75);
});

test("competing tabs deduplicate a key and share the approved budget ceiling", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/");
  const [first, second] = await Promise.all([
    reserve(page, "first", "shared"),
    reserve(other, "second", "shared"),
  ]);
  expect(first.jobId).toBe(second.jobId);
  await expect(reserve(other, "excess")).rejects.toThrow(/exceeds/);
  const state = await read(page);
  expect(state.entries).toHaveLength(1);
  expect(state.ledger.reservations).toHaveLength(1);
  await other.close();
});

test("revocation and failed journal writes prevent durable dispatch without changing prior state", async ({
  page,
}) => {
  await page.goto("/");
  await reserve(page, "queued");
  const result = await page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    const journal = new GenerationJournal();
    const before = await journal.read();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    };
    let failed = false;
    try {
      await journal.beginDispatch("queued");
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const afterFailure = await journal.read();
    await journal.setConsent("budget", false);
    let revoked = false;
    try {
      await journal.beginDispatch("queued");
    } catch {
      revoked = true;
    }
    return {
      failed,
      revoked,
      unchanged: JSON.stringify(before) === JSON.stringify(afterFailure),
    };
  });
  expect(result).toEqual({ failed: true, revoked: true, unchanged: true });
  await page.reload();
  const state = await read(page);
  expect(state.entries[0].billingState).toBe("reserved");
  expect(state.ledger.budgets[0].budget.consentGiven).toBe(false);
});

test("a committed dispatch remains pending when settlement storage aborts", async ({
  page,
}) => {
  await page.goto("/");
  await reserve(page, "settlement");
  const result = await page.evaluate(async () => {
    const { GenerationJournal } = await import(
      /* @vite-ignore */ String("/src/ai/jobs/journal.ts")
    );
    const journal = new GenerationJournal();
    await journal.beginDispatch("settlement");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const result = put.apply(this, args);
      this.transaction.abort();
      return result;
    };
    let failed = false;
    try {
      await journal.settle("settlement", 80);
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    return failed;
  });
  expect(result).toBe(true);
  await page.reload();
  const state = await read(page);
  expect(state.entries[0].billingState).toBe("pending");
  expect(state.ledger.reservations).toHaveLength(1);
  expect(state.ledger.budgets[0].budget.spentSoFarCents).toBe(0);
});

test("corrupt job accounting rejects reads and writes without overwriting stored evidence", async ({
  page,
}) => {
  await page.goto("/");
  await reserve(page, "corrupt");
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("luma-generation-journal", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("state", "readwrite");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error);
        };
        const store = tx.objectStore("state");
        const request = store.get("journal");
        request.onsuccess = () => {
          const value = request.result;
          value.entries[0].reservationId = "missing-reservation";
          store.put(value, "journal");
        };
      };
    });
  });
  await page.reload();
  await expect(read(page)).rejects.toThrow(/reservation does not match/);
  await expect(reserve(page, "replacement")).rejects.toThrow(
    /reservation does not match/,
  );
  const stored = await page.evaluate(
    async () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open("luma-generation-journal", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("state", "readonly");
          const request = tx.objectStore("state").get("journal");
          request.onsuccess = () =>
            resolve(request.result.entries[0].reservationId);
          tx.oncomplete = () => db.close();
        };
      }),
  );
  expect(stored).toBe("missing-reservation");
});

test("application dispatch is durable and matching submissions after reload do not call the provider again", async ({
  page,
}) => {
  await page.goto("/");
  const jobId = await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    // These accounting fixtures intentionally use tiny images.
    const profile = structuredClone(
      editor.ai.providerRegistry.getProvider("flux-1-pro"),
    );
    profile.dimensions = {
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      maxMegapixels: 1,
      supportedAspectRatios: ["1:1"],
    };
    editor.ai.providerRegistry.registerProvider(profile);
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate = async () => {
      const entries = await editor.ai.recoveredAccounting();
      (window as any).dispatchWasDurable = entries.some(
        (entry) => entry.billingState === "pending",
      );
      return new Promise(() => {});
    };
    const job = await editor.ai.submit(
      {
        prompt: "durable request",
        modality: "text-to-image",
        targetWidth: 16,
        targetHeight: 16,
      },
      {
        providerId: "flux-1-pro",
        budgetId: "default-budget",
        baseRevision: 0,
        idempotencyKey: "reload-key",
      },
    );
    return job.id;
  });
  await page.waitForFunction(() => (window as any).dispatchWasDurable === true);
  await page.reload();
  const recovered = await page.evaluate(async (originalId) => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    // These accounting fixtures intentionally use tiny images.
    const profile = structuredClone(
      editor.ai.providerRegistry.getProvider("flux-1-pro"),
    );
    profile.dimensions = {
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      maxMegapixels: 1,
      supportedAspectRatios: ["1:1"],
    };
    editor.ai.providerRegistry.registerProvider(profile);
    let calls = 0;
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate = async () => {
      calls++;
      throw new Error("Must not redispatch");
    };
    const request = {
      prompt: "durable request",
      modality: "text-to-image" as const,
      targetWidth: 16,
      targetHeight: 16,
    };
    const options = {
      providerId: "flux-1-pro",
      budgetId: "default-budget",
      baseRevision: 0,
      idempotencyKey: "reload-key",
    };
    const job = await editor.ai.submit(request, options);
    let error = "",
      conflict = "";
    try {
      await job.result();
    } catch (value) {
      error = String(value);
    }
    try {
      await editor.ai.submit(
        { ...request, prompt: "different request" },
        options,
      );
    } catch (value) {
      conflict = String(value);
    }
    const pending = job.billingState;
    await editor.ai.reconcileBilling(originalId, 4);
    await editor.ai.reconcileBilling(originalId, 4);
    return {
      calls,
      id: job.id,
      pending,
      error,
      conflict,
      entries: await editor.ai.recoveredAccounting(),
      spent:
        editor.ai.budgetLedger.getBudget("default-budget")?.spentSoFarCents,
    };
  }, jobId);
  expect(recovered.id).toBe(jobId);
  expect(recovered.calls).toBe(0);
  expect(recovered.pending).toBe("pending");
  expect(recovered.error).toContain("not dispatched again");
  expect(recovered.conflict).toContain("different generation request");
  expect(recovered.spent).toBe(4);
  expect(recovered.entries[0].billingState).toBe("settled");
});

test("application refuses provider dispatch when saving dispatch intent aborts", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    // These accounting fixtures intentionally use tiny images.
    const profile = structuredClone(
      editor.ai.providerRegistry.getProvider("flux-1-pro"),
    );
    profile.dimensions = {
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      maxMegapixels: 1,
      supportedAspectRatios: ["1:1"],
    };
    editor.ai.providerRegistry.registerProvider(profile);
    let calls = 0;
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate = async () => {
      calls++;
      throw new Error("Must not dispatch");
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = put.apply(this, args);
      if (
        this.transaction.db.name === "luma-generation-journal" &&
        args[0].entries?.some((entry: any) => entry.billingState === "pending")
      )
        this.transaction.abort();
      return request;
    };
    let error = "";
    try {
      const job = await editor.ai.submit(
        {
          prompt: "blocked dispatch",
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
    return {
      calls,
      error,
      entries: await editor.ai.recoveredAccounting(),
      reserved: editor.ai.budgetLedger.getTotalReserved("default-budget"),
    };
  });
  expect(result.calls).toBe(0);
  expect(result.error).toContain("abort");
  expect(result.reserved).toBe(0);
  expect(result.entries[0]).toMatchObject({
    billingState: "settled",
    actualCostCents: 0,
  });
});

test("provider charges remain recoverable when the application cannot persist settlement", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { registerSimulationAdapters } = await import(
      /* @vite-ignore */ String("/tests/fixtures/generation/adapters.ts")
    );
    const editor = window.luma.editor;
    registerSimulationAdapters(editor.ai.providerRegistry);
    // These accounting fixtures intentionally use tiny images.
    const profile = structuredClone(
      editor.ai.providerRegistry.getProvider("flux-1-pro"),
    );
    profile.dimensions = {
      minWidth: 16,
      minHeight: 16,
      maxWidth: 16,
      maxHeight: 16,
      maxMegapixels: 1,
      supportedAspectRatios: ["1:1"],
    };
    editor.ai.providerRegistry.registerProvider(profile);
    let calls = 0;
    editor.ai.providerRegistry.getAdapter("flux-1-pro").generate = async () => {
      calls++;
      return {
        id: "charged",
        providerId: "flux-1-pro",
        width: 16,
        height: 16,
        hasAlpha: false,
        imageData: new Uint8Array(16 * 16 * 4).fill(255),
        mimeType: "image/png",
        costCents: 4,
        durationMs: 1,
      };
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = put.apply(this, args);
      if (
        this.transaction.db.name === "luma-generation-journal" &&
        args[0].entries?.some((entry: any) => entry.actualCostCents === 4)
      )
        this.transaction.abort();
      return request;
    };
    try {
      const job = await editor.ai.submit(
        {
          prompt: "charged fixture",
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
      let error = "";
      try {
        await job.result();
      } catch (value) {
        error = String(value);
      }
      return {
        id: job.id,
        calls,
        error,
        billing: job.billingState,
        reserved: editor.ai.budgetLedger.getTotalReserved("default-budget"),
        candidates: editor.ai.staging.listCandidates().length,
      };
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  });
  expect(result.calls).toBe(1);
  expect(result.error).toContain("abort");
  expect(result.billing).toBe("pending");
  expect(result.reserved).toBeGreaterThan(0);
  expect(result.candidates).toBe(0);
  await page.reload();
  const spent = await page.evaluate(async (jobId) => {
    await window.luma.editor.ai.reconcileBilling(jobId, 4);
    return window.luma.editor.ai.budgetLedger.getBudget("default-budget")
      ?.spentSoFarCents;
  }, result.id);
  expect(spent).toBe(4);
});
