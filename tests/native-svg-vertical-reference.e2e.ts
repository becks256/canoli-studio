import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("native vertical GPOS fields match independent FontTools glyph coverage and every Float32 word", async ({
  page,
}, info) => {
  const bytes = [
      ...(await readFile("tests/fixtures/shaping-font/Shaping.ttf")),
    ],
    reference = [
      ...(await readFile("tests/fixtures/vertical-glyph/Shaping-glyphs.ttf")),
    ],
    manifest = JSON.parse(
      await readFile("tests/fixtures/vertical-glyph/manifest.json", "utf8"),
    ) as { referenceSelectorBase: number; featuresDisabled: string[] };
  await page.goto("/");
  const rows = await page.evaluate(
    async ({ bytes, reference, manifest }) => {
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
        native = new FloatPixelProcessor(
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
        },
        data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(
            new Blob([new Uint8Array(reference)], { type: "font/ttf" }),
          );
        }),
        rows = [];
      const mask = async (
        g: import("../src/engine/float-glyph").FloatGlyph,
      ) => {
        const ns = "http://www.w3.org/2000/svg",
          root = document.createElementNS(ns, "svg"),
          defs = document.createElementNS(ns, "defs"),
          style = document.createElementNS(ns, "style"),
          group = document.createElementNS(ns, "g"),
          text = document.createElementNS(ns, "text"),
          m = g.transform;
        root.setAttribute("width", "512");
        root.setAttribute("height", "512");
        style.textContent = `@font-face{font-family:IndependentVerticalGlyph;src:url("${data}");font-weight:400;font-style:normal;}`;
        defs.append(style);
        root.append(defs, group);
        group.setAttribute(
          "transform",
          `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
        );
        text.setAttribute("x", String(g.origin?.x ?? 0));
        text.setAttribute("y", String(g.origin?.y ?? 0));
        text.setAttribute("fill", "#fff");
        if (g.rotation !== undefined)
          text.setAttribute("rotate", String(g.rotation));
        text.style.cssText = `font-family:IndependentVerticalGlyph;font-size:${g.paintFontSize ?? g.style.fontSize}px;font-weight:${g.style.fontWeight};font-style:${g.style.fontStyle};font-kerning:none;font-variant-caps:normal;letter-spacing:0px;word-spacing:0px;white-space:pre;writing-mode:${g.writing!.mode};text-orientation:${g.writing!.orientation};dominant-baseline:${g.baseline};font-feature-settings:${manifest.featuresDisabled.map((tag) => JSON.stringify(tag) + " 0").join(",")}`;
        const value = String.fromCodePoint(
          manifest.referenceSelectorBase + g.glyphId,
        );
        if (g.path) {
          const path = document.createElementNS(ns, "path"),
            content = document.createElementNS(ns, "textPath");
          path.setAttribute("id", "independent-baseline");
          path.setAttribute("d", g.path.data);
          defs.append(path);
          text.setAttribute("x", "0");
          text.setAttribute("y", "0");
          text.setAttribute("dx", String(g.path.baselineOffset));
          if (g.origin)
            text.setAttribute(
              "transform",
              `translate(${g.origin.x} ${g.origin.y})`,
            );
          content.setAttribute("href", "#independent-baseline");
          content.setAttribute("startOffset", String(g.path.startOffset));
          content.setAttribute("method", "align");
          content.setAttribute("spacing", "exact");
          content.textContent = value;
          text.append(content);
        } else text.textContent = value;
        group.append(text);
        const url = URL.createObjectURL(
            new Blob([new XMLSerializer().serializeToString(root)], {
              type: "image/svg+xml",
            }),
          ),
          image = new Image();
        try {
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () =>
              reject(new Error("Independent vertical reference failed"));
            image.src = url;
          });
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 512;
          const c = canvas.getContext("2d")!;
          c.drawImage(image, 0, 0);
          const rgba = c.getImageData(0, 0, 512, 512).data,
            alpha = new Uint8Array(512 * 512);
          for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
          return alpha;
        } finally {
          image.src = "";
          URL.revokeObjectURL(url);
        }
      };
      try {
        for (const curved of [false, true])
          for (const alpha of [0.5, 0.64123012345, 1e-8]) {
            const plan = await captureStyledTextPlan(
              {
                width: 512,
                height: 512,
                style: {
                  fontFamily: file.family,
                  fontSize: 40,
                  color: `color(srgb-linear 4 -.25 1.5 / ${alpha})`,
                },
                lines: [
                  {
                    x: 120,
                    y: 120,
                    writing: { mode: "vertical-rl", orientation: "upright" },
                    ...(curved
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
                    spans: [{ text: "a\u0301" }],
                  },
                ],
              },
              doc.toJSON(),
              assets,
              { captureLinearPaint: true },
            );
            try {
              const font = await plan.captureGlyphFont(file.id),
                match = await plan.matchGlyphLine(font, 0);
              if (match.status !== "matched") {
                rows.push({ curved, alpha, status: match.status });
                continue;
              }
              const expected = new Float32Array(512 * 512);
              for (const glyph of match.glyphs) {
                const coverage = await mask(glyph);
                for (let i = 0; i < expected.length; i++) {
                  const a = Math.fround(
                    Math.fround(alpha) * Math.fround(coverage[i] / 255),
                  );
                  expected[i] = a + expected[i] * (1 - a);
                }
              }
              const area = { x: 0, y: 0, width: 512, height: 512 },
                full = await plan.renderGlyphs(match.glyphs, area, processor),
                parts = new Float32Array(full.length);
              let alphaError = 0,
                rgbError = 0,
                ink = 0;
              for (let i = 0; i < expected.length; i++) {
                alphaError = Math.max(
                  alphaError,
                  Math.abs(full[i * 4 + 3] - expected[i]),
                );
                if (full[i * 4 + 3]) {
                  ink++;
                  rgbError = Math.max(
                    rgbError,
                    Math.abs(full[i * 4] - 4),
                    Math.abs(full[i * 4 + 1] + 0.25),
                    Math.abs(full[i * 4 + 2] - 1.5),
                  );
                }
              }
              for (let x = 0; x < 512; x += 137) {
                const width = Math.min(137, 512 - x),
                  part = await plan.renderGlyphs(
                    match.glyphs,
                    { ...area, x, width },
                    processor,
                  );
                for (let y = 0; y < 512; y++)
                  parts.set(
                    part.subarray(y * width * 4, (y + 1) * width * 4),
                    (y * 512 + x) * 4,
                  );
              }
              rows.push({
                curved,
                alpha,
                status: "matched",
                alphaError,
                rgbError,
                ink,
                nativeMetrics: match.evidence.nativeMetrics,
                glyphs: match.glyphs.map((g) => g.glyphId),
                partitions: new Uint32Array(full.buffer).every(
                  (v, i) => v === new Uint32Array(parts.buffer)[i],
                ),
              });
            } finally {
              plan.release();
            }
          }
        return rows;
      } finally {
        assets.dispose();
      }
    },
    { bytes, reference, manifest },
  );
  await writeFile(
    info.outputPath("native-vertical-reference-float.json"),
    JSON.stringify(rows, null, 2),
  );
  expect(rows).toHaveLength(6);
  for (const row of rows) {
    expect(row).toMatchObject({
      status: "matched",
      alphaError: 0,
      rgbError: 0,
      partitions: true,
      nativeMetrics: true,
      glyphs: [7, 8],
    });
    expect(row.ink!).toBeGreaterThan(0);
  }
});
