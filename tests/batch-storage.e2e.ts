import { test, expect } from "@playwright/test";

test("aborted batch writes reject and preserve durable state across reload", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storage = window.luma.editor.batch.storage;
    const run = await window.luma.editor.batch.createBatch(
      { name: "Before failure", budgetId: "default-budget" },
      [],
    );
    await storage.saveDeliverableBlob("storage-test", new Blob(["original"]));
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = original.apply(this, args);
      this.transaction.abort();
      return request;
    };
    const failures: string[] = [];
    try {
      run.config.name = "Unsaved change";
      for (const write of [
        () => storage.saveRun(run),
        () =>
          storage.saveDeliverableBlob(
            "storage-test",
            new Blob(["replacement"]),
          ),
        () => storage.saveDeliverableBlob("new-output", new Blob(["new"])),
      ]) {
        try {
          await write();
        } catch {
          failures.push("rejected");
        }
      }
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    return {
      id: run.id,
      failures,
      name: (await storage.getRun(run.id))?.config.name,
      bytes: await (await storage.getDeliverableBlob("storage-test"))?.text(),
      missing: (await storage.getDeliverableBlob("new-output")) === null,
    };
  });
  expect(result.failures).toHaveLength(3);
  expect(result.name).toBe("Before failure");
  expect(result.bytes).toBe("original");
  expect(result.missing).toBe(true);
  await page.reload();
  const persisted = await page.evaluate(
    async (id) => ({
      name: (await window.luma.editor.batch.storage.getRun(id))?.config.name,
      bytes: await (
        await window.luma.editor.batch.storage.getDeliverableBlob(
          "storage-test",
        )
      )?.text(),
    }),
    result.id,
  );
  expect(persisted).toEqual({ name: "Before failure", bytes: "original" });
});

test("a second tab cannot recover a run while its owner holds the execution lock", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const runId = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const run = await editor.batch.createBatch(
      { name: "Ownership", budgetId: "default-budget" },
      [],
    );
    await new Promise<void>((resolve) => {
      void navigator.locks.request(`luma-batch:${run.id}`, async () => {
        resolve();
        await new Promise<void>((release) => {
          (window as any).releaseBatchLock = release;
        });
      });
    });
    return run.id;
  });
  const second = await context.newPage();
  await second.goto("/");
  const failure = await second.evaluate(async (id) => {
    try {
      await window.luma.editor.batch.resume(id);
      return "";
    } catch (error) {
      return String(error);
    }
  }, runId);
  expect(failure).toContain("already running in another tab");
  const otherActions = await second.evaluate(async (id) => {
    const failures: string[] = [];
    for (const action of [
      () => window.luma.editor.batch.retryFailed(id),
      () => window.luma.editor.batch.deleteRun(id),
    ]) {
      try {
        await action();
      } catch (error) {
        failures.push(String(error));
      }
    }
    return failures;
  }, runId);
  expect(otherActions).toHaveLength(2);
  expect(otherActions.every((message) => message.includes("another tab"))).toBe(
    true,
  );

  await page.close(); // Browser releases ownership automatically on owner death.
  await expect
    .poll(() =>
      second.evaluate(
        async (id) =>
          (await navigator.locks.query()).held?.some(
            (lock) => lock.name === `luma-batch:${id}`,
          ) ?? false,
        runId,
      ),
    )
    .toBe(false);
  const result = await second.evaluate(async (id) => {
    await window.luma.editor.batch.resume(id);
    return (await window.luma.editor.batch.waitForRun(id)).status;
  }, runId);
  expect(result).toBe("completed");
});

test("concurrent tabs preserve all atomic batch updates and rollback rejected updates", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const id = await page.evaluate(
    async () =>
      (
        await window.luma.editor.batch.createBatch(
          { name: "Atomic", budgetId: "default-budget" },
          [],
        )
      ).id,
  );
  const second = await context.newPage();
  await second.goto("/");
  await Promise.all(
    [page, second].map((tab) =>
      tab.evaluate(async (runId) => {
        for (let i = 0; i < 10; i++)
          await window.luma.editor.batch.storage.updateRun(runId, (run) => {
            run.summary.approvedCount++;
          });
      }, id),
    ),
  );
  const state = await page.evaluate(async (runId) => {
    const storage = window.luma.editor.batch.storage;
    let rejected = false;
    try {
      await storage.updateRun(runId, (run) => {
        run.config.name = "Uncommitted";
        throw new Error("Reject");
      });
    } catch {
      rejected = true;
    }
    const run = await storage.getRun(runId);
    return {
      rejected,
      count: run?.summary.approvedCount,
      name: run?.config.name,
    };
  }, id);
  expect(state).toEqual({ rejected: true, count: 20, name: "Atomic" });
});

