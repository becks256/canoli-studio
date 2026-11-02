import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("native styled source lines retain full contexts, cluster colors, multiple fonts and curved vertical paint", async ({
  page,
}, info) => {
  test.setTimeout(360000);
  const sources = await Promise.all(
    [
      "shaping-font/Shaping.ttf",
      "vertical-font/Vertical.ttf",
      "font-variations/Axes.ttf",
    ].map(async (file) => [...(await readFile("tests/fixtures/" + file))]),
  );
  await page.goto("/");
  const result = await page.evaluate(async (sources) => {
    const { captureStyledTextPlan } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ assets }),
      fonts = [];
    for (const bytes of sources)
      fonts.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
    const before = JSON.stringify(doc.toJSON()),
      rows = [];
    const first = "color(srgb-linear 4 -.25 1.5 / .00000001)",
      second = "color(srgb-linear .125 3 -.5 / .64123012345)",
      cases = [
        {
          name: "same-color-spelling",
          spans: [
            { text: "f", style: { color: "#f00" } },
            { text: "i", style: { color: "red" } },
          ],
        },
        {
          name: "same-color-space",
          spans: [
            { text: "f", style: { color: "#f00" } },
            { text: "i", style: { color: "color(srgb-linear 1 0 0)" } },
          ],
        },
        {
          name: "ligature-color",
          spans: [
            { text: "f", style: { color: first } },
            { text: "i", style: { color: second } },
          ],
        },
        {
          name: "mark-color",
          spans: [
            { text: "a", style: { color: first } },
            { text: "\u0301", style: { color: second } },
          ],
        },
        {
          name: "kerning-color",
          spans: [
            { text: "A", style: { color: first } },
            { text: "V", style: { color: second } },
          ],
        },
        {
          name: "arabic-size",
          spans: [
            { text: "ب", style: { color: first } },
            { text: "بلا", style: { color: second, fontSize: 32 } },
          ],
          direction: "rtl" as const,
        },
        {
          name: "mark-size",
          spans: [
            { text: "a", style: { color: first } },
            { text: "\u0301", style: { color: second, fontSize: 32 } },
          ],
        },
        {
          name: "font-size",
          spans: [
            { text: "AV ", style: { color: first } },
            {
              text: "A漢、",
              style: {
                fontFamily: fonts[1].family,
                fontSize: 32,
                color: second,
              },
            },
          ],
        },
        {
          name: "variable-tuples",
          spans: [
            {
              text: "AA ",
              style: {
                fontFamily: fonts[2].family,
                fontVariationSettings: '"TEST" 25,"wght" 500',
                color: first,
              },
            },
            {
              text: "AA",
              style: {
                fontFamily: fonts[2].family,
                fontVariationSettings: '"TEST" 75,"wght" 700',
                color: second,
                fontSize: 32,
              },
            },
          ],
        },
      ];
    try {
      for (const item of cases)
        for (const vertical of [false, true])
          for (const path of [false, true])
            for (const affine of [false, true]) {
              const plan = await captureStyledTextPlan(
                {
                  width: 512,
                  height: 512,
                  transform: affine
                    ? [1.25, 0.125, -0.25, 0.9, 15, 14]
                    : [1, 0, 0, 1, 0, 0],
                  style: { fontFamily: fonts[0].family, fontSize: 40 },
                  lines: [
                    {
                      x: 220,
                      y: 160,
                      direction: item.direction ?? "ltr",
                      align: "center",
                      ...(vertical
                        ? {
                            writing: {
                              mode: "vertical-rl" as const,
                              orientation: "mixed" as const,
                            },
                          }
                        : {}),
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
                      spans: item.spans,
                    },
                  ],
                },
                doc.toJSON(),
                assets,
                { captureLinearPaint: true },
              );
              try {
                plan.retireMeasurement();
                const match = await plan.matchStyledGlyphLine(0);
                rows.push({
                  name: item.name,
                  vertical,
                  path,
                  affine,
                  status: match.status,
                  evidence: match.evidence,
                  ...(match.status === "matched"
                    ? {
                        runs: match.runs!.map((r) => ({
                          request: r.request,
                          glyphs: r.glyphs,
                        })),
                        glyphs: match.glyphs.map((g) => ({
                          id: g.glyphId,
                          color: g.color,
                          family: g.font.sourceFamily,
                          style: g.style,
                          origin: g.origin,
                        })),
                      }
                    : {
                        reason: match.reason,
                        runs: undefined,
                        glyphs: undefined,
                      }),
                });
              } finally {
                plan.release();
              }
            }
      return {
        rows,
        unchanged: JSON.stringify(doc.toJSON()) === before,
        probes: document.querySelectorAll(
          "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
        ).length,
        privateFaces: [...document.fonts].filter((f) =>
          f.family.startsWith("CanoliGlyph_"),
        ).length,
      };
    } finally {
      assets.dispose();
    }
  }, sources);
  await writeFile(
    info.outputPath("native-svg-styled.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, privateFaces: 0 });
  expect(result.rows).toHaveLength(72);
  for (const row of result.rows) {
    expect(
      row.status,
      JSON.stringify({
        name: row.name,
        vertical: row.vertical,
        path: row.path,
        affine: row.affine,
        evidence: row.evidence,
      }),
    ).toBe("matched");
    expect(row.evidence!.svgMaxAlphaError).toBe(0);
    expect(row.evidence!.paintOwnership).toMatchObject({
      error: 0,
      colors: row.name.startsWith("same-color") ? 1 : 2,
    });
    for (const run of row.runs!)
      expect(run.request.text).toBe(row.runs![0].request.text);
  }
});
