import { test, expect } from "@playwright/test";

test("compact text retention preserves ink overhangs, alignment and transformed pixels", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { Document, TextLayer, AffineTransform, LayerStyle, LayerMask, editor } = window.luma;
    const { CanvasRenderer } = await import(/* @vite-ignore */ String("/src/engine/renderer.ts"));
    await document.fonts.ready;
    const renderer = new CanvasRenderer();
    const differences: number[] = [], retained: { effect: string; bytes: number }[] = [];
    try {
      for (const effect of ["plain", "overlay", "shadow", "masked-shadow"] as const) for (const align of ["left", "center", "right"] as const) {
        for (const direction of ["ltr", "rtl"] as const) {
          renderer.clearCache();
          const doc = new Document({ width: 500, height: 300 });
          const layer = doc.layers.add(new TextLayer({
            text: "  fj Ág j\u0301\nمرحبا שלום 🙂", fontFamily: "serif",
            fontSize: 27, fontStyle: "italic", fontWeight: "bold",
            lineHeight: 1.4, letterSpacing: -0.6, align, direction,
            x: 130, y: 70, opacity: 0.63, color: "#e7814b",
          }));
          layer.transform = new AffineTransform(0.91, 0.22, -0.15, 1.07, 0.3, -0.4);
          const read = async (cache: boolean) => {
            const canvas = await renderer.render(doc.getSnapshot().document, editor.assetStore, { cache });
            try { return canvas.getContext("2d")!.getImageData(0, 0, 500, 300).data; }
            finally { canvas.width = canvas.height = 0; }
          };
          // Warm raw coverage before changing style, also exercising retained
          // bounds when the effect can reuse an existing raw text surface.
          await read(true);
          if (effect !== "plain") {
            layer.styles = new LayerStyle({
              colorOverlay: { enabled: true, color: "#3355e0", opacity: 0.4 },
              dropShadow: { enabled: effect !== "overlay", color: "#443366",
                opacity: 0.65, blur: 4.7, x: -12.25, y: 17.75 },
            });
            if (effect === "masked-shadow") {
              layer.mask = new LayerMask({ base: 0.7 });
              layer.fillOpacity = 0.45;
            }
            await read(true);
          }
          retained.push({ effect, bytes: renderer.cache.byteLength });
          const cached = await read(true), fresh = await read(false);
          expectInk(cached);
          let max = 0;
          for (let i = 0; i < cached.length; i++) max = Math.max(max, Math.abs(cached[i] - fresh[i]));
          differences.push(max);
        }
      }
      return { differences, retained };
    } finally { renderer.dispose(); }
    function expectInk(pixels: Uint8ClampedArray) {
      if (!pixels.some((value, i) => i % 4 === 3 && value > 0)) throw Error("Expected visible text ink");
    }
  });
  expect(result.differences).toEqual(Array(24).fill(0));
  for (const { effect, bytes } of result.retained) {
    expect(bytes).toBeGreaterThan(0);
    // Shadow fixtures retain the earlier unpadded raw entry too; masks
    // additionally retain their independent full-size coverage surface.
    expect(bytes).toBeLessThan(500 * 300 * 4 *
      (effect === "plain" ? 0.5 : effect === "masked-shadow" ? 2 : 1));
  }
});
