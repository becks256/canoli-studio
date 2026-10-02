import { expect, test } from "@playwright/test";

test("recovery discovers an automatic workspace after tab identity loss and opens a copy", async ({
  page,
}) => {
  await page.goto("/");
  const oldId = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Lost tab artwork";
    editor.document.layers.add(new TextLayer({ text: "Recovered text" }));
    await editor.workspaceAutosave.flush();
    const id = sessionStorage.getItem("luma-workspace-tab");
    sessionStorage.removeItem("luma-workspace-tab");
    return id;
  });
  await page.reload();
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Current work";
    editor.document.layers.add(new TextLayer({ text: "Keep me" }));
  });
  expect(
    await page.evaluate(() => sessionStorage.getItem("luma-workspace-tab")),
  ).not.toBe(oldId);
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  const row = page.getByRole("group", {
    name: "Automatic workspace Lost tab artwork",
    exact: true,
  });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Open workspace copy" }).click();
  await expect(
    page.getByRole("tab", { name: /Lost tab artwork/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /Current work/ })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.luma.editor.document.layers.at(0)!.toJSON(),
    ),
  ).toMatchObject({ text: "Recovered text" });
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  await row
    .getByRole("button", { name: "Remove checkpoint", exact: true })
    .click();
  await row
    .getByRole("button", { name: "Confirm remove checkpoint", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.luma.editor.openDocuments.map((doc) => doc.name),
    ),
  ).toEqual(["Current work", "Lost tab artwork"]);
});

test("automatic cleanup rejects a live writer and leaves manual checkpoints intact", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const id = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Live writer";
    await editor.workspaceAutosave.flush();
    await editor.saveWorkspace();
    return sessionStorage.getItem("luma-workspace-tab")!;
  });
  const other = await context.newPage();
  await other.goto("/");
  const live = await other.evaluate(async (id) => {
    const repository = window.luma.editor.workspaceRepository;
    let error = "";
    try {
      await repository.removeAutomatic(id);
    } catch (e) {
      error = String(e);
    }
    return { error, present: !!(await repository.loadAutomatic(id)) };
  }, id);
  expect(live.error).toContain("active in a browser tab");
  expect(live.present).toBe(true);
  await page.close();
  await expect
    .poll(() =>
      other.evaluate(
        async (id) =>
          (await navigator.locks.query()).held?.some(
            (lock) => lock.name === `luma-workspace:${id}`,
          ) ?? false,
        id,
      ),
    )
    .toBe(false);
  const removed = await other.evaluate(async (id) => {
    const repository = window.luma.editor.workspaceRepository;
    await repository.removeAutomatic(id);
    return {
      automatic: await repository.loadAutomatic(id),
      manual: !!(await repository.load()),
    };
  }, id);
  expect(removed).toEqual({ automatic: null, manual: true });
});

test("damaged automatic metadata stays discoverable without hiding healthy workspaces", async ({
  page,
}) => {
  await page.goto("/");
  const id = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.initializeWorkspaceRecovery();
    editor.document.name = "Healthy workspace";
    await editor.workspaceAutosave.flush();
    const id = crypto.randomUUID();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("luma-workspaces", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put({ damaged: true }, `automatic:${id}`);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    db.close();
    return id;
  });
  await page.getByRole("button", { name: "Recover work", exact: true }).click();
  await expect(
    page.getByRole("group", {
      name: "Automatic workspace Healthy workspace",
      exact: true,
    }),
  ).toBeVisible();
  const row = page.getByRole("group", {
    name: "Automatic workspace Unreadable checkpoint",
    exact: true,
  });
  await expect(
    row.getByRole("button", { name: "Open workspace copy" }),
  ).toBeDisabled();
  await row
    .getByRole("button", { name: "Remove checkpoint", exact: true })
    .click();
  await row
    .getByRole("button", { name: "Confirm remove checkpoint", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(
    await page.evaluate(
      async (id) => window.luma.editor.workspaceRepository.loadAutomatic(id),
      id,
    ),
  ).toBeNull();
});
