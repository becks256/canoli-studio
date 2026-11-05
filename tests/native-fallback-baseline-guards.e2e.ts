import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

for (const mode of ["abort", "release", "nonfinite"] as const)
  test(`inherited fallback baseline ${mode} withholds paint and permits a healthy original-source retry`, async ({
    page,
  }) => {
    const sources = await Promise.all(
      ["native-fallback/Latin-no-mark.ttf", "vertical-font/Vertical.ttf"].map(
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
        const assets = new AssetStore(),
          doc = new Document({ assets }),
          fonts: Awaited<ReturnType<typeof doc.fonts.embed>>[] = [];
        for (const bytes of sources)
          fonts.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
        const before = JSON.stringify(doc.toJSON()),
          input = {
            width: 512,
            height: 512,
            style: {
              fontFamily: fonts.map((f) => f.family).join(", "),
              fontSize: 40,
            },
            lines: [
              {
                x: 220,
                y: 160,
                align: "center" as const,
                direction: "ltr" as const,
                writing: {
                  mode: "vertical-rl" as const,
                  orientation: "mixed" as const,
                },
                spans: [
                  {
                    text: "A漢、 B字",
                    style: { color: "color(srgb-linear 4 -.25 1.5 / .5)" },
                  },
                ],
              },
            ],
          };
        let touched = false,
          rejected = false,
          healthy = false;
        const nativeMeasure = CanvasRenderingContext2D.prototype.measureText;
        try {
          const plan = await captureStyledTextPlan(
            input,
            doc.toJSON(),
            assets,
            { captureLinearPaint: true },
          );
          const controller = new AbortController();
          try {
            plan.retireMeasurement();
            CanvasRenderingContext2D.prototype.measureText = function (text) {
              const metrics = nativeMeasure.call(this, text);
              if (
                !touched &&
                text === "" &&
                this.font.includes(fonts[1].family)
              ) {
                touched = true;
                if (mode === "abort")
                  controller.abort(
                    new Error("Cancelled during native baseline capture"),
                  );
                if (mode === "release") plan.release();
                if (mode === "nonfinite")
                  return new Proxy(metrics, {
                    get(target, property) {
                      return property === "fontBoundingBoxAscent"
                        ? NaN
                        : Reflect.get(target, property, target);
                    },
                  });
              }
              return metrics;
            };
            try {
              await plan.matchStyledGlyphLine(0, { signal: controller.signal });
            } catch {
              rejected = true;
            }
          } finally {
            CanvasRenderingContext2D.prototype.measureText = nativeMeasure;
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
          CanvasRenderingContext2D.prototype.measureText = nativeMeasure;
          assets.dispose();
        }
        return {
          touched,
          rejected,
          healthy,
          unchanged: JSON.stringify(doc.toJSON()) === before,
          probes: document.querySelectorAll(
            "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
          ).length,
          privateFaces: [...document.fonts].filter((f) =>
            /Canoli(Glyph|Variation|Size)_/.test(f.family),
          ).length,
        };
      },
      { sources, mode },
    );
    expect(result).toEqual({
      touched: true,
      rejected: true,
      healthy: true,
      unchanged: true,
      probes: 0,
      privateFaces: 0,
    });
  });
