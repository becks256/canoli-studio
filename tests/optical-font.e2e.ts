import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

for (const deviceScaleFactor of [1, 2])
  test.describe("optical device scale " + deviceScaleFactor, () => {
    test.use({ deviceScaleFactor });
    for (const format of ["ttf", "woff2"])
      test(
        "native optical source sizing matches independent static instances and full resolved glyph paint: " +
          format,
        async ({ page }, info) => {
          const bytes = [
              ...(await readFile(
                "tests/fixtures/optical-font/Optical." + format,
              )),
            ],
            references = await Promise.all(
              [8, 12, 13, 13.5, 16, 24, 40, 72].map(async (size) => ({
                size,
                bytes: [
                  ...(await readFile(
                    `tests/fixtures/optical-font/opsz-${size}-wght-400.ttf`,
                  )),
                ],
              })),
            );
          await page.goto("/");
          const result = await page.evaluate(
            async ({ bytes, references }) => {
              const { captureStyledTextPlan } = (await import(
                /* @vite-ignore */ String("/src/engine/styled-text.ts")
              )) as typeof import("../src/engine/styled-text");
              const { AssetStore } = (await import(
                /* @vite-ignore */ String("/src/core/assets.ts")
              )) as typeof import("../src/core/assets");
              const assets = new AssetStore(),
                doc = new window.luma.Document({ assets }),
                file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
                plan = await captureStyledTextPlan(
                  {
                    width: 1024,
                    height: 256,
                    style: { fontFamily: file.family },
                    lines: [{ spans: [{ text: "AA A" }] }],
                  },
                  doc.toJSON(),
                  assets,
                ),
                faces: FontFace[] = [],
                rows = [];
              try {
                const font = await plan.captureGlyphFont(file.id);
                for (const fontSize of [
                  4, 8, 12, 13, 13.5, 16, 24, 40, 72, 96,
                ]) {
                  const optical = Math.max(8, Math.min(72, fontSize)),
                    reference = references.find((r) => r.size === optical)!,
                    face = new FontFace(
                      "IndependentOptical_" + rows.length,
                      new Uint8Array(reference.bytes).buffer,
                    );
                  await face.load();
                  document.fonts.add(face);
                  faces.push(face);
                  for (const affine of [false, true]) {
                    const transform: [
                        number,
                        number,
                        number,
                        number,
                        number,
                        number,
                      ] = affine
                        ? [1.25, 0.125, -0.25, 0.9, 32, 180]
                        : [1, 0, 0, 1, 32, 180],
                      canvas = document.createElement("canvas");
                    canvas.width = 1024;
                    canvas.height = 256;
                    const c = canvas.getContext("2d")!;
                    c.fillStyle = "#fff";
                    c.fontKerning = "normal";
                    const draw = (family: string) => {
                        c.resetTransform();
                        c.clearRect(0, 0, 1024, 256);
                        c.font = fontSize + "px " + family;
                        c.setTransform(...transform);
                        c.fillText("AA A", 0, 0);
                        return {
                          pixels: c.getImageData(0, 0, 1024, 256).data,
                          advance: c.measureText("AA A").width,
                        };
                      },
                      a = draw(file.family),
                      b = draw(face.family);
                    let error = 0;
                    for (let i = 0; i < a.pixels.length; i++)
                      error = Math.max(
                        error,
                        Math.abs(a.pixels[i] - b.pixels[i]),
                      );
                    const match = await plan.matchGlyphRun(font, {
                      text: "AA A",
                      style: { fontSize, fontKerning: "normal" },
                      transform,
                    });
                    rows.push({
                      fontSize,
                      optical,
                      affine,
                      error,
                      nativeAdvance: a.advance,
                      referenceAdvance: b.advance,
                      status: match.status,
                      evidence: match.evidence,
                      ...(match.status === "matched"
                        ? {
                            settings: match.run.settings,
                            css: match.run.request.css,
                          }
                        : {
                            reason: match.reason,
                            settings: undefined,
                            css: undefined,
                          }),
                    });
                  }
                }
                return { rows, deviceScaleFactor: devicePixelRatio };
              } finally {
                for (const face of faces) document.fonts.delete(face);
                plan.release();
                assets.dispose();
              }
            },
            { bytes, references },
          );
          await writeFile(
            info.outputPath("native-optical-reference.json"),
            JSON.stringify(result, null, 2),
          );
          expect(result.deviceScaleFactor).toBe(deviceScaleFactor);
          for (const row of result.rows) {
            expect(row.error).toBe(0);
            expect(row.nativeAdvance).toBe(row.referenceAdvance);
            expect(row.status).toBe("matched");
            expect(row.css).toMatchObject({ opticalSize: row.fontSize });
            expect(row.settings).toContain('"opsz" ' + row.optical);
            expect(row.evidence!.maxAlphaError).toBe(0);
          }
        },
      );
  });

