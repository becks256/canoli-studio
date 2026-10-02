import { test, expect } from "@playwright/test";

test("product shadow is a black silhouette with transparent holes and an unchanged subject", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const { PRESET_PRODUCT_DROP_SHADOW } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/presets.ts")
    );
    const doc = editor.newDocument({ width: 24, height: 16 });
    const canvas = new OffscreenCanvas(6, 6),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 6, 6);
    ctx.clearRect(2, 2, 2, 2);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const asset = await editor.assetStore.add(
      blob,
      "subject",
      undefined,
      false,
    );
    const subject = doc.layers.add(
      new RasterLayer({ assetId: asset.id, width: 6, height: 6, x: 2, y: 2 }),
    );
    doc.selectedLayer = subject;
    const original = subject.toJSON(),
      before = doc.toJSON();
    const execution = editor.recipes.execute(PRESET_PRODUCT_DROP_SHADOW, {
      shadowOpacity: 0.4,
      offsetX: 10,
      offsetY: 0,
    });
    if (!execution.success) throw new Error(execution.error);
    const sample = async () => {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const c = surface.getContext("2d")!;
      const pixels = [
        [2, 2],
        [12, 2],
        [14, 4],
        [20, 10],
      ].map(([x, y]) => [...c.getImageData(x, y, 1, 1).data]);
      surface.width = surface.height = 0;
      return pixels;
    };
    const pixels = await sample(),
      unchanged = JSON.stringify(subject.toJSON()) === JSON.stringify(original);
    doc.undo();
    const undone = JSON.stringify(doc.toJSON()) === JSON.stringify(before);
    doc.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "shadow.luma"));
    return {
      pixels,
      reopened: await sample(),
      unchanged,
      undone,
      assets: editor.assetStore.values().length,
    };
  });
  expect(result.pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 0, 102],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  expect(result.reopened).toEqual(result.pixels);
  expect(result.unchanged).toBe(true);
  expect(result.undone).toBe(true);
  expect(result.assets).toBe(1);
});
