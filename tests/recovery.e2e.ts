import { test, expect } from "@playwright/test";

test("completed recovery survives reload and restores a separate editable copy", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Recoverable design";
    const layer = editor.document.layers.add(
      new TextLayer({ text: "Keep this text" }),
    );
    layer.metadata.update({
      title: "Recovered artwork",
      keywords: ["archive"],
    });
    await editor.recovery.flush();
  });
  await expect(page.locator(".canvas-status")).toContainText(
    "Recovery saved locally",
  );
  await page.reload();
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  const row = page
    .locator(".recovery-row")
    .filter({ hasText: "Recoverable design" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Document name", { exact: true })).toHaveValue(
    "Recoverable design",
  );
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.toJSON().kind,
    ),
  ).toBe("text");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.metadata.title,
    ),
  ).toBe("Recovered artwork");
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layers.at(0)?.metadata.keywords,
    ),
  ).toEqual(["archive"]);
});

test("atomic checkpoint failure retains the previous revision and original image bytes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    await editor.importImage(
      new File([blob], "original.png", { type: "image/png" }),
    );
    await editor.recovery.flush();
    const repo = editor.recovery.repository;
    const entry = (await repo.list())[0];
    const projectPath = "/src/core/project.ts";
    const { readProject } = await import(/* @vite-ignore */ projectPath);
    const before = await readProject(await repo.project(entry.id));
    const snapshot = editor.document.toJSON();
    snapshot.name = "Must not commit";
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = original.apply(this, args);
      if (this.name === "checkpoints") this.transaction.abort();
      return request;
    };
    let rejected = false;
    try {
      await repo.save(entry.id, snapshot, editor.assetStore);
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const after = await readProject(await repo.project(entry.id));
    return {
      rejected,
      name: after.document.name,
      before: before.document.name,
      equal:
        [
          ...new Uint8Array(await after.entries[0].blob.arrayBuffer()),
        ].join() === [...new Uint8Array(await blob.arrayBuffer())].join(),
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.name).toBe(result.before);
  expect(result.equal).toBe(true);
});

test("tabs retain independent recovery checkpoints", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/");
  for (const [tab, name] of [
    [page, "First tab"],
    [second, "Second tab"],
  ] as const) {
    await tab.evaluate(async (name) => {
      window.luma.editor.document.name = name;
      await window.luma.editor.recovery.flush();
    }, name);
  }
  const names = await page.evaluate(async () =>
    (await window.luma.editor.recovery.repository.list()).map(
      (entry) => entry.document.name,
    ),
  );
  expect(names).toContain("First tab");
  expect(names).toContain("Second tab");
  await second.close();
});

test("blocked storage reports failure without stopping editing or project downloads", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    }),
  );
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Still editable" }));
    await editor.recovery.flush();
  });
  await expect(page.locator(".canvas-status")).toContainText(
    "Recovery unavailable",
  );
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.luma$/);
  await context.close();
});

test("recovery skips corrupt checkpoints and retains only the latest three revisions", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const repo = window.luma.editor.recovery.repository;
    const { readProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const doc = window.luma.editor.document.toJSON();
    doc.children = [];
    for (let i = 1; i <= 4; i++) {
      doc.name = `revision-${i}`;
      await repo.save("history-case", doc, window.luma.editor.assetStore);
    }
    const entries = await repo.list();
    const entry = entries.find((e: { id: string }) => e.id === "history-case")!;
    const retained = entry.previous!.map(
      (e: { document: { name: string } }) => e.document.name,
    );
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("luma-recovery");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const corrupt = async (all: boolean) => {
      const tx = db.transaction("checkpoints", "readwrite");
      const store = tx.objectStore("checkpoints");
      const req = store.get("history-case");
      req.onsuccess = () => {
        const value = req.result;
        value.document.name = "corrupt";
        if (all)
          value.previous.forEach((p: { document: { name: string } }) => {
            p.document.name = "corrupt";
          });
        store.put(value);
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    };
    await corrupt(false);
    const restored = await repo.restore("history-case");
    const project = await readProject(restored.blob);
    await corrupt(true);
    let error = "";
    try {
      await repo.restore("history-case");
    } catch (e) {
      error = String(e);
    }
    await repo.remove("history-case");
    db.close();
    return {
      retained,
      name: project.document.name,
      skipped: restored.skipped,
      error,
    };
  });
  expect(result.retained).toEqual(["revision-3", "revision-2"]);
  expect(result.name).toBe("revision-3");
  expect(result.skipped).toBe(1);
  expect(result.error).toContain("No intact recovery checkpoint");
});

