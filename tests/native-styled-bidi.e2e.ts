import { test, expect } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";

test("native mixed-bidi styled spans retain exact complete ink and per-color ownership", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const sources = await Promise.all(
    [
      "shaping-font/Shaping.ttf",
      "vertical-font/Vertical.ttf",
      "font-variations/Axes.ttf",
    ].map(async (file) => [...(await readFile("tests/fixtures/" + file))]),
  );
  await page.exposeFunction("__canoliKeepMixed", async (row: unknown) =>
    appendFile(
      info.outputPath("native-styled-bidi-progress.jsonl"),
      JSON.stringify(row) + "\n",
    ),
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
    const first = "color(srgb-linear 4 -.25 1.5 / .5)",
      second = "color(srgb-linear .125 3 -.5 / .64123012345)",
      cases = [
        {
          name: "bidi-color-latin-hebrew",
          spans: [
            { text: "A ", style: { color: first } },
            { text: "אב ", style: { color: second } },
            { text: "V", style: { color: first } },
          ],
        },
        {
          name: "bidi-color-arabic-hebrew",
          spans: [
            { text: "بب", style: { color: first } },
            { text: "אב", style: { color: second } },
          ],
        },
        {
          name: "bidi-size",
          spans: [
            { text: "بب", style: { color: first } },
            { text: "אב", style: { color: second, fontSize: 32 } },
            { text: "AV", style: { color: first } },
          ],
        },
        {
          name: "bidi-font",
          spans: [
            { text: "بب", style: { color: first } },
            {
              text: "A漢、",
              style: { fontFamily: fonts[1].family, color: second },
            },
            { text: "אב", style: { color: first } },
          ],
        },
      ].flatMap((item) =>
        ["ltr", "rtl"].map((direction) => ({
          ...item,
          direction: direction as "ltr" | "rtl",
        })),
      );
    try {
      for (const item of cases)
        for (const vertical of [false])
          for (const path of [false, true])
            for (const affine of [false, true])
              for (const letterSpacing of [0, -30]) {
                const plan = await captureStyledTextPlan(
                  {
                    width: 512,
                    height: 512,
                    transform: affine
                      ? [1.25, 0.125, -0.25, 0.9, 15, 14]
                      : [1, 0, 0, 1, 0, 0],
                    style: {
                      fontFamily: fonts[0].family,
                      fontSize: 40,
                      letterSpacing,
                    },
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
                    direction: item.direction,
                    letterSpacing,
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
                            sourceCluster: g.sourceCluster,
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
                  await (
                    globalThis as unknown as {
                      __canoliKeepMixed(row: unknown): Promise<void>;
                    }
                  ).__canoliKeepMixed(rows.at(-1));
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
    info.outputPath("native-styled-bidi.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, privateFaces: 0 });
  expect(result.rows).toHaveLength(64);
  for (const row of result.rows) {
    expect(
      row.status,
      JSON.stringify({
        name: row.name,
        direction: row.direction,
        letterSpacing: row.letterSpacing,
        path: row.path,
        affine: row.affine,
        evidence: row.evidence,
      }),
    ).toBe("matched");
    expect(row.evidence!.svgMaxAlphaError).toBe(0);
    expect(row.evidence!.paintOwnership).toMatchObject({ error: 0, colors: 2 });
    for (const run of row.runs!)
      expect(run.request.text).toBe(row.runs![0].request.text);
    for (const glyph of row.glyphs!) {
      expect(Number.isInteger(glyph.sourceCluster)).toBe(true);
      expect(glyph.sourceCluster!).toBeGreaterThanOrEqual(0);
      expect(glyph.sourceCluster!).toBeLessThan(
        row.runs![0].request.text.length,
      );
    }
  }
});
