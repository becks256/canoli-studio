import { expect, test } from "@playwright/test";

test("script healing uses document coordinates and shares one atomic commit with a subsequent patch", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 64, height: 48 });
    const canvas = new OffscreenCanvas(32, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#646464";
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = "#ff0000";
    c.fillRect(15, 15, 3, 3);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "blemish.png", {
        type: "image/png",
      }),
    );
    const before = editor.document.toJSON(),
      history = editor.document.getSnapshot().past.length;
    const source = editor.assetStore.values()[0],
      original = new Uint8Array(await source.blob.arrayBuffer());
    await editor.runScript(`
      document.activeLayer.x = 8; document.activeLayer.y = 4;
      const healed = await document.activeLayer.healSpot({ x: 24, y: 20 }, 4, { hardness: 1 });
      healed.name = 'Spot repair';
      await document.patchRegion(new MarqueeSelection({ shape: 'rectangle', x: 22, y: 18, width: 5, height: 5 }), { x: 0, y: 0 });
    `);
    const after = editor.document.toJSON(),
      count = editor.document.getSnapshot().past.length - history;
    const sample = async () => {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const pixel = [
        ...surface.getContext("2d")!.getImageData(24, 20, 1, 1).data,
      ];
      surface.width = surface.height = 0;
      return pixel;
    };
    const healed = await sample();
    editor.document.undo();
    const undone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    editor.document.redo();
    const redone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(after);
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "healed.luma"));
    return {
      healed,
      restored: await sample(),
      count,
      undone,
      redone,
      layers: editor.document.layers.length,
      assets: editor.assetStore.values().length,
      unchangedSource: new Uint8Array(await source.blob.arrayBuffer()).every(
        (v, i) => v === original[i],
      ),
    };
  });
  expect(result.healed).toEqual([100, 100, 100, 255]);
  expect(result.restored).toEqual(result.healed);
  expect(result).toMatchObject({
    count: 1,
    undone: true,
    redone: true,
    layers: 3,
    assets: 3,
    unchangedSource: true,
  });
});

test("healing failure and post-healing script failure leave no committed edits or assets", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 32, height: 32 });
    const canvas = new OffscreenCanvas(32, 32),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#646464";
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = "#ff0000";
    c.fillRect(15, 15, 3, 3);
    await editor.importImage(
      new File([await canvas.convertToBlob()], "blemish.png", {
        type: "image/png",
      }),
    );
    const before = JSON.stringify(editor.document.toJSON()),
      history = editor.document.getSnapshot().past.length;
    const errors: string[] = [];
    for (const source of [
      `await document.activeLayer.healSpot({ x: 16, y: 16 }, 4, { hardness: 1 }); throw new Error('Rollback healed result');`,
      `await document.activeLayer.healSpot({ x: 16, y: 16 }, 100, { hardness: 1 });`,
      `await document.activeLayer.healSpot({ x: 16, y: 16 }, 4, { sampling: 'invalid' });`,
    ]) {
      try {
        await editor.runScript(source);
      } catch (e) {
        errors.push(String(e));
      }
      if (
        JSON.stringify(editor.document.toJSON()) !== before ||
        editor.assetStore.values().length !== 1
      )
        throw new Error("Repair leaked");
    }
    return {
      errors,
      unchanged: JSON.stringify(editor.document.toJSON()) === before,
      historyUnchanged: editor.document.getSnapshot().past.length === history,
      assets: editor.assetStore.values().length,
    };
  });
  expect(result.errors).toHaveLength(3);
  expect(result.errors[0]).toContain("Rollback healed result");
  expect(result).toMatchObject({
    unchanged: true,
    historyUnchanged: true,
    assets: 1,
  });
});
