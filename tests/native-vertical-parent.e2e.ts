import { test, expect } from "@playwright/test";
import { readFile, writeFile, appendFile } from "node:fs/promises";
test("source parent and signed attachments retain exact native fallback ink and colors in all eight original upright controls", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (path) => [...(await readFile("tests/fixtures/" + path))],
    ),
  );
  await page.exposeFunction("keepParentControl", async (row: unknown) =>
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
                  fontFamily: files.map((f) => f.family).join(", "),
                  fontSize: 40,
                  letterSpacing,
                },
                lines: [
                  {
                    x: 220,
                    y: 160,
                    direction,
                    align: "center",
                    writing: { mode: "vertical-rl", orientation: "upright" },
                    spans: [
                      {
                        text: "AV a",
                        style: { color: "color(srgb-linear 4 -.25 1.5 / .5)" },
                      },
                      {
                        text: "\u0301 ",
                        style: {
                          color: "color(srgb-linear .125 3 -.5 / .64123012345)",
                        },
                      },
                      {
                        text: "fi",
                        style: {
                          color: "color(srgb-linear .125 3 -.5 / .64123012345)",
                        },
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
                          files[
                            g.sourceCluster === 3 || g.sourceCluster === 4
                              ? 1
                              : 0
                          ].family,
                      })),
                    }
                  : { reason: match.reason }),
              };
              rows.push(row);
              await (
                globalThis as unknown as {
                  keepParentControl(row: unknown): Promise<void>;
                }
              ).keepParentControl(row);
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
    info.outputPath("native-parent.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, faces: 0 });
  expect(result.rows).toHaveLength(8);
  for (const row of result.rows) {
    expect(row.status, JSON.stringify(row)).toBe("matched");
    expect(row.evidence).toMatchObject({
      svgMaxAlphaError: 0,
      paintOwnership: { error: 0, colors: 2 },
    });
    if ("glyphs" in row)
      for (const g of row.glyphs!)
        expect(g.family, JSON.stringify(g)).toBe(g.expected);
    if ("runs" in row)
      for (const run of row.runs!) expect(run.text).toBe("AV a\u0301 fi");
  }
});

test("rounded native shaping and nominal positions retain original upright marks with and without font fallback", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (path) => [...(await readFile("tests/fixtures/" + path))],
    ),
  );
  await page.exposeFunction("keepParentControl", async (row: unknown) =>
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
                      writing: { mode: "vertical-rl", orientation: "upright" },
                      spans: [
                        {
                          text: "AV fi a\u0301",
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
                            files[!fallback || g.sourceCluster! >= 6 ? 1 : 0].family,
                        })),
                      }
                    : { reason: match.reason }),
                };
                rows.push(row);
                await (
                  globalThis as unknown as {
                    keepParentControl(row: unknown): Promise<void>;
                  }
                ).keepParentControl(row);
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
    info.outputPath("native-rounded-marks.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, faces: 0 });
  expect(result.rows).toHaveLength(16);
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
      for (const run of row.runs!) expect(run.text).toBe("AV fi a\u0301");
  }
});

test("complete original span allocation retains exact sideways marks with and without font fallback", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (path) => [...(await readFile("tests/fixtures/" + path))],
    ),
  );
  await page.exposeFunction("keepParentControl", async (row: unknown) =>
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
      for (const sourceFrame of ["canvas", "project"] as const)
      for (const fallback of [false, true])
        for (const direction of ["ltr", "rtl"] as const)
          for (const affine of [false, true])
            for (const letterSpacing of [0, -30]) {
              const plan = await captureStyledTextPlan(
                {
                  width: 512,
                  height: 512,
                  transform: sourceFrame === "project"
                    ? affine ? [1.25, 0.125, -0.25, 0.9, 240, 180] : [1, 0, 0, 1, 240, 180]
                    : affine ? [1.25, 0.125, -0.25, 0.9, 15, 14] : [1, 0, 0, 1, 0, 0],
                  style: {
                    fontFamily: (fallback ? files : [files[1]])
                      .map((f) => f.family)
                      .join(", "),
                    fontSize: 40,
                    letterSpacing,
                  },
                  lines: [
                    {
                      x: sourceFrame === "project" ? -20 : 220,
                      y: sourceFrame === "project" ? 0.5 : 160,
                      direction,
                      align: "center",
                      writing: { mode: "vertical-rl", orientation: "sideways" },
                      spans: [
                        {
                          text: "AV fi a\u0301",
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
                  sourceFrame,
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
                            files[!fallback || g.sourceCluster! >= 6 ? 1 : 0].family,
                        })),
                      }
                    : { reason: match.reason }),
                };
                rows.push(row);
                await (
                  globalThis as unknown as {
                    keepParentControl(row: unknown): Promise<void>;
                  }
                ).keepParentControl(row);
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
    info.outputPath("native-complete-inline.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, faces: 0 });
  expect(result.rows).toHaveLength(32);
  expect(result.rows.find(row => row.sourceFrame === "project" && row.fallback && row.direction === "rtl" && row.affine && row.letterSpacing === -30)).toMatchObject({evidence: {nativeSharedOrigin: true}});
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
      for (const run of row.runs!) expect(run.text).toBe("AV fi a\u0301");
  }
});
