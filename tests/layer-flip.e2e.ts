import { test, expect } from "@playwright/test";

test("flips asymmetric pixels through UI and scripts with undo and project portability", async ({
  page,
}) => {
  await page.goto("/");
  const initial = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const doc = editor.newDocument({ width: 16, height: 12 });
    const canvas = new OffscreenCanvas(8, 4),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 4, 2);
    ctx.fillStyle = "#0000ff";
    ctx.fillRect(4, 0, 4, 2);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(0, 2, 4, 2);
    const asset = await editor.assetStore.add(
      await canvas.convertToBlob({ type: "image/png" }),
      "asymmetric",
      undefined,
      false,
    );
    const layer = doc.layers.add(
      new RasterLayer({ assetId: asset.id, width: 8, height: 4, x: 4, y: 4 }),
    );
    doc.selectLayers([layer]);
    const rendered = await editor.renderer.render(
      doc.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const pixels = [
      ...rendered.getContext("2d")!.getImageData(0, 0, 16, 12).data,
    ];
    rendered.width = rendered.height = 0;
    return {
      pixels,
      source: [...new Uint8Array(await asset.blob.arrayBuffer())],
      history: doc.getSnapshot().past.length,
    };
  });
  await expect(
    page.getByLabel("Flip selected layers", { exact: true }),
  ).toHaveCount(1);
  await page
    .getByLabel("Flip selected layers", { exact: true })
    .selectOption("horizontal");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    const pixels = async () => {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const data = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 16, 12).data,
      ];
      canvas.width = canvas.height = 0;
      return data;
    };
    const horizontal = await pixels(),
      history = editor.document.getSnapshot().past.length;
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    await editor.runScript('document.layerSelection.flip("vertical");');
    const both = await pixels();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "flipped.luma"));
    return {
      horizontal,
      history,
      undone,
      both,
      reopened: await pixels(),
      source: [
        ...new Uint8Array(
          await editor.assetStore.values()[0].blob.arrayBuffer(),
        ),
      ],
    };
  });
  const reflect = (horizontal: boolean, vertical: boolean) => {
    const expected = [...initial.pixels];
    for (let y = 4; y < 8; y++)
      for (let x = 4; x < 12; x++) {
        const sx = horizontal ? 15 - x : x,
          sy = vertical ? 11 - y : y;
        for (let c = 0; c < 4; c++)
          expected[(y * 16 + x) * 4 + c] =
            initial.pixels[(sy * 16 + sx) * 4 + c];
      }
    return expected;
  };
  expect(result.history).toBe(initial.history + 1);
  expect(result.horizontal).toEqual(reflect(true, false));
  expect(result.undone).toEqual(initial.pixels);
  expect(result.both).toEqual(reflect(true, true));
  expect(result.reopened).toEqual(result.both);
  expect(result.source).toEqual(initial.source);
});