test("recovery verifies source checksums and falls back to prior source bytes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createRaster } = await import(
      /* @vite-ignore */ String("/src/core/model.ts")
    );
    const { readProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const repo = window.luma.editor.recovery.repository;
    const doc = window.luma.editor.document.toJSON();
    doc.children = [createRaster("image", "asset", 1, 1)];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    let original!: Blob;
    for (const color of ["#ff0000", "#0000ff"]) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!)),
      );
      if (!original) original = blob;
      doc.name = color;
      await repo.save("source-history", doc, {
        get: () => ({ id: "asset", name: "image", width: 1, height: 1, blob }),
      });
    }
    const entry = (await repo.list()).find(
      (e: { id: string }) => e.id === "source-history",
    )!;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("luma-recovery");
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("assets", "readwrite");
    const store = tx.objectStore("assets");
    const req = store.get(entry.assetKeys[0]);
    req.onsuccess = () => {
      store.put(
        { ...req.result, blob: new Blob(["damaged"]) },
        entry.assetKeys[0],
      );
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    const restored = await repo.restore("source-history");
    const project = await readProject(restored.blob);
    const actual = new Uint8Array(await project.entries[0].blob.arrayBuffer());
    const expected = new Uint8Array(await original.arrayBuffer());
    await repo.remove("source-history");
    const read = db
      .transaction("assets", "readonly")
      .objectStore("assets")
      .getAllKeys();
    const keys = await new Promise<IDBValidKey[]>((resolve) => {
      read.onsuccess = () => resolve(read.result);
    });
    db.close();
    return {
      skipped: restored.skipped,
      name: project.document.name,
      same: actual.every((v, i) => v === expected[i]),
      retainedKeys: keys.filter((key) =>
        String(key).startsWith("source-history:"),
      ).length,
    };
  });
  expect(result.skipped).toBe(1);
  expect(result.name).toBe("#ff0000");
  expect(result.same).toBe(true);
  expect(result.retainedKeys).toBe(0);
});

test("recovery dialog reports when it restores an older intact checkpoint", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    const doc = editor.document.toJSON();
    doc.children = [];
    doc.name = "Intact older work";
    await editor.recovery.repository.save(
      "warning-case",
      doc,
      editor.assetStore,
    );
    doc.name = "Latest work";
    await editor.recovery.repository.save(
      "warning-case",
      doc,
      editor.assetStore,
    );
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("luma-recovery");
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("checkpoints", "readwrite");
    const store = tx.objectStore("checkpoints");
    const req = store.get("warning-case");
    req.onsuccess = () => {
      const entry = req.result;
      entry.document.name = "Damaged newer work";
      store.put(entry);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  await page
    .locator(".recovery-row")
    .filter({ hasText: "Damaged newer work" })
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Recovered the intact checkpoint" }),
  ).toContainText("Skipped 1 damaged checkpoint");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Recovered the intact checkpoint" }),
  ).toContainText("Newer edits may be missing");
  await page.getByRole("button", { name: "Close recovery" }).click();
  await expect(page.getByLabel("Document name", { exact: true })).toHaveValue(
    "Intact older work",
  );
});

test("recovery captures mutable callers and immutable revisions independently of later edits", async ({page}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const {editor:e,TextLayer}=window.luma;
    e.newDocument({width:200,height:100});
    const layer=e.document.layers.add(new TextLayer({text:'Original'}));
    const repository=e.recovery.repository;
    const mutable=e.document.toJSON();
    const first=repository.save('mutable-capture',mutable,e.assetStore);
    mutable.name='Changed caller';
    if(mutable.children[0].kind==='text') mutable.children[0].text='Changed caller';
    const shallow=Object.freeze(e.document.toJSON());
    const third=repository.save('shallow-frozen-capture',shallow,e.assetStore);
    if(shallow.children[0].kind==='text') shallow.children[0].text='Changed nested caller';
    const immutable=e.document.getSnapshot().document;
    const second=repository.save('immutable-capture',immutable,e.assetStore);
    layer.text='Later revision';
    e.document.name='Changed live';
    await Promise.all([first,second,third]);
    const entries=await repository.list();
    return ['mutable-capture','immutable-capture','shallow-frozen-capture'].map(id=>{
      const entry=entries.find(entry=>entry.id===id)!;
      return {name:entry.document.name, layer:entry.document.children[0], originalName:immutable.name};
    });
  });
  for(const entry of result){expect(entry.name).toBe(entry.originalName);expect(entry.layer).toMatchObject({kind:'text',text:'Original'});}
});
