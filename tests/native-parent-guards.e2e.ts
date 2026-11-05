import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
for (const mode of [
  "abort",
  "release",
  "remove",
  "nonfinite",
  "partial",
] as const)
  test(
    "native parent " +
      mode +
      " withholds unfinished fields and permits a healthy original-source retry",
    async ({ page }, info) => {
      const sources = await Promise.all(
        ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
          async (file) => [...(await readFile("tests/fixtures/" + file))],
        ),
      );
      await page.goto("/");
      const result = await page.evaluate(
        async ({ sources, mode }) => {
          const { AssetStore } = (await import(
            /* @vite-ignore */ String("/src/core/assets.ts")
          )) as typeof import("../src/core/assets");
          const { Document } = (await import(
            /* @vite-ignore */ String("/src/dom/index.ts")
          )) as typeof import("../src/dom");
          const { captureStyledTextPlan } = (await import(
            /* @vite-ignore */ String("/src/engine/styled-text.ts")
          )) as typeof import("../src/engine/styled-text");
          const { captureNativeSvgGlyphSource } = (await import(
            /* @vite-ignore */ String("/src/engine/native-svg-source.ts")
          )) as typeof import("../src/engine/native-svg-source");
          const { prepareNativeSvgParent } = (await import(
            /* @vite-ignore */ String("/src/engine/native-svg-parent.ts")
          )) as typeof import("../src/engine/native-svg-parent");
          const assets = new AssetStore(),
            doc = new Document({ assets }),
            files: Awaited<ReturnType<typeof doc.fonts.embed>>[] = [];
          for (const bytes of sources)
            files.push(
              await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
            );
          const before = JSON.stringify(doc.toJSON()),
            input = {
              width: 512,
              height: 512,
              style: {
                fontFamily: files.map((f) => f.family).join(", "),
                fontSize: 40,
              },
              lines: [
                {
                  x: 220,
                  y: 160,
                  direction: "ltr" as const,
                  align: "center" as const,
                  spans: [
                    { text: "AV a", style: { color: "#f00" } },
                    { text: "\u0301 fi", style: { color: "#0f0" } },
                  ],
                },
              ],
            };
          let error: string | undefined,
            withheld = false,
            touched = false,
            healthy = false;
          try {
            const plan = await captureStyledTextPlan(
                input,
                doc.toJSON(),
                assets,
                { captureLinearPaint: true },
              ),
              controller = new AbortController();
            try {
              plan.retireMeasurement();
              const source = captureNativeSvgGlyphSource(
                  plan,
                  0,
                  0,
                  plan.scene.lines[0].spans.length,
                ),
                primary = await plan.captureGlyphFont(files[0].id),
                secondary = await plan.captureGlyphFont(files[1].id);
              const broken = {
                ...primary,
                async shapeRun(...args: Parameters<typeof primary.shapeRun>) {
                  const run = await primary.shapeRun(...args);
                  if (!touched) {
                    touched = true;
                    if (mode === "abort") controller.abort();
                    if (mode === "release") plan.release();
                    if (mode === "remove") {
                      const face = [...document.fonts].find(
                        (f) =>
                          f.family.replaceAll('"', "").replaceAll("'", "") ===
                          primary.family,
                      );
                      if (!face)
                        throw Error("The real glyph face was not registered");
                      document.fonts.delete(face);
                    }
                    if (mode === "nonfinite")
                      return {
                        ...run,
                        glyphs: run.glyphs.map((g, i) =>
                          i ? g : { ...g, xOffset: Infinity },
                        ),
                      };
                    if (mode === "partial") return { ...run, glyphs: [] };
                  }
                  return run;
                },
              };
              const slots = [
                { font: broken, start: 0, end: 3 },
                { font: secondary, start: 3, end: 5 },
                { font: primary, start: 5, end: 8 },
              ].map((s) => ({
                font: s.font,
                source: {
                  ...source,
                  start: s.start,
                  end: s.end,
                  style: { ...source.style, fontFamily: s.font.sourceFamily },
                  items: [
                    {
                      start: s.start,
                      end: s.end,
                      script: "Latn",
                      direction: "ltr" as const,
                    },
                  ],
                },
              }));
              try {
                const prepared = await prepareNativeSvgParent(plan, 0, slots, {
                  signal: controller.signal,
                });
                withheld = prepared === undefined;
              } catch (value) {
                error = String(value);
              }
            } finally {
              plan.release();
            }
            const retry = await captureStyledTextPlan(
              input,
              doc.toJSON(),
              assets,
              { captureLinearPaint: true },
            );
            try {
              retry.retireMeasurement();
              const match = await retry.matchStyledGlyphLine(0);
              healthy =
                match.status === "matched" &&
                match.evidence.svgMaxAlphaError === 0 &&
                match.evidence.paintOwnership?.error === 0;
            } finally {
              retry.release();
            }
          } finally {
            assets.dispose();
          }
          return {
            mode,
            touched,
            error,
            withheld,
            healthy,
            unchanged: JSON.stringify(doc.toJSON()) === before,
            probes: document.querySelectorAll(
              "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
            ).length,
            faces: [...document.fonts].filter((f) =>
              /Canoli(Glyph|Variation|Size)_/.test(f.family),
            ).length,
          };
        },
        { sources, mode },
      );
      await writeFile(
        info.outputPath("native-parent-guard.json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        touched: true,
        healthy: true,
        unchanged: true,
        probes: 0,
        faces: 0,
      });
      if (mode === "partial") expect(result.withheld).toBe(true);
      else expect(result.error).toBeTruthy();
    },
  );
