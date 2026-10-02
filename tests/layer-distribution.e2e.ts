import { test, expect } from "@playwright/test";

test("UI and isolated scripts distribute real artwork with undo and portable source pixels", async ({
  page,
}) => {
  await page.goto("/");
  const initial = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const doc = editor.newDocument({ width: 200, height: 100 });
    const colors = ["#ff0000", "#0000ff", "#00ff00"];
    for (let i = 0; i < 3; i++) {
      const canvas = new OffscreenCanvas(20, 20),
        ctx = canvas.getContext("2d")!;
      ctx.fillStyle = colors[i];
      ctx.fillRect(0, 0, 20, 20);
      const asset = await editor.assetStore.add(
        await canvas.convertToBlob({ type: "image/png" }),
        `source-${i}`,
        undefined,
        false,
      );
      doc.layers.add(
        new RasterLayer({
          assetId: asset.id,
          width: 20,
          height: 20,
          x: [0, 40, 150][i],
          y: [0, 20, 80][i],
        }),
      );
    }
    doc.selectLayers([...doc.layers].reverse());
    return {
      history: doc.getSnapshot().past.length,
      blobs: await Promise.all(
        editor.assetStore
          .values()
          .map(async (asset) => [
            ...new Uint8Array(await asset.blob.arrayBuffer()),
          ]),
      ),
    };
  });
  await page
    .getByLabel("Distribute selected layers", { exact: true })
    .selectOption("horizontal:gaps");
  expect(
    await page.evaluate(() =>
      [...window.luma.editor.document.layers].map((layer) => layer.x),
    ),
  ).toEqual([0, 75, 150]);
  expect(
    await page.evaluate(
      () => window.luma.editor.document.getSnapshot().past.length,
    ),
  ).toBe(initial.history + 1);
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.document.undo();
    const undone = [...editor.document.layers].map((layer) => layer.x);
    editor.document.redo();
    await editor.runScript(
      'document.layerSelection.distribute("vertical", "centers");',
    );
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "distributed.luma"));
    const canvas = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const ctx = canvas.getContext("2d")!;
    const pixels = [
      [10, 10],
      [85, 50],
      [160, 90],
    ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    canvas.width = canvas.height = 0;
    return {
      undone,
      pixels,
      blobs: await Promise.all(
        editor.assetStore
          .values()
          .map(async (asset) => [
            ...new Uint8Array(await asset.blob.arrayBuffer()),
          ]),
      ),
    };
  });
  expect(result.undone).toEqual([0, 40, 150]);
  expect(result.pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 255, 0, 255],
  ]);
  expect(result.blobs).toEqual(initial.blobs);
});