test("explicit optical overrides and unrelated tuples retain native precedence, immutable source and later optical sizes", async ({
  page,
}, info) => {
  const bytes = [
      ...(await readFile("tests/fixtures/optical-font/Optical.woff2")),
    ],
    references = await Promise.all(
      (
        [
          ["auto-weight", 40, 600, '"wght" 600'],
          ["explicit", 24, 400, '"opsz" 24'],
          ["both", 16, 600, '"opsz" 16,"wght" 600'],
        ] as const
      ).map(async ([name, optical, weight, settings]) => ({
        name,
        optical,
        weight,
        settings,
        bytes: [
          ...(await readFile(
            `tests/fixtures/optical-font/opsz-${optical}-wght-${weight}.ttf`,
          )),
        ],
      })),
    );
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, references }) => {
      const { captureStyledTextPlan } = (await import(
        /* @vite-ignore */ String("/src/engine/styled-text.ts")
      )) as typeof import("../src/engine/styled-text");
      const { AssetStore } = (await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      )) as typeof import("../src/core/assets");
      const { applyTextStyle } = (await import(
        /* @vite-ignore */ String("/src/core/text-style.ts")
      )) as typeof import("../src/core/text-style");
      const assets = new AssetStore(),
        doc = new window.luma.Document({ assets }),
        file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
        before = JSON.stringify(doc.toJSON()),
        plan = await captureStyledTextPlan(
          {
            width: 512,
            height: 256,
            style: { fontFamily: file.family },
            lines: [{ spans: [{ text: "AA A" }] }],
          },
          doc.toJSON(),
          assets,
        ),
        faces: FontFace[] = [],
        rows = [];
      try {
        for (const reference of references) {
          const font = await plan.captureGlyphFont(file.id, reference.settings),
            face = new FontFace(
              "IndependentOpticalOverride_" + reference.name,
              new Uint8Array(reference.bytes).buffer,
            );
          await face.load();
          document.fonts.add(face);
          faces.push(face);
          for (const affine of [false, true]) {
            const transform: [number, number, number, number, number, number] =
                affine
                  ? [1.25, 0.125, -0.25, 0.9, 32, 180]
                  : [1, 0, 0, 1, 32, 180],
              match = await plan.matchGlyphRun(font, {
                text: "AA A",
                style: { fontSize: 40 },
                transform,
              }),
              canvas = document.createElement("canvas");
            canvas.width = 512;
            canvas.height = 256;
            const c = canvas.getContext("2d")!;
            const draw = (independent: boolean) => {
                c.resetTransform();
                c.clearRect(0, 0, 512, 256);
                applyTextStyle(c, {
                  fontFamily: independent ? face.family : file.family,
                  fontSize: 40,
                  fontVariationSettings: independent
                    ? "normal"
                    : reference.settings,
                });
                c.fillStyle = "#fff";
                c.setTransform(...transform);
                c.fillText("AA A", 0, 0);
                return {
                  pixels: c.getImageData(0, 0, 512, 256).data,
                  advance: c.measureText("AA A").width,
                };
              },
              a = draw(false),
              b = draw(true);
            let error = 0;
            for (let i = 0; i < a.pixels.length; i++)
              error = Math.max(error, Math.abs(a.pixels[i] - b.pixels[i]));
            rows.push({
              name: reference.name,
              optical: reference.optical,
              weight: reference.weight,
              affine,
              error,
              nativeAdvance: a.advance,
              referenceAdvance: b.advance,
              status: match.status,
              ...(match.status === "matched"
                ? { settings: match.run.settings }
                : {
                    reason: match.reason,
                    settings: undefined,
                    css: undefined,
                  }),
            });
          }
        }
        const font = await plan.captureGlyphFont(file.id),
          modelUnchanged = before === JSON.stringify(doc.toJSON());
        file.remove();
        for (let i = 0; i < 65; i++) doc.name = "Optical lease " + i;
        const retained = assets.fonts.size,
          later = [];
        for (const size of [
          40, 12, 72, 13.625, 13.64123012345, 40.123456789, 24,
        ]) {
          const match = await plan.matchGlyphRun(font, {
            text: "AA",
            style: { fontSize: size },
            transform: [1, 0, 0, 1, 32, 180],
          });
          later.push({
            size,
            status: match.status,
            evidence: match.evidence,
            ...(match.status === "matched"
              ? { settings: match.run.settings, css: match.run.request.css }
              : { reason: match.reason, settings: undefined, css: undefined }),
          });
        }
        plan.release();
        return {
          rows,
          later,
          modelUnchanged,
          retained,
          remaining: assets.fonts.size,
          privateFaces: [...document.fonts].filter((f) =>
            f.family.startsWith("CanoliGlyph_"),
          ).length,
        };
      } finally {
        for (const face of faces) document.fonts.delete(face);
        plan.release();
        assets.dispose();
      }
    },
    { bytes, references },
  );
  await writeFile(
    info.outputPath("optical-native-overrides.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    modelUnchanged: true,
    retained: 1,
    remaining: 0,
    privateFaces: 0,
  });
  for (const r of result.rows) {
    expect(r).toMatchObject({ status: "matched", error: 0 });
    expect(r.nativeAdvance).toBe(r.referenceAdvance);
    expect(r.settings).toContain('"opsz" ' + r.optical);
    expect(r.settings).toContain('"wght" ' + r.weight);
  }
  for (const r of result.later) {
    expect(r.status).toBe("matched");
    expect(r.css).toMatchObject({ opticalSize: r.size });
  }
});