test("deleting a batch removes its sources and outputs atomically", async ({
  page,
}) => {
  await page.goto("/");
  const keys = await page.evaluate(async () => {
    const service = window.luma.editor.batch;
    const blob = new Blob(["source"]);
    const run = await service.createBatch(
      { name: "Delete all", budgetId: "default-budget" },
      [
        {
          id: "source",
          name: "source.png",
          width: 16,
          height: 16,
          byteLength: blob.size,
          mimeType: "image/png",
          blob,
        },
      ],
    );
    const sourceKey = `src-${run.items[0].id}`;
    const outputKey = `${run.items[0].id}:${run.config.variants[0].id}`;
    await service.storage.saveDeliverableBlob(
      outputKey,
      new Blob(["uncheckpointed output"]),
    );
    await service.deleteRun(run.id);
    return { runId: run.id, sourceKey, outputKey };
  });
  await page.reload();
  const remaining = await page.evaluate(async (keys) => {
    const storage = window.luma.editor.batch.storage;
    return [
      await storage.getRun(keys.runId),
      await storage.getDeliverableBlob(keys.sourceKey),
      await storage.getDeliverableBlob(keys.outputKey),
    ];
  }, keys);
  expect(remaining).toEqual([null, null, null]);
});

test("cancelling from another tab stops the owner before its next variant", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const id = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.ai.budgetLedger.setConsent("default-budget", true, "test");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const original = editor.renderer.render.bind(editor.renderer);
    (window as any).renderCount = 0;
    editor.renderer.render = async (...args) => {
      (window as any).renderCount++;
      await new Promise<void>((resolve) => {
        (window as any).releaseRender = resolve;
      });
      return original(...args);
    };
    editor.batch.subscribe((event) => {
      if (event.type === "run_cancelled")
        (window as any).remoteCancelObserved = true;
    });
    const run = await editor.batch.createBatch(
      {
        name: "Remote cancel",
        budgetId: "default-budget",
        variants: [1, 2].map((i) => ({
          id: String(i),
          name: String(i),
          targetWidth: 16,
          targetHeight: 16,
          format: "png",
          fit: "fill",
        })),
      },
      [
        {
          id: "source",
          name: "source.png",
          width: 16,
          height: 16,
          byteLength: blob.size,
          mimeType: "image/png",
          blob,
        },
      ],
    );
    await editor.batch.start(run.id);
    return run.id;
  });
  await page.waitForFunction(() => !!(window as any).releaseRender);
  const second = await context.newPage();
  await second.goto("/");
  await second.evaluate((id) => window.luma.editor.batch.cancel(id), id);
  await page.waitForFunction(
    () => (window as any).remoteCancelObserved === true,
  );
  const result = await page.evaluate(async (id) => {
    (window as any).releaseRender();
    const run = await window.luma.editor.batch.waitForRun(id);
    return {
      status: run.status,
      item: run.items[0].status,
      count: (window as any).renderCount,
      output: await window.luma.editor.batch.storage.getDeliverableBlob(
        `${run.items[0].id}:1`,
      ),
    };
  }, id);
  expect(result).toEqual({
    status: "cancelled",
    item: "cancelled",
    count: 1,
    output: null,
  });
});

test("batch creation rolls back all sources on failure and refuses to replace an existing run", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const service = window.luma.editor.batch;
    const blob = new Blob(["original source"]);
    const source = {
      id: "source",
      name: "image.png",
      width: 16,
      height: 16,
      byteLength: blob.size,
      mimeType: "image/png",
      blob,
    };
    const original = IDBObjectStore.prototype.add;
    const attemptedKeys: string[] = [];
    IDBObjectStore.prototype.add = function (
      ...args: Parameters<IDBObjectStore["add"]>
    ) {
      const request = original.apply(this, args);
      if (this.name === "blobs") attemptedKeys.push(String(args[1]));
      if (this.name === "runs") this.transaction.abort();
      return request;
    };
    let rejected = false;
    try {
      await service.createBatch(
        { id: "atomic-create", name: "Failed", budgetId: "default-budget" },
        [source, source],
      );
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.add = original;
    }
    const missing = await Promise.all(
      attemptedKeys.map((key) => service.storage.getDeliverableBlob(key)),
    );
    const absent = (await service.getRun("atomic-create")) === null;
    const saved = await service.createBatch(
      { id: "atomic-create", name: "Original", budgetId: "default-budget" },
      [source],
    );
    let duplicateRejected = false;
    try {
      await service.createBatch(
        { id: saved.id, name: "Replacement", budgetId: "default-budget" },
        [source],
      );
    } catch {
      duplicateRejected = true;
    }
    return {
      rejected,
      attempted: attemptedKeys.length,
      missing: missing.every((value) => value === null),
      absent,
      duplicateRejected,
      name: (await service.getRun(saved.id))?.config.name,
      sourceKey: `src-${saved.items[0].id}`,
    };
  });
  expect(result).toMatchObject({
    rejected: true,
    attempted: 2,
    missing: true,
    absent: true,
    duplicateRejected: true,
    name: "Original",
  });
  await page.reload();
  const persisted = await page.evaluate(
    async (key) => ({
      name: (await window.luma.editor.batch.getRun("atomic-create"))?.config
        .name,
      source: await (
        await window.luma.editor.batch.storage.getDeliverableBlob(key)
      )?.text(),
    }),
    result.sourceKey,
  );
  expect(persisted).toEqual({ name: "Original", source: "original source" });
});

