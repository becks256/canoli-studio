import { test, expect } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { parseFontVariations } from "../src/core/font-variations";

for (const kind of [
  "cjk",
  "mark",
  "bidi",
  "joining",
  "axes",
  "colored",
] as const)
  test(
    "owned native fallback retains original source, exact ink and paint ownership: " +
      kind,
    async ({ page }, info) => {
      // All 64 layouts retain the ordinary 60-second match deadline. Allow
      // the whole matrix to record every result even if several layouts fail.
      test.setTimeout(4200000);
      const sources = await Promise.all(
        [
          "native-fallback/Latin-no-mark.ttf",
          "shaping-font/Shaping.ttf",
          "vertical-font/Vertical.ttf",
          "font-variations/Axes.ttf",
          "native-fallback/Fallback-axes-B.ttf",
        ].map(async (file) => [...(await readFile("tests/fixtures/" + file))]),
      );
      await page.exposeFunction("__keepFallback", async (row: unknown) =>
        appendFile(
          info.outputPath("fallback-progress.jsonl"),
          JSON.stringify(row) + "\n",
        ),
      );
      await page.goto("/");
      const result = await page.evaluate(
        async ({ sources, kind }) => {
          const { captureStyledTextPlan } = (await import(
            /* @vite-ignore */ String("/src/engine/styled-text.ts")
          )) as typeof import("../src/engine/styled-text");
          const { AssetStore } = (await import(
            /* @vite-ignore */ String("/src/core/assets.ts")
          )) as typeof import("../src/core/assets");
          const { Document } = (await import(
            /* @vite-ignore */ String("/src/dom/index.ts")
          )) as typeof import("../src/dom");
          const assets = new AssetStore(),
            doc = new Document({ assets }),
            fonts: Awaited<ReturnType<typeof doc.fonts.embed>>[] = [];
          for (const bytes of sources)
            fonts.push(
              await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
            );
          const before = JSON.stringify(doc.toJSON()),
            rows = [];
          const first = "color(srgb-linear 4 -.25 1.5 / .5)",
            second = "color(srgb-linear .125 3 -.5 / .64123012345)",
            fontFamily = (
              kind === "axes"
                ? [fonts[3], fonts[4]]
                : kind === "cjk"
                  ? [fonts[0], fonts[2]]
                  : [fonts[0], fonts[1]]
            )
              .map((file) => file.family)
              .join(", "),
            text = {
              mark: "AV fi a\u0301",
              bidi: "A אב V",
              joining: "ببلا AV",
              cjk: "A漢、 B字",
              axes: "AB BA",
              colored: "AV a\u0301 fi",
            }[kind],
            spans =
              kind === "colored"
                ? [
                    { text: "AV a", style: { color: first } },
                    { text: "\u0301 ", style: { color: second } },
                    { text: "fi", style: { color: second } },
                  ]
                : [{ text, style: { color: first } }];
          let result;
          try {
            for (const orientation of [
              "horizontal",
              "mixed",
              "upright",
              "sideways",
            ] as const)
              for (const direction of ["ltr", "rtl"] as const)
                for (const path of [false, true])
                  for (const affine of [false, true])
                    for (const letterSpacing of [0, -30]) {
                      const settings =
                          kind === "axes" ? '"TEST" 90,"wght" 750' : "normal",
                        plan = await captureStyledTextPlan(
                          {
                            width: 512,
                            height: 512,
                            transform: affine
                              ? [1.25, 0.125, -0.25, 0.9, 15, 14]
                              : [1, 0, 0, 1, 0, 0],
                            style: {
                              fontFamily,
                              fontVariationSettings: settings,
                              fontSize: 40,
                              letterSpacing,
                            },
                            lines: [
                              {
                                x: 220,
                                y: 160,
                                direction,
                                align: "center",
                                ...(orientation === "horizontal"
                                  ? {}
                                  : {
                                      writing: {
                                        mode: "vertical-rl" as const,
                                        orientation,
                                      },
                                    }),
                                ...(path
                                  ? {
                                      path: {
                                        points: [
                                          {
                                            x: 24,
                                            y: 150,
                                            in: { x: 24, y: 150 },
                                            out: { x: 100, y: 30 },
                                          },
                                          {
                                            x: 420,
                                            y: 150,
                                            in: { x: 340, y: 30 },
                                            out: { x: 420, y: 150 },
                                          },
                                        ],
                                        startOffset: 210,
                                        baselineOffset: 7,
                                      },
                                    }
                                  : {}),
                                spans,
                              },
                            ],
                          },
                          doc.toJSON(),
                          assets,
                          { captureLinearPaint: true },
                        );
                      let row;
                      try {
                        plan.retireMeasurement();
                        const match = await plan.matchStyledGlyphLine(0);
                        row = {
                          orientation,
                          direction,
                          path,
                          affine,
                          letterSpacing,
                          status: match.status,
                          evidence: match.evidence,
                          ...(match.status === "matched"
                            ? {
                                runs: match.runs!.map((r) => ({
                                  request: r.request,
                                  glyphs: r.glyphs,
                                })),
                                glyphs: match.glyphs.map((g) => {
                                  const cluster = g.sourceCluster;
                                  if (
                                    cluster === undefined ||
                                    !Number.isInteger(cluster) ||
                                    cluster < 0 ||
                                    cluster >= text.length
                                  )
                                    throw new Error(
                                      "Missing original fallback cluster",
                                    );
                                  const owner =
                                    kind === "axes"
                                      ? text[cluster] === "B"
                                        ? 4
                                        : 3
                                      : kind === "cjk"
                                        ? text[cluster] === "A" ||
                                          text[cluster] === " "
                                          ? 0
                                          : 2
                                        : kind === "joining"
                                          ? cluster < 4
                                            ? 1
                                            : 0
                                          : kind === "bidi"
                                            ? cluster === 2 || cluster === 3
                                              ? 1
                                              : 0
                                            : kind === "mark"
                                              ? cluster >= 6
                                                ? 1
                                                : 0
                                              : cluster === 3 || cluster === 4
                                                ? 1
                                                : 0;
                                  return {
                                    id: g.glyphId,
                                    cluster,
                                    color: g.color,
                                    family: g.font.sourceFamily,
                                    expectedFamily: fonts[owner].family,
                                    settings: g.font.settings,
                                    expectedAxes:
                                      kind === "axes"
                                        ? owner === 4
                                          ? { TEST: 75, wght: 700 }
                                          : { TEST: 90, wght: 750 }
                                        : {},
                                  };
                                }),
                              }
                            : {
                                reason: match.reason,
                                runs: undefined,
                                glyphs: undefined,
                              }),
                        };
                      } catch (error) {
                        row = {
                          orientation,
                          direction,
                          path,
                          affine,
                          letterSpacing,
                          error: String(error),
                        };
                      } finally {
                        plan.release();
                      }
                      rows.push(row);
                      await (
                        globalThis as unknown as {
                          __keepFallback(row: unknown): Promise<void>;
                        }
                      ).__keepFallback(row);
                    }
            result = {
              rows,
              unchanged: JSON.stringify(doc.toJSON()) === before,
              probes: document.querySelectorAll(
                "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
              ).length,
              privateFaces: [...document.fonts].filter((f) =>
                /Canoli(Glyph|Variation|Size)_/.test(f.family),
              ).length,
            };
          } finally {
            assets.dispose();
          }
          return {
            ...result,
            privateFaces: [...document.fonts].filter((f) =>
              /Canoli(Glyph|Variation|Size)_/.test(f.family),
            ).length,
          };
        },
        { sources, kind },
      );
      await writeFile(
        info.outputPath("fallback.json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        unchanged: true,
        probes: 0,
        privateFaces: 0,
      });
      expect(result.rows).toHaveLength(64);
      for (const row of result.rows) {
        expect(
          "error" in row ? row.error : undefined,
          JSON.stringify(row),
        ).toBeUndefined();
        expect(
          "status" in row ? row.status : undefined,
          JSON.stringify(row),
        ).toBe("matched");
        if ("evidence" in row) {
          expect(row.evidence).toMatchObject({
            svgMaxAlphaError: 0,
            paintOwnership: { error: 0 },
          });
          for (const glyph of row.glyphs!) {
            expect(glyph.family, JSON.stringify(glyph)).toBe(
              glyph.expectedFamily,
            );
            expect(
              Object.fromEntries(
                parseFontVariations(glyph.settings).map((axis) => [
                  axis.tag,
                  axis.value,
                ]),
              ),
            ).toEqual(glyph.expectedAxes);
          }
          for (const run of row.runs!)
            expect(run.request.text).toBe(
              kind === "colored"
                ? "AV a\u0301 fi"
                : {
                    mark: "AV fi a\u0301",
                    bidi: "A אב V",
                    joining: "ببلا AV",
                    cjk: "A漢、 B字",
                    axes: "AB BA",
                  }[kind],
            );
        }
      }
    },
  );