test("automatic optical glyphs keep HDR RGB, ordered tiny alpha and exact Float32 window partitions", async ({
  page,
}, info) => {
  const bytes = [
      ...(await readFile("tests/fixtures/optical-font/Optical.woff2")),
    ],
    reference = [
      ...(await readFile("tests/fixtures/optical-font/opsz-40-wght-400.ttf")),
    ];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, reference }) => {
      const { captureStyledTextPlan } = (await import(
        /* @vite-ignore */ String("/src/engine/styled-text.ts")
      )) as typeof import("../src/engine/styled-text");
      const { AssetStore } = (await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      )) as typeof import("../src/core/assets");
      const { FloatPixelProcessor } = (await import(
        /* @vite-ignore */ String("/src/engine/float-pixels.ts")
      )) as typeof import("../src/engine/float-pixels");
      const { instantiateKernel } = (await import(
        /* @vite-ignore */ String("/src/engine/wasm.ts")
      )) as typeof import("../src/engine/wasm");
      const assets = new AssetStore(),
        doc = new window.luma.Document({ assets }),
        file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
        plan = await captureStyledTextPlan(
          {
            width: 160,
            height: 160,
            style: { fontFamily: file.family },
            lines: [{ spans: [{ text: "AA" }] }],
          },
          doc.toJSON(),
          assets,
        ),
        face = new FontFace(
          "IndependentOpticalFloat",
          new Uint8Array(reference).buffer,
        );
      await face.load();
      document.fonts.add(face);
      const native = new FloatPixelProcessor(
          await instantiateKernel(
            new Uint8Array(
              await (await fetch("/wasm/pixels.wasm")).arrayBuffer(),
            ),
          ),
        ),
        processor = {
          floatComposite: async (
            ...args: Parameters<typeof native.composite>
          ) => native.composite(...args),
        };
      try {
        const font = await plan.captureGlyphFont(file.id),
          match = await plan.matchGlyphRun(font, {
            text: "AA",
            style: { fontSize: 40, letterSpacing: -35, fontKerning: "none" },
            transform: [1, 0, 0, 1, 32, 120],
          });
        if (match.status !== "matched")
          return { status: match.status, rows: [] };
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 160;
        const c = canvas.getContext("2d")!;
        c.font = "40px " + face.family;
        c.fontKerning = "none";
        c.fillStyle = "#fff";
        const advance = c.measureText("A").width,
          coverage = [32, 32 + advance - 35].map((x) => {
            c.clearRect(0, 0, 160, 160);
            c.fillText("A", x, 120);
            return c.getImageData(0, 0, 160, 160).data;
          }),
          rows = [];
        for (const alpha of [0.5, 0.64123012345, 1e-8]) {
          const color = [4, -0.25, 1.5, alpha] as const,
            glyphs = match.glyphs.map((g) => ({ ...g, color })),
            area = { x: 0, y: 0, width: 160, height: 160 },
            full = await plan.renderGlyphs(glyphs, area, processor),
            parts = new Float32Array(full.length);
          let alphaError = 0,
            maxAlpha = 0,
            rgb: number[] = [];
          for (let i = 0; i < 160 * 160; i++) {
            const a = Math.fround(
                Math.fround(alpha) * Math.fround(coverage[0][i * 4 + 3] / 255),
              ),
              b = Math.fround(
                Math.fround(alpha) * Math.fround(coverage[1][i * 4 + 3] / 255),
              ),
              expected = Math.fround(b + a * (1 - b));
            alphaError = Math.max(
              alphaError,
              Math.abs(expected - full[i * 4 + 3]),
            );
            if (full[i * 4 + 3] > maxAlpha) {
              maxAlpha = full[i * 4 + 3];
              rgb = [...full.slice(i * 4, i * 4 + 3)];
            }
          }
          for (let x = 0; x < 160; x += 53) {
            const width = Math.min(53, 160 - x),
              part = await plan.renderGlyphs(
                glyphs,
                { ...area, x, width },
                processor,
              );
            for (let y = 0; y < 160; y++)
              parts.set(
                part.subarray(y * width * 4, (y + 1) * width * 4),
                (y * 160 + x) * 4,
              );
          }
          rows.push({
            alpha,
            alphaError,
            maxAlpha,
            rgb,
            partitions: new Uint32Array(full.buffer).every(
              (v, i) => v === new Uint32Array(parts.buffer)[i],
            ),
          });
        }
        return { status: match.status, settings: match.run.settings, rows };
      } finally {
        document.fonts.delete(face);
        plan.release();
        assets.dispose();
      }
    },
    { bytes, reference },
  );
  await writeFile(
    info.outputPath("optical-float-paint.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result.status).toBe("matched");
  expect(result.rows).toHaveLength(3);
  for (const r of result.rows) {
    expect(r.alphaError).toBe(0);
    expect(r.rgb).toEqual([4, -0.25, 1.5]);
    expect(r.maxAlpha).toBeGreaterThan(r.alpha);
    expect(r.partitions).toBe(true);
  }
});

