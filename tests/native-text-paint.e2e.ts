import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("tracked native item fields retain independent source glyph coverage, HDR, tiny alpha and every partition word", async ({
  page,
}, info) => {
  test.setTimeout(240000);
  const source = await readFile("tests/fixtures/shaping-font/Shaping.ttf"),
    reference = await readFile(
      "tests/fixtures/vertical-glyph/Shaping-glyphs.ttf",
    ),
    manifest = JSON.parse(
      await readFile("tests/fixtures/vertical-glyph/manifest.json", "utf8"),
    ) as {
      sourceSha256: string;
      referenceSha256: string;
      referenceSelectorBase: number;
      featuresDisabled: string[];
    };
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    manifest.sourceSha256,
  );
  expect(createHash("sha256").update(reference).digest("hex")).toBe(
    manifest.referenceSha256,
  );
  await page.goto("/");
  const rows = await page.evaluate(
    async ({ source, reference, manifest }) => {
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
        file = await doc.fonts.embed(new Blob([new Uint8Array(source)])),
        before = JSON.stringify(doc.toJSON()),
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
          node = document.createElementNS(ns, "text"),
          m = g.transform;
        style.textContent = `@font-face{font-family:IndependentTrackedItem;src:url("${data}");font-style:normal;font-weight:400;}`;
        defs.append(style);
        root.append(defs, group);
        group.setAttribute(
          "transform",
          `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`,
        );
        node.setAttribute("x", String(g.origin?.x ?? 0));
        node.setAttribute("y", String(g.origin?.y ?? 0));
        node.setAttribute("fill", "#fff");
        node.setAttribute("direction", "ltr");
        if (g.rotation !== undefined)
          node.setAttribute("rotate", String(g.rotation));
        node.style.cssText = `font-family:IndependentTrackedItem;font-size:${g.paintFontSize ?? g.style.fontSize}px;font-style:normal;font-weight:400;font-kerning:none;font-variant-caps:normal;letter-spacing:${g.paintLetterSpacing ?? 0}px;word-spacing:0px;white-space:pre;font-feature-settings:${manifest.featuresDisabled.map((tag) => JSON.stringify(tag) + " 0").join(",")}`;
        const value = String.fromCodePoint(
          manifest.referenceSelectorBase + g.glyphId,
        );
        if (g.path) {
          const path = document.createElementNS(ns, "path"),
            content = document.createElementNS(ns, "textPath");
          path.setAttribute("id", "independent-item-path");
          path.setAttribute("d", g.path.data);
          defs.append(path);
          node.setAttribute("x", "0");
          node.setAttribute("y", "0");
          node.setAttribute("dy", String(g.path.baselineOffset));
          if (g.origin)
            node.setAttribute(
              "transform",
              `translate(${g.origin.x} ${g.origin.y})`,
            );
          content.setAttribute("href", "#independent-item-path");
          content.setAttribute("startOffset", String(g.path.startOffset));
          content.setAttribute("method", "align");
          content.setAttribute("spacing", "exact");
          content.textContent = value;
          node.append(content);
        } else node.textContent = value;
        group.append(node);
        const result = new Uint8Array(512 * 512),
          canvas = document.createElement("canvas");
        canvas.width = canvas.height = 260;
        const context = canvas.getContext("2d")!;
        // The canonical world lattice is part of the native sampling contract.
        // Original FontTools source glyphs and independently authored SVG provide
        // coverage; no engine selector compiler or coverage painter is used here.
        for (const y of [0, 256])
          for (const x of [0, 256]) {
            root.setAttribute("width", "260");
            root.setAttribute("height", "260");
            root.setAttribute("viewBox", `${x - 2} ${y - 2} 260 260`);
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
                  reject(new Error("Independent tracked source glyph failed"));
                image.src = url;
              });
              await image.decode();
              context.clearRect(0, 0, 260, 260);
              context.drawImage(image, 0, 0);
              const bytes = context.getImageData(2, 2, 256, 256).data;
              for (let row = 0; row < 256; row++)
                for (let column = 0; column < 256; column++)
                  result[(y + row) * 512 + x + column] =
                    bytes[(row * 256 + column) * 4 + 3];
            } finally {
              image.src = "";
              URL.revokeObjectURL(url);
            }
          }
        return result;
      };
      try {
        for (const text of ["בבאב", "ببאב", "AV ببلا fi"])
          for (const alpha of [0.5, 0.64123012345, 1e-8]) {
            const plan = await captureStyledTextPlan(
              {
                width: 512,
                height: 512,
                style: {
                  fontFamily: file.family,
                  fontSize: 40,
                  letterSpacing: -30,
                  color: `color(srgb-linear 4 -.25 1.5 / ${alpha})`,
                },
                lines: [
                  {
                    x: 220,
                    y: 160,
                    direction: "rtl",
                    align: "center",
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
                    spans: [{ text }],
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
                rows.push({
                  text,
                  alpha,
                  status: match.status,
                  evidence: match.evidence,
                });
                continue;
              }
              const expected = new Float32Array(512 * 512);
              let tracked = 0;
              for (const glyph of match.glyphs) {
                if (glyph.paintLetterSpacing) tracked++;
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
              const invalidErrors: string[] = [];
              let invalidProcessorCalls = 0;
              const guarded = {
                floatComposite: async (
                  ...args: Parameters<typeof native.composite>
                ) => {
                  invalidProcessorCalls++;
                  return native.composite(...args);
                },
              };
              for (const broken of [
                { ...match.glyphs[0], paintLetterSpacing: NaN },
                {
                  ...match.glyphs[0],
                  surface: undefined,
                  path: undefined,
                  rotation: undefined,
                  writing: undefined,
                  baseline: undefined,
                  paintLetterSpacing: 0,
                },
              ]) {
                try {
                  await plan.renderGlyphs([broken], area, guarded);
                  invalidErrors.push("Unexpected success");
                } catch (error) {
                  invalidErrors.push(String(error));
                }
              }
              rows.push({
                text,
                alpha,
                status: match.status,
                evidence: match.evidence,
                tracked,
                alphaError,
                rgbError,
                ink,
                invalidErrors,
                invalidProcessorCalls,
                unchanged: JSON.stringify(doc.toJSON()) === before,
                partitions: new Uint32Array(full.buffer).every(
                  (value, index) =>
                    value === new Uint32Array(parts.buffer)[index],
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
    { source: [...source], reference: [...reference], manifest },
  );
  await writeFile(
    info.outputPath("native-text-reference-float.json"),
    JSON.stringify(rows, null, 2),
  );
  expect(rows).toHaveLength(9);
  for (const row of rows) {
    expect(row).toMatchObject({
      status: "matched",
      alphaError: 0,
      rgbError: 0,
      unchanged: true,
      partitions: true,
      invalidProcessorCalls: 0,
    });
    if (!("tracked" in row))
      throw new Error("The tracked source fixture did not match.");
    if (row.text === "בבאב") expect(row.tracked).toBe(0);
    else expect(row.tracked).toBeGreaterThan(0);
    expect(row.ink).toBeGreaterThan(0);
    expect(row.invalidErrors).toHaveLength(2);
    for (const error of row.invalidErrors!)
      expect(error).toContain("Invalid native glyph paint placement");
  }
});