test("unused batch cleanup rolls back on failure and preserves source/output references after reload", async ({
  page,
}) => {
  await page.goto("/");
  const info = await page.evaluate(async () => {
    const service = window.luma.editor.batch;
    const source = new Blob(["source"]);
    const run = await service.createBatch(
      { name: "Keep", budgetId: "default-budget" },
      [
        {
          id: "source",
          name: "source.png",
          width: 16,
          height: 16,
          mimeType: "image/png",
          byteLength: source.size,
          blob: source,
        },
      ],
    );
    const sourceKey = `src-${run.items[0].id}`;
    const outputKey = `${run.items[0].id}:${run.config.variants[0].id}`;
    await service.storage.saveDeliverableBlob(
      outputKey,
      new Blob(["retained output"]),
    );
    await service.storage.saveDeliverableBlob(
      "unused-old-source",
      new Blob(["orphan"]),
    );
    const original = IDBCursor.prototype.delete;
    IDBCursor.prototype.delete = function () {
      const request = original.call(this);
      request.addEventListener("success", () => request.transaction!.abort());
      return request;
    };
    let rejected = false;
    try {
      await service.storage.reclaimUnusedBlobs();
    } catch {
      rejected = true;
    } finally {
      IDBCursor.prototype.delete = original;
    }
    const intact = await (
      await service.storage.getDeliverableBlob("unused-old-source")
    )?.text();
    return { sourceKey, outputKey, rejected, intact };
  });
  expect(info.rejected).toBe(true);
  expect(info.intact).toBe("orphan");
  await page.getByRole("button", { name: "Batch", exact: true }).click();
  await page.getByRole("button", { name: "Clean unused batch files" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Removed 1 unused files (6 bytes)",
  );
  await page.reload();
  const retained = await page.evaluate(async ({ sourceKey, outputKey }) => {
    const storage = window.luma.editor.batch.storage;
    return {
      source: await (await storage.getDeliverableBlob(sourceKey))?.text(),
      output: await (await storage.getDeliverableBlob(outputKey))?.text(),
      unused: await storage.getDeliverableBlob("unused-old-source"),
    };
  }, info);
  expect(retained).toEqual({
    source: "source",
    output: "retained output",
    unused: null,
  });
});

test("cleanup preserves all bytes when stored run references cannot be read", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storage = window.luma.editor.batch.storage;
    await storage.saveDeliverableBlob(
      "possibly-referenced",
      new Blob(["keep"]),
    );
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("luma-batch-storage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite");
      tx.objectStore("runs").put({ id: "corrupt", items: null });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    let rejected = false;
    try {
      await storage.reclaimUnusedBlobs();
    } catch {
      rejected = true;
    }
    return {
      rejected,
      bytes: await (
        await storage.getDeliverableBlob("possibly-referenced")
      )?.text(),
    };
  });
  expect(result).toEqual({ rejected: true, bytes: "keep" });
});

test("changed source bytes fail integrity verification and original bytes permit retry", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.ai.budgetLedger.setConsent("default-budget", true, "test");
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red";
    context.fillRect(0, 0, 16, 16);
    const original = await canvas.convertToBlob({ type: "image/png" });
    context.fillStyle = "blue";
    context.fillRect(0, 0, 16, 16);
    const changed = await canvas.convertToBlob({ type: "image/png" });
    const run = await editor.batch.createBatch(
      {
        name: "Integrity",
        budgetId: "default-budget",
        variants: [
          {
            id: "small",
            name: "Small",
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
          name: "art.png",
          width: 16,
          height: 16,
          byteLength: original.size,
          mimeType: "image/png",
          blob: original,
        },
      ],
    );
    const key = `src-${run.items[0].id}`;
    await editor.batch.storage.saveDeliverableBlob(key, changed);
    await editor.batch.start(run.id);
    const failed = await editor.batch.waitForRun(run.id);
    await editor.batch.storage.saveDeliverableBlob(key, original);
    await editor.batch.retryFailed(run.id);
    const retried = await editor.batch.waitForRun(run.id);
    const output = await editor.batch.storage.getDeliverableBlob(
      retried.items[0].deliverables[0].id,
    );
    const bitmap = await createImageBitmap(output!);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      hash: run.items[0].source.sha256,
      failed: failed.status,
      error: failed.items[0].error,
      failedOutputs: failed.items[0].deliverables.length,
      retried: retried.status,
      pixel: [...context.getImageData(0, 0, 1, 1).data],
    };
  });
  expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.failed).toBe("failed");
  expect(result.error).toContain("Source integrity verification failed");
  expect(result.failedOutputs).toBe(0);
  expect(result.retried).toBe("completed");
  expect(result.pixel).toEqual([255, 0, 0, 255]);
});
