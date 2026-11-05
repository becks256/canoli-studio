import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
for (const mode of ["abort", "release"] as const)
  test(
    "authored native item " +
      mode +
      " closes suspended original and alternate probes before healthy retry",
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
          const { matchNativeStyledSvgLine } = (await import(
            /* @vite-ignore */ String("/src/engine/native-svg-styled.ts")
          )) as typeof import("../src/engine/native-svg-styled");
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
              transform: [1.25, 0.125, -0.25, 0.9, 15, 14] as [
                number,
                number,
                number,
                number,
                number,
                number,
              ],
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
          let touched = false,
            error: string | undefined,
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
              const controlled = {
                ...plan,
                async captureGlyphFont(
                  ...args: Parameters<typeof plan.captureGlyphFont>
                ) {
                  const font = await plan.captureGlyphFont(...args);
                  if (args[0] !== files[1].id) return font;
                  return {
                    ...font,
                    async shapeRun(
                      ...request: Parameters<typeof font.shapeRun>
                    ) {
                      const run = await font.shapeRun(...request);
                      if (
                        !touched &&
                        request[0].itemOffset === 3 &&
                        request[0].itemLength === 1
                      ) {
                        touched = true;
                        if (mode === "abort") controller.abort();
                        else plan.release();
                      }
                      return run;
                    },
                  };
                },
              };
              try {
                await matchNativeStyledSvgLine(
                  controlled,
                  0,
                  doc.toJSON().fontFiles!,
                  { signal: controller.signal },
                );
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
        info.outputPath("authored-guard.json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        touched: true,
        healthy: true,
        unchanged: true,
        probes: 0,
        faces: 0,
      });
      expect(result.error).toBeTruthy();
    },
  );
