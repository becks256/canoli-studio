import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("float document shared TextLayer reaches native linear scene pixels and exact window partitions", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))];
  await page.goto("/");
  const result = await page.evaluate(async (font) => {
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { FloatSceneRenderer } = (await import(
      /* @vite-ignore */ String("/src/engine/float-scene.ts")
    )) as typeof import("../src/engine/float-scene");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ width: 128, height: 96, assets });
    doc.convertToFloat();
    const file = await doc.fonts.embed(new Blob([new Uint8Array(font)])),
      layer = new window.luma.TextLayer({
        text: "A",
        fontFamily: file.family,
        fontSize: 40,
        color: "color(srgb-linear 4 -.25 1.5 / .5)",
        x: 16,
        y: 10,
      });
    doc.layers.add(layer);
    const input = doc._read(),
      before = JSON.stringify(doc.toJSON()),
      renderer = new FloatSceneRenderer(window.luma.editor.renderer.processor),
      scene = await renderer.capture(input, assets, async () => {
        throw new Error("Unexpected mask request");
      });
    try {
      const full = await scene.read({ x: 0, y: 0, width: 128, height: 96 }),
        parts = new Float32Array(full.length);
      let ink = 0,
        interior: number[] | undefined;
      for (let i = 0; i < full.length; i += 4) {
        if (full[i + 3] > 0) ink++;
        if (full[i + 3] === 0.5) interior = [...full.slice(i, i + 4)];
      }
      for (let y = 0; y < 96; y += 19) {
        const height = Math.min(19, 96 - y),
          part = await scene.read({ x: 0, y, width: 128, height });
        parts.set(part, y * 128 * 4);
      }
      const cache = (
          renderer as unknown as { text: { entries: Set<{ source: unknown }> } }
        ).text,
        source = [...cache.entries][0].source;
      scene.dispose();
      const again = await renderer.capture(input, assets, async () => {
        throw new Error("Unexpected mask");
      });
      try {
        const pixels = await again.read({ x: 0, y: 0, width: 128, height: 96 });
        return {
          ink,
          interior,
          partitions: new Uint32Array(full.buffer).every(
            (n, i) => n === new Uint32Array(parts.buffer)[i],
          ),
          sameAfterRecapture: new Uint32Array(full.buffer).every(
            (n, i) => n === new Uint32Array(pixels.buffer)[i],
          ),
          reused: source === [...cache.entries][0].source,
          unchanged: JSON.stringify(doc.toJSON()) === before,
        };
      } finally {
        again.dispose();
      }
    } finally {
      scene.dispose();
      renderer.dispose();
      assets.dispose();
    }
  }, font);
  await writeFile(
    info.outputPath("float-text-connection.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result.ink).toBeGreaterThan(0);
  expect(result).toMatchObject({
    interior: [4, -0.25, 1.5, 0.5],
    partitions: true,
    sameAfterRecapture: true,
    reused: true,
    unchanged: true,
  });
});
