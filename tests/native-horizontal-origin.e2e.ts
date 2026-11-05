import { test, expect } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";

test("script-aware screen spacing and native shared origins retain exact original joining ink", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (path) => [...(await readFile("tests/fixtures/" + path))],
    ),
  );
  await page.exposeFunction("keepHorizontalControl", async (row: unknown) =>
    appendFile(info.outputPath("progress.jsonl"), JSON.stringify(row) + "\n"),
  );
  await page.goto("/");
  const result = await page.evaluate(async (sources) => {
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { captureStyledTextPlan } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const { Document } = (await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    )) as typeof import("../src/dom");
    const assets = new AssetStore(),
      doc = new Document({ assets }),
      files: Awaited<ReturnType<typeof doc.fonts.embed>>[] = [];
    for (const bytes of sources)
      files.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
    const before = JSON.stringify(doc.toJSON()),
      rows = [];
    try {
      for (const fallback of [false, true])
        for (const direction of ["ltr", "rtl"] as const)
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
                    fontFamily: (fallback ? files : [files[1]])
                      .map((f) => f.family)
                      .join(", "),
                    fontSize: 40,
                    letterSpacing,
                  },
                  lines: [
                    {
                      x: 220,
                      y: 160,
                      direction,
                      align: "center",
                      spans: [
                        {
                          text: "ببلا AV",
                          style: { color: "color(srgb-linear 4 -.25 1.5 / .5)" },
                        },
                      ],
                    },
                  ],
                },
                doc.toJSON(),
                assets,
                { captureLinearPaint: true },
              );
              try {
                plan.retireMeasurement();
                const started = performance.now(),
                  match = await plan.matchStyledGlyphLine(0);
                const row = {
                  fallback,
                  direction,
                  affine,
                  letterSpacing,
                  elapsedMs: performance.now() - started,
                  status: match.status,
                  evidence: match.evidence,
                  ...(match.status === "matched"
                    ? {
                        runs: match.runs!.map((r) => r.request),
                        glyphs: match.glyphs.map((g) => ({
                          id: g.glyphId,
                          cluster: g.sourceCluster,
                          color: g.color,
                          family: g.font.sourceFamily,
                          expected:
                            files[!fallback || g.sourceCluster! < 4 ? 1 : 0].family,
                        })),
                      }
                    : { reason: match.reason }),
                };
                rows.push(row);
                await (
                  globalThis as unknown as {
                    keepHorizontalControl(row: unknown): Promise<void>;
                  }
                ).keepHorizontalControl(row);
              } finally {
                plan.release();
              }
            }
    } finally {
      assets.dispose();
    }
    return {
      rows,
      unchanged: JSON.stringify(doc.toJSON()) === before,
      probes: document.querySelectorAll(
        "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
      ).length,
      faces: [...document.fonts].filter((f) =>
        /Canoli(Glyph|Variation|Size)_/.test(f.family),
      ).length,
    };
  }, sources);
  await writeFile(
    info.outputPath("native-horizontal-origin.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, faces: 0 });
  expect(result.rows).toHaveLength(16);
  expect(result.rows.find(row => row.fallback && row.direction === "rtl" && row.affine && row.letterSpacing === -30)).toMatchObject({evidence: {nativeSharedOrigin: true}});
  for (const row of result.rows) {
    expect(row.status, JSON.stringify(row)).toBe("matched");
    expect(row.evidence).toMatchObject({
      svgMaxAlphaError: 0,
      paintOwnership: { error: 0, colors: 1 },
    });
    if ("glyphs" in row)
      for (const g of row.glyphs!)
        expect(g.family, JSON.stringify(g)).toBe(g.expected);
    if ("runs" in row)
      for (const run of row.runs!) expect(run.text).toBe("ببلا AV");
  }
});
