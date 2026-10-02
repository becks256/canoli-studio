import { expect, test } from "@playwright/test";

test("edits made while autosave acquires its tab identity are checkpointed after initialization", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { EditorApplication } = await import(
      /* @vite-ignore */ String("/src/editor.ts")
    );
    const editor = new EditorApplication();
    const ready = editor.initializeWorkspaceRecovery();
    editor.document.name = "Edited during initialization";
    await ready;
    await editor.workspaceAutosave.flush();
    const saved = await editor.workspaceAutosave.load();
    const { loadProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const restored = await loadProject(saved!.documents[0].project);
    const name = restored.document.name;
    restored.assets.dispose();
    editor.dispose();
    return name;
  });
  expect(result).toBe("Edited during initialization");
});

test("automatic workspace checkpoints restore edits, tabs and views without replacing manual checkpoints", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Manual checkpoint";
    await editor.saveWorkspace();
    editor.document.name = "Auto A";
    editor.document.layers.add(new TextLayer({ text: "A" }));
    const first = editor.document;
    editor.newDocument({ name: "Auto B" });
    editor.document.layers.add(new TextLayer({ text: "B" }));
    editor.moveDocument(editor.document, 0);
    editor.activateDocument(first);
    editor.workspaceRepository.restoreOnStartup = true;
  });
  await page.keyboard.press("Control+1");
  const box = (await page.locator(".viewport").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 30,
  );
  await page.mouse.up({ button: "middle" });
  const before = await page.evaluate(() => {
    const editor = window.luma.editor;
    return {
      names: editor.openDocuments.map((doc) => doc.name),
      active: editor.document.name,
      view: editor.documentSessions.find(
        (session) => session.document === editor.document,
      )!.view,
    };
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.luma.editor.workspaceAutosave.getSnapshot().status,
      ),
    )
    .toBe("saved");
  await page.reload();
  await expect(page.getByRole("tab", { name: /Auto A/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const after = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const { loadProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const manual = await loadProject(
      (await editor.workspaceRepository.load())!.documents[0].project,
    );
    const manualName = manual.document.name;
    manual.assets.dispose();
    return {
      names: editor.openDocuments.map((doc) => doc.name),
      active: editor.document.name,
      view: editor.documentSessions.find(
        (session) => session.document === editor.document,
      )!.view,
      manualName,
    };
  });
  expect(after).toEqual({ ...before, manualName: "Manual checkpoint" });
});

test("a duplicated browser-tab identity forks its automatic checkpoint while the original is open", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const firstId = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Original tab";
    editor.workspaceRepository.restoreOnStartup = true;
    await editor.workspaceAutosave.flush();
    return sessionStorage.getItem("luma-workspace-tab")!;
  });
  const other = await context.newPage();
  await other.addInitScript((id) => {
    sessionStorage.setItem("luma-workspace-tab", id);
  }, firstId);
  await other.goto("/");
  const secondId = await other.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Second tab";
    await editor.workspaceAutosave.flush();
    return sessionStorage.getItem("luma-workspace-tab");
  });
  expect(secondId).not.toBe(firstId);
  await page.reload();
  await expect(page.getByRole("tab", { name: /Original tab/ })).toBeVisible();
  expect(await other.evaluate(() => window.luma.editor.document.name)).toBe(
    "Second tab",
  );
});

test("aborted automatic writes preserve the previous checkpoint and can be retried", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Before failure";
    await editor.workspaceAutosave.flush();
    const before = await editor.workspaceAutosave.load();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === "workspaces" && String(key).startsWith("automatic:"))
        this.transaction.abort();
      return request;
    };
    editor.document.name = "After failure";
    let error = "";
    try {
      await editor.workspaceAutosave.flush();
    } catch (e) {
      error = String(e);
    }
    IDBObjectStore.prototype.put = put;
    const status = editor.workspaceAutosave.getSnapshot().status;
    const retained = await editor.workspaceAutosave.load();
    const a = new Uint8Array(await before!.documents[0].project.arrayBuffer());
    const b = new Uint8Array(
      await retained!.documents[0].project.arrayBuffer(),
    );
    await editor.workspaceAutosave.flush();
    const { loadProject } = await import(
      /* @vite-ignore */ String("/src/core/project.ts")
    );
    const loaded = await loadProject(
      (await editor.workspaceAutosave.load())!.documents[0].project,
    );
    const name = loaded.document.name;
    loaded.assets.dispose();
    return {
      error,
      status,
      retained: a.length === b.length && a.every((v, i) => v === b[i]),
      name,
      finalStatus: editor.workspaceAutosave.getSnapshot().status,
    };
  });
  expect(result.error).toBeTruthy();
  expect(result).toMatchObject({
    status: "error",
    retained: true,
    name: "After failure",
    finalStatus: "saved",
  });
});
