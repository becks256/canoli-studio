import { expect, test } from "@playwright/test";

test("quota failures preserve both checkpoint stores and retry the current edits without another edit", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await editor.importImage(
      new File([blob], "Original.png", { type: "image/png" }),
    );
    await editor.recovery.flush();
    await editor.workspaceAutosave.flush();
    const { readProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const saved = await readProject(
      (await editor.workspaceAutosave.load())!.documents[0].project,
    );
    const beforeRecovery = await readProject(
      await editor.recovery.repository.project(editor.recoverySessionId),
    );
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (
        this.name === "checkpoints" ||
        (this.name === "workspaces" && String(key).startsWith("automatic:"))
      ) {
        Object.defineProperty(this.transaction, "error", {
          value: new DOMException(
            "Simulated quota failure",
            "QuotaExceededError",
          ),
        });
        this.transaction.abort();
      }
      return request;
    };
    let messages: string[];
    try {
      editor.document.name = "Unsaved changes";
      await editor.recovery.flush();
      try {
        await editor.workspaceAutosave.flush();
      } catch {
        /* observable error state */
      }
      messages = [
        editor.recovery.getSnapshot().message,
        editor.workspaceAutosave.getSnapshot().message,
      ];
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const afterWorkspace = await readProject(
      (await editor.workspaceAutosave.load())!.documents[0].project,
    );
    const afterRecovery = await readProject(
      await editor.recovery.repository.project(editor.recoverySessionId),
    );
    const download = await readProject(await editor.saveProject());
    const sourceUnchanged =
      new Uint8Array(
        await afterRecovery.entries[0].blob.arrayBuffer(),
      ).join() === new Uint8Array(await blob.arrayBuffer()).join();
    await editor.recovery.flush();
    await editor.workspaceAutosave.flush();
    const retriedRecovery = await readProject(
      await editor.recovery.repository.project(editor.recoverySessionId),
    );
    const retriedWorkspace = await readProject(
      (await editor.workspaceAutosave.load())!.documents[0].project,
    );
    return {
      messages,
      previousWorkspace: afterWorkspace.document.name === saved.document.name,
      previousRecovery:
        afterRecovery.document.name === beforeRecovery.document.name,
      sourceUnchanged,
      downloaded: download.document.name,
      retried: [retriedRecovery.document.name, retriedWorkspace.document.name],
      statuses: [
        editor.recovery.getSnapshot().status,
        editor.workspaceAutosave.getSnapshot().status,
      ],
    };
  });
  for (const message of result.messages) {
    expect(message).toContain("Browser storage is full");
    expect(message).toContain("Download");
  }
  expect(result).toMatchObject({
    previousWorkspace: true,
    previousRecovery: true,
    sourceUnchanged: true,
    downloaded: "Unsaved changes",
    retried: ["Unsaved changes", "Unsaved changes"],
    statuses: ["saved", "saved"],
  });
});

test("Recovery exposes a retry after quota failure and saves without requiring another edit", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const repo = editor.recovery.repository;
    const save = repo.save.bind(repo);
    (window as any).restoreRecoverySave = () => {
      repo.save = save;
    };
    repo.save = async () => {
      throw new DOMException("Full", "QuotaExceededError");
    };
    editor.document.name = "Retry from panel";
    await editor.recovery.flush();
  });
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  const retry = page.getByRole("button", {
    name: "Retry document recovery",
    exact: true,
  });
  await expect(retry).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Download current project", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => (window as any).restoreRecoverySave());
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.luma.editor.recovery.getSnapshot().status),
    )
    .toBe("saved");
});

