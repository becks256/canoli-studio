import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 20, height: 10 });
    const canvas = new OffscreenCanvas(20, 10),
      context = canvas.getContext("2d")!;
    context.fillStyle = "#646464";
    context.fillRect(0, 0, 10, 10);
    context.fillStyle = "#a0a0a0";
    context.fillRect(10, 0, 10, 10);
    context.fillStyle = "#bebebe";
    context.fillRect(14, 4, 1, 1);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "base.png", {
        type: "image/png",
      }),
    );
  });
}
const repair = `await document.patchRegion(new MarqueeSelection({ shape: 'rectangle', x: 2, y: 2, width: 5, height: 5 }), { x: 10, y: 0 })`;

test("isolated patch sees preceding edits and commits artwork and assets atomically with offline undo", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async (repair) => {
    const editor = window.luma.editor;
    const before = editor.document.toJSON(),
      history = editor.document.getSnapshot().past.length;
    const source = editor.assetStore.values()[0],
      bytes = await source.blob.arrayBuffer();
    await editor.runScript(
      `document.layers.at(0).opacity = 0.5; const patch = ${repair}; patch.name = 'Script repair';`,
    );
    const after = editor.document.toJSON();
    const sample = async () => {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const pixel = [...canvas.getContext("2d")!.getImageData(4, 4, 1, 1).data];
      canvas.width = canvas.height = 0;
      return pixel;
    };
    const pixel = await sample(),
      undoEntries = editor.document.getSnapshot().past.length - history;
    editor.document.undo();
    const undone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    editor.document.redo();
    const redone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(after);
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "script-patch.luma"));
    return {
      pixel,
      restored: await sample(),
      undoEntries,
      undone,
      redone,
      layers: editor.document.layers.length,
      assets: editor.assetStore.values().length,
      sourceUnchanged: new Uint8Array(await source.blob.arrayBuffer()).every(
        (v, i) => v === new Uint8Array(bytes)[i],
      ),
    };
  }, repair);
  expect(result.pixel[0]).toBeGreaterThan(120);
  expect(result.pixel[3]).toBe(128);
  expect(result.restored).toEqual(result.pixel);
  expect(result).toMatchObject({
    undoEntries: 1,
    undone: true,
    redone: true,
    layers: 2,
    assets: 2,
    sourceUnchanged: true,
  });
});

test("script failure after preparation discards private patch assets and all preceding edits", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate(async (repair) => {
    const editor = window.luma.editor,
      before = JSON.stringify(editor.document.toJSON()),
      history = editor.document.getSnapshot().past.length;
    let error = "";
    try {
      await editor.runScript(
        `document.name = 'Temporary'; ${repair}; throw new Error('Intentional rollback');`,
      );
    } catch (e) {
      error = String(e);
    }
    return {
      error,
      unchanged: JSON.stringify(editor.document.toJSON()) === before,
      historyUnchanged: editor.document.getSnapshot().past.length === history,
      assets: editor.assetStore.values().length,
    };
  }, repair);
  expect(result.error).toContain("Intentional rollback");
  expect(result).toMatchObject({
    unchanged: true,
    historyUnchanged: true,
    assets: 1,
  });
});

for (const action of ["cancel", "switch-back", "revoke"])
  test(`script patch rejects ${action} during private decoding`, async ({
    page,
  }) => {
    await setup(page);
    const result = await page.evaluate(
      async ({ repair, action }) => {
        const editor = window.luma.editor,
          target = editor.document,
          assets = editor.assetStore;
        const before = JSON.stringify(target.toJSON()),
          history = target.getSnapshot().past.length;
        if (action === "revoke")
          editor.plugins.install({
            format: "luma-plugin",
            apiVersion: 2,
            id: "patch-probe",
            name: "Patch probe",
            version: "1.0.0",
            permissions: [
              "document:read",
              "document:write",
              "assets:read",
              "assets:write",
            ],
            commands: [{ id: "patch", title: "Patch", source: repair }],
          });
        const original = window.createImageBitmap.bind(window);
        let decoded: ImageBitmap | undefined,
          enter!: () => void,
          release!: () => void;
        const entered = new Promise<void>((resolve) => (enter = resolve)),
          gate = new Promise<void>((resolve) => (release = resolve));
        window.createImageBitmap = (async (...args: any[]) => {
          decoded = await (original as any)(...args);
          enter();
          await gate;
          return decoded;
        }) as typeof createImageBitmap;
        let error = "";
        const pending = (
          action === "revoke"
            ? editor.runPlugin("patch-probe", "patch")
            : editor.runScript(repair)
        ).catch((e) => {
          error = String(e);
        });
        await entered;
        if (action === "cancel") editor.scripts.cancel();
        else if (action === "revoke")
          editor.plugins.revokePermission("patch-probe", "assets:write");
        else {
          editor.newDocument({ width: 2, height: 2 });
          editor.activateDocument(target);
        }
        release();
        await pending;
        window.createImageBitmap = original;
        // Let the cancelled host call observe its abort after decoding.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          error,
          unchanged: JSON.stringify(target.toJSON()) === before,
          historyUnchanged: target.getSnapshot().past.length === history,
          assets: assets.values().length,
          released: decoded?.width === 0,
        };
      },
      { repair, action },
    );
    expect(result.error).toMatch(/stopped|session changed|Permission denied/i);
    expect(result).toMatchObject({
      unchanged: true,
      historyUnchanged: true,
      assets: 1,
      released: true,
    });
  });
