import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("float text cells retain owned pixels across wrapper edits and reject mutated private fonts", async ({
  page,
}, info) => {
  const bytes = [
    ...(await readFile("tests/fixtures/shaping-font/Shaping.ttf")),
  ];
  await page.goto("/");
  const result = await page.evaluate(async (bytes) => {
    const { FloatTextCache } = (await import(
      /* @vite-ignore */ String("/src/engine/float-text.ts")
    )) as typeof import("../src/engine/float-text");
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { AffineTransform } = (await import(
      /* @vite-ignore */ String("/src/core/affine.ts")
    )) as typeof import("../src/core/affine");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ width: 128, height: 96, assets });
    doc.convertToFloat();
    const file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
      layer = doc.layers.add(
        new window.luma.TextLayer({
          text: "A",
          fontFamily: file.family,
          fontSize: 40,
          x: 16,
          y: 10,
          color: "color(srgb-linear 4 -.25 1.5 / .5)",
        }),
      ),
      processor = window.luma.editor.renderer.processor;
    let calls = 0;
    const cache = new FloatTextCache({
        floatComposite: async (...args) => {
          calls++;
          return processor.floatComposite(...args);
        },
      }),
      pose = AffineTransform.translation(16, 10),
      area = { x: 0, y: 0, width: 128, height: 96 };
    let first: Awaited<ReturnType<typeof cache.capture>> | undefined,
      second: typeof first;
    try {
      const input = doc._read();
      first = await cache.capture(
        input,
        input.children[0] as never,
        assets,
        pose,
      );
      const expected = await first.read(area),
        count = calls,
        copy = await first.read(area);
      copy.fill(99);
      layer.opacity = 0.37;
      const changed = doc._read();
      second = await cache.capture(
        changed,
        changed.children[0] as never,
        assets,
        pose,
      );
      const pixels = await second.read(area),
        same = new Uint32Array(expected.buffer).every(
          (n, i) => n === new Uint32Array(pixels.buffer)[i],
        );
      const warm = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await second.read({ x: 0, y: 0, width: 64, height: 48 });
        warm.push(performance.now() - start);
      }
      const face = [...document.fonts].find((face) =>
        face.family.startsWith("CanoliGlyph_"),
      )!;
      const weight = face.weight;
      let rejected = "";
      face.weight = "700";
      try {
        await second.read(area);
      } catch (error) {
        rejected = String(error);
      } finally {
        face.weight = weight;
      }
      const restored = await second.read(area);
      return {
        calls,
        count,
        reused: first.source === second.source,
        same,
        restored: new Uint32Array(expected.buffer).every(
          (n, i) => n === new Uint32Array(restored.buffer)[i],
        ),
        rejected,
        ink: expected.filter((v, i) => i % 4 === 3 && v > 0).length,
        warm,
      };
    } finally {
      first?.dispose();
      second?.dispose();
      cache.dispose();
      assets.dispose();
    }
  }, bytes);
  await writeFile(
    info.outputPath("float-text-cache.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    calls: 1,
    count: 1,
    reused: true,
    same: true,
    restored: true,
  });
  expect(result.ink).toBeGreaterThan(0);
  expect(result.rejected).toMatch(/registration changed/);
});

for (const action of ["cancel-view", "clear-owner"] as const)
  test(`float text pending cells handle ${action} without stale pixels or lost owner`, async ({
    page,
  }, info) => {
    const bytes = [
      ...(await readFile("tests/fixtures/shaping-font/Shaping.ttf")),
    ];
    await page.goto("/");
    const result = await page.evaluate(
      async ({ bytes, action }) => {
        const { FloatTextCache } = (await import(
          /* @vite-ignore */ String("/src/engine/float-text.ts")
        )) as typeof import("../src/engine/float-text");
        const { AssetStore } = (await import(
          /* @vite-ignore */ String("/src/core/assets.ts")
        )) as typeof import("../src/core/assets");
        const { AffineTransform } = (await import(
          /* @vite-ignore */ String("/src/core/affine.ts")
        )) as typeof import("../src/core/affine");
        const baseline = [...document.fonts].filter((f) =>
            f.family.startsWith("CanoliGlyph_"),
          ).length,
          assets = new AssetStore(),
          doc = new window.luma.Document({ width: 128, height: 96, assets });
        doc.convertToFloat();
        const file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)]));
        doc.layers.add(
          new window.luma.TextLayer({
            text: "A",
            fontFamily: file.family,
            fontSize: 40,
            x: 16,
            y: 10,
          }),
        );
        const processor = window.luma.editor.renderer.processor;
        let calls = 0,
          unblock!: () => void,
          started!: () => void;
        const gate = new Promise<void>((resolve) => {
            unblock = resolve;
          }),
          entered = new Promise<void>((resolve) => {
            started = resolve;
          }),
          cache = new FloatTextCache({
            floatComposite: async (...args) => {
              calls++;
              started();
              await gate;
              return processor.floatComposite(...args);
            },
          }),
          abort = new AbortController(),
          input = doc._read(),
          pose = AffineTransform.translation(16, 10),
          area = { x: 0, y: 0, width: 128, height: 96 };
        let first: Awaited<ReturnType<typeof cache.capture>> | undefined,
          second: typeof first;
        try {
          first = await cache.capture(
            input,
            input.children[0] as never,
            assets,
            pose,
            { signal: abort.signal },
          );
          const pending = first.read(area).then(
            () => "",
            (error) => String(error),
          );
          await entered;
          if (action === "cancel-view")
            abort.abort(new Error("Retired viewport"));
          else cache.clear();
          const error = await pending;
          unblock();
          first.dispose();
          second = await cache.capture(
            input,
            input.children[0] as never,
            assets,
            pose,
          );
          const pixels = await second.read(area),
            ink = pixels.filter((v, i) => i % 4 === 3 && v > 0).length;
          second.dispose();
          cache.dispose();
          return {
            error,
            calls,
            ink,
            privateFaces:
              [...document.fonts].filter((f) =>
                f.family.startsWith("CanoliGlyph_"),
              ).length - baseline,
          };
        } finally {
          unblock();
          first?.dispose();
          second?.dispose();
          cache.dispose();
          assets.dispose();
        }
      },
      { bytes, action },
    );
    await writeFile(
      info.outputPath(action + ".json"),
      JSON.stringify(result, null, 2),
    );
    expect(result.error).toMatch(
      action === "cancel-view" ? /Retired viewport/ : /closed|retired/i,
    );
    expect(result).toMatchObject({
      calls: action === "cancel-view" ? 1 : 2,
      privateFaces: 0,
    });
    expect(result.ink).toBeGreaterThan(0);
  });
