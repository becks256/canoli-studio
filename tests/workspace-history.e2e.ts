import { expect, test } from "@playwright/test";

test("reload restores independent undo/redo histories and pixels referenced only by history", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const { editor } = window.luma;
    await editor.initializeWorkspaceRecovery();
    editor.newDocument({ name: "Undo image", width: 8, height: 8 });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#d02040";
    context.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const image = await editor.importImage(
      new File([blob], "Undo image.png", { type: "image/png" }),
    );
    image.remove();
    const undo = editor.document;
    editor.newDocument({ name: "Redo image", width: 8, height: 8 });
    await editor.workspaceAutosave.flush(); // Cache the empty snapshot before adding a redo-only source.
    await editor.importImage(
      new File([blob], "Redo image.png", { type: "image/png" }),
    );
    editor.document.undo();
    const redo = editor.document;
    editor.activateDocument(undo);
    editor.workspaceRepository.restoreOnStartup = true;
    await editor.workspaceAutosave.flush();
    return [undo, redo].map((doc) => ({
      name: doc.name,
      past: doc.getSnapshot().past.map((e) => e.label),
      future: doc.getSnapshot().future.map((e) => e.label),
    }));
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: /Undo image/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const after = await page.evaluate(async () => {
    const { editor } = window.luma;
    const result = [];
    for (const name of ["Undo image", "Redo image"]) {
      const doc = editor.openDocuments.find((item) => item.name === name)!;
      editor.activateDocument(doc);
      const history = {
        name,
        past: doc.getSnapshot().past.map((e) => e.label),
        future: doc.getSnapshot().future.map((e) => e.label),
      };
      const empty = doc.layers.length;
      if (name === "Undo image") doc.undo();
      else doc.redo();
      const rendered = await editor.renderer.render(
        doc.toJSON(),
        editor.assetStore,
        { cache: false, readback: true, maxPixels: 64, maxDimension: 8 },
      );
      const pixel = Array.from(
        rendered.getContext("2d")!.getImageData(4, 4, 1, 1).data,
      );
      rendered.width = rendered.height = 0;
      if (name === "Undo image") doc.redo();
      else doc.undo();
      doc.name = `${name} branched`;
      const future = doc.getSnapshot().future.length;
      result.push({ history, empty, pixel, future });
    }
    return result;
  });
  expect(after.map((item) => item.history)).toEqual(before);
  for (const item of after) {
    expect(item.empty).toBe(0);
    expect(item.pixel).toEqual([208, 32, 64, 255]);
    expect(item.future).toBe(0);
  }
});

test("invalid history in a later saved document rejects restoration without installing earlier documents", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.document.name = "First";
    editor.newDocument({ name: "Second" });
    editor.document.name = "Second edited";
    await editor.saveWorkspace();
    const saved = (await editor.workspaceRepository.load())!;
    const file = saved.documents[1].project;
    const header = new Uint8Array(await file.slice(0, 48).arrayBuffer());
    const length = Number(new DataView(header.buffer).getBigUint64(8, true));
    const manifest = JSON.parse(await file.slice(48, 48 + length).text());
    manifest.history.past[0].document.id = "wrong-document";
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    new DataView(header.buffer).setBigUint64(8, BigInt(bytes.length), true);
    header.set(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      16,
    );
    saved.documents[1].project = new Blob([
      header,
      bytes,
      file.slice(48 + length),
    ]);
    await editor.workspaceRepository.save(saved);
    const before = editor.openDocuments.map((doc) => doc.toJSON());
    const active = editor.document;
    let error = "";
    try {
      await editor.restoreWorkspace();
    } catch (failure) {
      error = String(failure);
    }
    return {
      error,
      unchanged:
        JSON.stringify(before) ===
        JSON.stringify(editor.openDocuments.map((doc) => doc.toJSON())),
      sameActive: editor.document === active,
    };
  });
  expect(result.error).toContain("another document");
  expect(result.unchanged).toBe(true);
  expect(result.sameActive).toBe(true);
});
