import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("native shaping scale predicts independent original mark placement at fractional sizes", async ({
  page,
}, info) => {
  const source = [
      ...(await readFile("tests/fixtures/shaping-font/Shaping.ttf")),
    ],
    probe = [...(await readFile("tests/fixtures/native-layout/Mark-only.ttf"))];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ source, probe }) => {
      const { AssetStore } = (await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      )) as typeof import("../src/core/assets");
      const { captureStyledTextPlan } = (await import(
        /* @vite-ignore */ String("/src/engine/styled-text.ts")
      )) as typeof import("../src/engine/styled-text");
      const { applyTextStyle } = (await import(
        /* @vite-ignore */ String("/src/core/text-style.ts")
      )) as typeof import("../src/core/text-style");
      const { captureNativeTextSize } = (await import(
        /* @vite-ignore */ String("/src/engine/native-text-size.ts")
      )) as typeof import("../src/engine/native-text-size");
      const assets = new AssetStore(),
        doc = new window.luma.Document({ assets }),
        file = await doc.fonts.embed(new Blob([new Uint8Array(source)])),
        before = JSON.stringify(doc.toJSON()),
        face = new FontFace(
          "IndependentMarkMetricProbe",
          new Uint8Array(probe).buffer,
        ),
        rows = [];
      await face.load();
      document.fonts.add(face);
      try {
        for (const size of [
          40,
          Math.fround(
            40 *
              Math.fround(
                Math.sqrt((1.25 ** 2 + 0.125 ** 2 + 0.25 ** 2 + 0.9 ** 2) / 2),
              ),
          ),
          33.333,
          64.5,
        ]) {
          const plan = await captureStyledTextPlan(
            {
              width: 512,
              height: 512,
              style: { fontFamily: file.family, fontSize: 40 },
              lines: [{ spans: [{ text: "a\u0301" }] }],
            },
            doc.toJSON(),
            assets,
            { captureLinearPaint: true },
          );
          try {
            const font = await plan.captureGlyphFont(file.id),
              context = document.createElement("canvas").getContext("2d")!,
              css = {
                weight: 400,
                width: 100,
                style: "normal" as const,
                opticalSize: 40,
              };
            const metrics = await font.svgMetrics!(
              [7, 8],
              { fontSize: 40, fontWeight: "400", fontStyle: "normal" },
              css,
              size,
              {},
              { native: true, direction: "ltr" },
            );
            applyTextStyle(context, {
              fontFamily: "IndependentMarkMetricProbe",
              fontSize: size,
              fontKerning: "none",
            });
            const native = context.measureText("a\u0301");
            applyTextStyle(context, {
              fontFamily: font.family,
              fontSize: size,
              fontKerning: "none",
            });
            const mark = context.measureText(font.character(8));
            const run = await font.shapeRun({
              text: "a\u0301",
              css,
              nativeMetrics: metrics.nativeMetrics,
            });
            rows.push({
              size,
              em: metrics.em,
              rasterEm: await captureNativeTextSize(size),
              glyphs: run.glyphs.map((g) => g.glyphId),
              observedX:
                native.actualBoundingBoxRight - mark.actualBoundingBoxRight,
              observedY:
                native.actualBoundingBoxAscent - mark.actualBoundingBoxAscent,
              predictedX:
                ((run.glyphs[0].xAdvance + run.glyphs[1].xOffset) *
                  metrics.em) /
                run.unitsPerEm,
              predictedY: (run.glyphs[1].yOffset * metrics.em) / run.unitsPerEm,
            });
          } finally {
            plan.release();
          }
        }
        return { rows, unchanged: JSON.stringify(doc.toJSON()) === before };
      } finally {
        document.fonts.delete(face);
        assets.dispose();
      }
    },
    { source, probe },
  );
  await writeFile(
    info.outputPath("native-layout-metrics.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result.unchanged).toBe(true);
  for (const row of result.rows) {
    expect(row.glyphs).toEqual([7, 8]);
    expect(row.predictedX).toBeCloseTo(row.observedX, 5);
    expect(row.predictedY).toBeCloseTo(row.observedY, 5);
  }
});