test("a wrong optical instance or cancelled match cannot publish placements and a healthy retry succeeds", async ({
  page,
}, info) => {
  const bytes = [
    ...(await readFile("tests/fixtures/optical-font/Optical.ttf")),
  ];
  await page.goto("/");
  const result = await page.evaluate(async (bytes) => {
    const { captureStyledTextPlan } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { matchNativeGlyphRun } = (await import(
      /* @vite-ignore */ String("/src/engine/native-glyph-match.ts")
    )) as typeof import("../src/engine/native-glyph-match");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ assets }),
      file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
      plan = await captureStyledTextPlan(
        {
          width: 320,
          height: 160,
          style: { fontFamily: file.family },
          lines: [{ spans: [{ text: "AA" }] }],
        },
        doc.toJSON(),
        assets,
      );
    try {
      const font = await plan.captureGlyphFont(file.id),
        input = { text: "AA", style: { fontSize: 40 } },
        wrong = {
          ...font,
          shapeRun: (
            request: Parameters<typeof font.shapeRun>[0],
            control?: Parameters<typeof font.shapeRun>[1],
          ) =>
            font.shapeRun(
              { ...request, css: { ...request.css!, opticalSize: 8 } },
              control,
            ),
        },
        mismatch = await matchNativeGlyphRun(wrong, input),
        abort = new AbortController();
      let error = "";
      try {
        await plan.matchGlyphRun(font, input, {
          signal: abort.signal,
          check() {
            abort.abort(new Error("Expected optical cancellation"));
          },
        });
      } catch (e) {
        error = String(e);
      }
      const retry = await plan.matchGlyphRun(font, input);
      return {
        mismatch: {
          status: mismatch.status,
          hasPlacements: "glyphs" in mismatch,
        },
        error,
        retry: retry.status,
      };
    } finally {
      plan.release();
      assets.dispose();
    }
  }, bytes);
  await writeFile(
    info.outputPath("optical-refusal-retry.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toEqual({
    mismatch: { status: "mismatch", hasPlacements: false },
    error: "Error: Expected optical cancellation",
    retry: "matched",
  });
});

