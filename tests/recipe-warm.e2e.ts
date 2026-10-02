import { test, expect } from "@playwright/test";

test("warm preset changes neutral pixels toward red without a fictitious vignette", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer } = window.luma;
    const { PRESET_VIGNETTE_WARM } = await import(
      /* @vite-ignore */ String("/src/ai/recipes/presets.ts")
    );
    const doc = editor.newDocument({ width: 16, height: 16 });
    const c = new OffscreenCanvas(16, 16),
      ctx = c.getContext("2d")!;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await c.convertToBlob({ type: "image/png" }),
      asset = await editor.assetStore.add(blob, "neutral", undefined, false);
    doc.selectedLayer = doc.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 16 }),
    );
    const before = doc.toJSON();
    const execution = editor.recipes.execute(PRESET_VIGNETTE_WARM, {
      exposure: 0,
      contrast: 0,
      saturation: 0,
    });
    if (!execution.success) throw new Error(execution.error);
    const sample = async () => {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const context = surface.getContext("2d")!;
      const pixels = [
        [0, 0],
        [8, 8],
      ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
      surface.width = surface.height = 0;
      return pixels;
    };
    const pixels = await sample();
    doc.undo();
    const undone = JSON.stringify(doc.toJSON()) === JSON.stringify(before);
    doc.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "warm.luma"));
    return { pixels, reopened: await sample(), undone };
  });
  expect(result.pixels[0]).toEqual(result.pixels[1]);
  const [r, g, b, a] = result.pixels[0];
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
  expect(a).toBe(255);
  expect(result.reopened).toEqual(result.pixels);
  expect(result.undone).toBe(true);
});