for (const fault of ["abort", "timeout", "registration"] as const)
  test(
    "native layout calibration " +
      fault +
      " rejects and retires its private resources",
    async ({ page }) => {
      await page.goto("/");
      const result = await page.evaluate(async (fault) => {
        const { captureNativeLayoutSize } = (await import(
          /* @vite-ignore */ String("/src/engine/native-layout-size.ts")
        )) as typeof import("../src/engine/native-layout-size");
        const original = FontFace.prototype.load,
          abort = new AbortController();
        let error = "",
          triggered = false;
        if (fault === "abort")
          abort.abort(new Error("Expected layout calibration abort"));
        if (fault === "timeout")
          FontFace.prototype.load = function () {
            if (this.family.startsWith("CanoliSize_Layout_")) {
              triggered = true;
              return new Promise<FontFace>(() => {});
            }
            return original.call(this);
          };
        try {
          try {
            await captureNativeLayoutSize(44.27753448486328, {
              signal: abort.signal,
              timeoutMs: 100,
              check: () => {
                if (fault === "registration") {
                  const face = [...document.fonts].find((f) =>
                    f.family.startsWith("CanoliSize_Layout_"),
                  );
                  if (face) {
                    triggered = true;
                    face.featureSettings = '"kern" 0';
                  }
                }
              },
            });
          } catch (e) {
            error = String(e);
          }
        } finally {
          FontFace.prototype.load = original;
        }
        const faces = () =>
            [...document.fonts].filter((f) =>
              f.family.startsWith("CanoliSize_Layout_"),
            ).length,
          afterFailure = faces(),
          retry = await captureNativeLayoutSize(44.27753448486328);
        return { error, triggered, afterFailure, retry, afterRetry: faces() };
      }, fault);
      expect(result.error).toContain(
        fault === "abort"
          ? "Expected layout calibration abort"
          : fault === "timeout"
            ? "time budget"
            : "registration changed",
      );
      if (fault !== "abort") expect(result.triggered).toBe(true);
      expect(result.afterFailure).toBe(0);
      expect(result.afterRetry).toBe(0);
      expect(result.retry).toBeGreaterThan(0);
    },
  );

test("original signed fallback frames retain exact native ink and ownership across all eight mixed vertical controls", async ({
  page,
}, info) => {
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (file) => [...(await readFile("tests/fixtures/" + file))],
    ),
  );
  await page.goto("/");
  const result = await page.evaluate(async (sources) => {
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { captureStyledTextPlan } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ assets }),
      files: Awaited<ReturnType<typeof doc.fonts.embed>>[] = [];
    for (const bytes of sources)
      files.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
    const before = JSON.stringify(doc.toJSON()),
      rows = [];
    try {
      for (const direction of ["ltr", "rtl"] as const)
        for (const path of [false, true])
          for (const affine of [false, true]) {
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
                  letterSpacing: -30,
                },
                lines: [
                  {
                    x: 220,
                    y: 160,
                    direction,
                    align: "center",
                    writing: { mode: "vertical-rl", orientation: "mixed" },
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
              const match = await plan.matchStyledGlyphLine(0);
              rows.push({
                direction,
                path,
                affine,
                status: match.status,
                evidence: match.evidence,
                ...(match.status === "matched"
                  ? {
                      glyphs: match.glyphs.map((g) => ({
                        cluster: g.sourceCluster,
                        family: g.font.sourceFamily,
                        expected: files[g.sourceCluster! >= 6 ? 1 : 0].family,
                        settings: g.font.settings,
                      })),
                      texts: match.runs!.map((run) => run.request.text),
                    }
                  : { reason: match.reason }),
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
        faces: [...document.fonts].filter((f) =>
          /Canoli(Glyph|Variation|Size)_/.test(f.family),
        ).length,
      };
    } finally {
      assets.dispose();
    }
  }, sources);
  await writeFile(
    info.outputPath("native-inline-frames.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0, faces: 0 });
  expect(result.rows).toHaveLength(8);
  for (const row of result.rows) {
    expect(row.status, JSON.stringify(row)).toBe("matched");
    expect(row.evidence).toMatchObject({
      svgMaxAlphaError: 0,
      paintOwnership: { error: 0 },
    });
    if (row.direction === "rtl" && row.path && row.affine)
      expect(row.evidence).toMatchObject({
        inlineFrames: [{ start: 0, end: 8 }],
      });
    if ("glyphs" in row) {
      for (const glyph of row.glyphs) {
        expect(glyph.family).toBe(glyph.expected);
        expect(glyph.settings).toBe("normal");
      }
      for (const text of row.texts) expect(text).toBe("AV fi a\u0301");
    }
  }
});