for (const fault of [
  "abort",
  "timeout",
  "tamper",
  "remove",
  "nonfinite",
] as const)
  test(
    "native size capture cleans up " +
      fault +
      " without source pixels and permits retry",
    async ({ page }, info) => {
      await page.goto("/");
      const result = await page.evaluate(async (fault) => {
        const { captureNativeTextSize } = (await import(
          /* @vite-ignore */ String("/src/engine/native-text-size.ts")
        )) as typeof import("../src/engine/native-text-size");
        const read = CanvasRenderingContext2D.prototype.getImageData,
          measure = CanvasRenderingContext2D.prototype.measureText,
          load = FontFace.prototype.load,
          abort = new AbortController();
        let triggered = false,
          error = "";
        CanvasRenderingContext2D.prototype.getImageData = function () {
          throw new Error("Size capture must not read pixels");
        };
        if (fault === "timeout")
          FontFace.prototype.load = function () {
            triggered = true;
            return new Promise<FontFace>(() => {});
          };
        if (fault === "nonfinite")
          CanvasRenderingContext2D.prototype.measureText = function (text) {
            triggered = true;
            return { ...measure.call(this, text), width: NaN } as TextMetrics;
          };
        try {
          try {
            await captureNativeTextSize(13.64123012345, {
              signal: abort.signal,
              timeoutMs: fault === "timeout" ? 25 : 1000,
              check() {
                const face = [...document.fonts].find((f) =>
                  f.family.startsWith("CanoliSize_"),
                );
                if (face && !triggered) {
                  triggered = true;
                  if (fault === "abort")
                    abort.abort(new Error("Expected native size abort"));
                  if (fault === "tamper") face.weight = "700";
                  if (fault === "remove") document.fonts.delete(face);
                }
              },
            });
          } catch (e) {
            error = String(e);
          }
          FontFace.prototype.load = load;
          CanvasRenderingContext2D.prototype.measureText = measure;
          const afterFailure = [...document.fonts].filter((f) =>
              f.family.startsWith("CanoliSize_"),
            ).length,
            size = await captureNativeTextSize(13.64123012345);
          return {
            error,
            triggered,
            afterFailure,
            size,
            afterRetry: [...document.fonts].filter((f) =>
              f.family.startsWith("CanoliSize_"),
            ).length,
          };
        } finally {
          CanvasRenderingContext2D.prototype.getImageData = read;
          CanvasRenderingContext2D.prototype.measureText = measure;
          FontFace.prototype.load = load;
        }
      }, fault);
      await writeFile(
        info.outputPath("native-size-" + fault + ".json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        triggered: true,
        afterFailure: 0,
        afterRetry: 0,
      });
      expect(result.size).toBeGreaterThan(0);
      expect(result.error).toContain(
        fault === "abort"
          ? "Expected native size abort"
          : fault === "timeout"
            ? "time budget"
            : fault === "nonfinite"
              ? "size is invalid"
              : "registration changed",
      );
    },
  );

for (const format of ["Regular.ttf", "CFF.otf"])
  test(
    "effective fractional native size also preserves a source without optical axes: " +
      format,
    async ({ page }, info) => {
      const bytes = [...(await readFile("tests/fixtures/fonts/" + format))];
      await page.goto("/");
      const result = await page.evaluate(async (bytes) => {
        const { captureStyledTextPlan } = (await import(
          /* @vite-ignore */ String("/src/engine/styled-text.ts")
        )) as typeof import("../src/engine/styled-text");
        const { AssetStore } = (await import(
          /* @vite-ignore */ String("/src/core/assets.ts")
        )) as typeof import("../src/core/assets");
        const assets = new AssetStore(),
          doc = new window.luma.Document({ assets }),
          file = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
          plan = await captureStyledTextPlan(
            {
              width: 512,
              height: 256,
              style: { fontFamily: file.family },
              lines: [{ spans: [{ text: "AA A" }] }],
            },
            doc.toJSON(),
            assets,
          ),
          rows = [];
        try {
          const font = await plan.captureGlyphFont(file.id);
          for (const size of [13.625, 13.64123012345, 40.123456789])
            for (const affine of [false, true]) {
              const match = await plan.matchGlyphRun(font, {
                text: "AA A",
                style: { fontSize: size },
                transform: affine
                  ? [1.25, 0.125, -0.25, 0.9, 32, 180]
                  : [1, 0, 0, 1, 32, 180],
              });
              rows.push({
                size,
                affine,
                status: match.status,
                evidence: match.evidence,
                ...(match.status === "matched"
                  ? { settings: match.run.settings }
                  : { reason: match.reason, settings: undefined }),
              });
            }
          return rows;
        } finally {
          plan.release();
          assets.dispose();
        }
      }, bytes);
      await writeFile(
        info.outputPath("native-fractional-size.json"),
        JSON.stringify(result, null, 2),
      );
      for (const row of result) {
        expect(row.status).toBe("matched");
        expect(row.evidence!.maxAlphaError).toBe(0);
        expect(row.settings).not.toContain("opsz");
      }
    },
  );
