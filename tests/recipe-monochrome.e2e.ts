import { test, expect } from "@playwright/test";

test("monochrome preset produces grayscale pixels and survives project reopening without changing source", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const { PRESET_HIGH_CONTRAST_BW } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/presets.ts")
    );
    const doc = editor.newDocument({ width: 16, height: 8 });
    const canvas = new OffscreenCanvas(16, 8),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#b04020";
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillStyle = "#2060b0";
    ctx.fillRect(8, 0, 8, 8);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const asset = await editor.assetStore.add(
      blob,
      "colored",
      undefined,
      false,
    );
    doc.selectedLayer = doc.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 8 }),
    );
    const source = [...new Uint8Array(await blob.arrayBuffer())];
    const pixels = async () => {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const data = [
        ...surface.getContext("2d")!.getImageData(0, 0, 16, 8).data,
      ];
      surface.width = surface.height = 0;
      return data;
    };
    const original = await pixels();
    const history = doc.getSnapshot().past.length;
    const execution = editor.recipes.execute(PRESET_HIGH_CONTRAST_BW);
    if (!execution.success) throw new Error(execution.error);
    const gray = await pixels(),
      delta = doc.getSnapshot().past.length - history;
    doc.undo();
    const undone = await pixels();
    doc.redo();
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "monochrome.luma"));
    return {
      source,
      retained: [
        ...new Uint8Array(
          await editor.assetStore.values()[0].blob.arrayBuffer(),
        ),
      ],
      original,
      gray,
      undone,
      reopened: await pixels(),
      delta,
    };
  });
  expect(result.delta).toBe(1);
  expect(result.undone).toEqual(result.original);
  expect(result.gray).not.toEqual(result.original);
  expect(result.reopened).toEqual(result.gray);
  expect(result.retained).toEqual(result.source);
  for (let i = 0; i < result.gray.length; i += 4) {
    expect(result.gray[i]).toBe(result.gray[i + 1]);
    expect(result.gray[i]).toBe(result.gray[i + 2]);
    expect(result.gray[i + 3]).toBe(result.original[i + 3]);
  }
});