test("Chromium-enforced origin quota rejects checkpoints, preserves originals and permits retry after quota restoration", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await editor.importImage(
      new File([blob], "Quota baseline.png", { type: "image/png" }),
    );
    await editor.recovery.flush();
    await editor.workspaceAutosave.flush();
  });
  const cdp = await context.newCDPSession(page);
  const origin = new URL(page.url()).origin;
  try {
    await cdp.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: 1 });
    const quota = await cdp.send("Storage.getUsageAndQuota", { origin });
    expect(quota.overrideActive).toBe(true);
    expect(quota.quota).toBe(1);
    // Chromium caches bucket space. Observe a native rejected write before testing
    // application saves; merely observing the override does not establish enforcement.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            return new Promise<string>((resolve, reject) => {
              const open = indexedDB.open("luma-quota-enforcement-probe", 1);
              open.onupgradeneeded = () =>
                open.result.createObjectStore("probe");
              open.onerror = () => resolve(open.error?.name ?? "UnknownError");
              open.onsuccess = () => {
                const db = open.result;
                const tx = db.transaction("probe", "readwrite");
                tx.oncomplete = () => {
                  db.close();
                  resolve("saved");
                };
                tx.onabort = () => {
                  db.close();
                  resolve(tx.error?.name ?? "AbortError");
                };
                tx.onerror = () => {};
                try {
                  tx.objectStore("probe").put(new Uint8Array(1), "same-key");
                } catch (error) {
                  db.close();
                  reject(error);
                }
              };
            });
          }),
        { timeout: 90_000, intervals: [500, 1000] },
      )
      .toBe("QuotaExceededError");
    const result = await page.evaluate(async () => {
      const editor = window.luma.editor;
      const { readProject } = await import(
        /* @vite-ignore */ String("/src/core/project.ts")
      );
      const baseline = await readProject(
        (await editor.workspaceAutosave.load())!.documents[0].project,
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(1024, 1024);
      // Incompressible source forces a real storage increase rather than a same-size update.
      for (let offset = 0; offset < image.data.length; offset += 65536)
        crypto.getRandomValues(image.data.subarray(offset, offset + 65536));
      context.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), "image/png"),
      );
      await editor.importImage(
        new File([blob], "New artwork.png", { type: "image/png" }),
      );
      // Large metadata takes the transferable worker persistence path.
      const { PaintLayer, BrushStroke } = window.luma;
      const paint = new PaintLayer({ visible: false });
      paint.strokes.add(new BrushStroke({ points: Array.from({length: 10000}, (_, i) => ({x: i % 698, y: i % 396, pressure: 1})) }));
      editor.document.layers.add(paint);
      editor.document.name = "Not yet checkpointed";
      await editor.recovery.flush();
      let errorName = "";
      try {
        await editor.workspaceAutosave.flush();
      } catch (error) {
        errorName = (error as Error).name;
      }
      const failedStates = [
        editor.recovery.getSnapshot(),
        editor.workspaceAutosave.getSnapshot(),
      ];
      const previous = await readProject(
        (await editor.workspaceAutosave.load())!.documents[0].project,
      );
      const recovered = await readProject(
        await editor.recovery.repository.project(editor.recoverySessionId),
      );
      const originalBytes = new Uint8Array(
        await baseline.entries[0].blob.arrayBuffer(),
      ).join();
      const downloaded = await readProject(await editor.saveProject());
      return {
        errorName,
        statuses: failedStates.map((state) => state.status),
        messages: failedStates.map((state) => state.message),
        names: [previous.document.name, recovered.document.name],
        originalsIntact:
          [previous, recovered].every(
            (project) => project.entries.length === 1,
          ) &&
          new Uint8Array(
            await previous.entries[0].blob.arrayBuffer(),
          ).join() === originalBytes &&
          new Uint8Array(
            await recovered.entries[0].blob.arrayBuffer(),
          ).join() === originalBytes,
        downloadedName: downloaded.document.name,
        downloadedAssets: downloaded.entries.length,
      };
    });
    expect(result.errorName).toBe("QuotaExceededError");
    expect(result.statuses).toEqual(["error", "error"]);
    expect(
      result.messages.every((message) =>
        message.includes("Browser storage is full"),
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      names: ["Quota baseline", "Quota baseline"],
      originalsIntact: true,
      downloadedName: "Not yet checkpointed",
      downloadedAssets: 2,
    });
  } finally {
    await cdp.send("Storage.overrideQuotaForOrigin", { origin });
    await cdp.detach();
  }
  const retried = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.recovery.flush();
    await editor.workspaceAutosave.flush();
    const { readProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const project = await readProject(
      (await editor.workspaceAutosave.load())!.documents[0].project,
    );
    const recovery = await readProject(
      await editor.recovery.repository.project(editor.recoverySessionId),
    );
    return {
      statuses: [
        editor.recovery.getSnapshot().status,
        editor.workspaceAutosave.getSnapshot().status,
      ],
      names: [project.document.name, recovery.document.name],
      assets: [project.entries.length, recovery.entries.length],
    };
  });
  expect(retried).toEqual({
    statuses: ["saved", "saved"],
    names: ["Not yet checkpointed", "Not yet checkpointed"],
    assets: [2, 2],
  });
});
