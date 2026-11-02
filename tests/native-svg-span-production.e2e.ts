import { test, expect } from "@playwright/test";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compileGlyphSelectors } from "../src/fonts/glyph-sfnt";
import { DEFAULT_CHARACTER_FORMAT } from "../src/core/character-format";

test("production original span allocation retains exact transformed RTL ink and color ownership", async ({
  page,
}, info) => {
  const source = new Uint8Array(
      await readFile("tests/fixtures/shaping-font/Shaping.ttf"),
    ),
    prepared = compileGlyphSelectors(source),
    files = await readdir("dist/assets");
  const select = (pattern: RegExp) => {
    const matches = files.filter((file) => pattern.test(file));
    expect(matches).toHaveLength(1);
    return matches[0];
  };
  const module = select(/^native-svg-styled-.*\.js$/),
    metricModule = select(/^native-svg-metrics-.*\.js$/),
    worker = select(/^font-shaping-worker-.*\.js$/),
    moduleBytes = await readFile("dist/assets/" + module);
  await page.goto("/");
  const result = await page.evaluate(
    async ({
      source,
      prepared,
      selectors,
      glyphCount,
      module,
      metricModule,
      worker,
      defaults,
    }) => {
      const namespace = async (name: string, member: string) => {
        const emitted = (await import(
          /* @vite-ignore */ "/assets/" + name
        )) as Record<string, unknown>;
        const api =
          typeof emitted[member] === "function"
            ? emitted
            : Object.values(emitted).find(
                (v) => v && typeof v === "object" && member in v,
              );
        if (!api) throw new Error("Missing emitted " + member);
        return api;
      };
      const matcher = (await namespace(
          module,
          "matchNativeStyledSvgLine",
        )) as typeof import("../src/engine/native-svg-styled"),
        metrics = (await namespace(
          metricModule,
          "captureNativeSvgMetrics",
        )) as typeof import("../src/engine/native-svg-metrics");
      const data = async (bytes: number[]) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(
            new Blob([new Uint8Array(bytes)], { type: "font/ttf" }),
          );
        });
      const originalData = await data(source),
        glyphData = await data(prepared),
        sourceFamily = "OriginalSpanProduction",
        family = "PreparedSpanProduction",
        original = new FontFace(sourceFamily, new Uint8Array(source).buffer),
        privateFace = new FontFace(family, new Uint8Array(prepared).buffer);
      await Promise.all([original.load(), privateFace.load()]);
      document.fonts.add(original);
      document.fonts.add(privateFace);
      const abort = new AbortController();
      let leases = 0;
      const check = () => {
        abort.signal.throwIfAborted();
        if (!document.fonts.has(original) || !document.fonts.has(privateFace))
          throw new Error("Production span sources retired");
      };
      const assets = {
        captureLifetime: () => check,
        fonts: {
          retain(id: string) {
            check();
            if (id !== "prepared-source")
              throw new Error("Unknown production span source");
            leases++;
            return {
              check,
              resource: {
                renderBlob: new Blob([new Uint8Array(source)]),
                descriptor: {
                  report: {
                    faces: [{ axes: [], unitsPerEm: 1000, glyphCount }],
                  },
                },
              },
              release() {
                leases--;
              },
            };
          },
        },
      } as unknown as import("../src/core/assets").AssetStore;
      const contexts: import("../src/fonts/shaping-types").FontRunInput[] = [],
        font = {
          axes: [],
          descriptors: [
            { style: "normal" as const, weight: "400", stretch: "100%" },
          ],
          sourceFamily,
          family,
          glyphCount,
          settings: "normal",
          monochrome: true,
          signal: abort.signal,
          check,
          release() {
            abort.abort();
            document.fonts.delete(privateFace);
          },
          character(id: number) {
            check();
            return String.fromCodePoint(selectors[id]);
          },
          async svgFont() {
            check();
            return {
              definitions: `<defs><style>@font-face{font-family:${family};src:url("${glyphData}");font-weight:400;font-style:normal;font-stretch:100%;}</style></defs>`,
              features: "normal",
            };
          },
          async svgMetrics(
            ids: readonly number[],
            style: import("../src/engine/native-svg-metrics").NativeSvgMetricsStyle,
            css: import("../src/fonts/css-instance").FontRunCss,
            size: number,
            control: import("../src/engine/native-glyph-font").NativeGlyphFontControl = {},
            projection: import("../src/engine/native-svg-metrics").NativeSvgMetricsRequest = {},
          ) {
            check();
            return metrics.captureNativeSvgMetrics(
              assets,
              "prepared-source",
              new Uint8Array(prepared),
              family,
              "normal",
              ids,
              ids.map((id) => String.fromCodePoint(selectors[id])),
              style,
              css,
              size,
              {
                ...control,
                check: () => {
                  check();
                  control.check?.();
                },
              },
              projection,
            );
          },
          async shapeRun(
            input: import("../src/fonts/shaping-types").FontRunInput,
          ) {
            check();
            contexts.push(input);
            const wire = await new Promise<{
              data: Float64Array;
              unitsPerEm: number;
              glyphCount: number;
            }>((resolve, reject) => {
              const w = new Worker("/assets/" + worker, { type: "module" }),
                timer = setTimeout(() => {
                  w.terminate();
                  reject(new Error("Production span shape timed out"));
                }, 10000);
              w.onerror = () => {
                clearTimeout(timer);
                w.terminate();
                reject(new Error("Production span worker failed"));
              };
              w.onmessage = (e) => {
                clearTimeout(timer);
                w.terminate();
                e.data?.error
                  ? reject(new Error(String(e.data.error)))
                  : resolve(e.data);
              };
              w.postMessage({
                bytes: new Uint8Array(source),
                input,
                settings: "normal",
                timeoutMs: 10000,
              });
            });
            check();
            if (
              !(wire.data instanceof Float64Array) ||
              wire.unitsPerEm !== 1000 ||
              wire.glyphCount !== glyphCount ||
              wire.data.length % 7
            )
              throw new Error("Invalid production span shape");
            return {
              version: 1 as const,
              engine: "HarfBuzz 15.0.0" as const,
              unitsPerEm: 1000,
              glyphCount,
              settings: "normal",
              request: {
                language: "und",
                direction: "ltr" as const,
                features: [],
                itemOffset: 0,
                itemLength: input.text.length,
                ...input,
              },
              glyphs: Array.from({ length: wire.data.length / 7 }, (_, i) => {
                const p = i * 7;
                return {
                  glyphId: wire.data[p],
                  cluster: wire.data[p + 1],
                  flags: wire.data[p + 2],
                  xAdvance: wire.data[p + 3],
                  yAdvance: wire.data[p + 4],
                  xOffset: wire.data[p + 5],
                  yOffset: wire.data[p + 6],
                };
              }),
            };
          },
        };
      const rows = [];
      try {
        for (const direction of ["ltr", "rtl"] as const)
          for (const affine of [false, true]) {
            const m = affine
                ? [1.25, 0.125, -0.25, 0.9, 15, 14]
                : [1, 0, 0, 1, 0, 0],
              style = {
                ...defaults,
                fontFamily: sourceFamily,
                fontSize: 40,
                letterSpacing: -30,
                fontKerning: "auto" as const,
              },
              spans = [
                { text: "AV ", style: { ...style, color: "#f00" } },
                { text: "a\u0301", style: { ...style, color: "#0f0" } },
                { text: " fi", style: { ...style, color: "#f00" } },
              ],
              line = {
                x: 220,
                y: 160,
                direction,
                align: "center" as const,
                wordSpacingDelta: 0,
                writing: {
                  mode: "vertical-rl" as const,
                  orientation: "mixed" as const,
                },
                spans,
              },
              markup = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><style>@font-face{font-family:${sourceFamily};src:url("${originalData}");font-weight:400;font-style:normal;}</style></defs><g transform="matrix(${m.join(" ")})"><text x="220" y="160" direction="${direction}" text-anchor="middle" style="white-space:pre;writing-mode:vertical-rl;text-orientation:mixed">${spans.map((span) => `<tspan fill="${span.style.color}" style="font-family:${sourceFamily};font-size:40px;font-weight:400;font-style:normal;font-kerning:auto;letter-spacing:-30px;word-spacing:0px">${span.text}</tspan>`).join("")}</text></g></svg>`,
              host = document.createElement("div");
            host.style.cssText =
              "position:fixed;left:-10000px;visibility:hidden";
            host.innerHTML = markup;
            document.body.append(host);
            try {
              const text = host.querySelector("text")!,
                box = text.getBBox(),
                characters = Array.from(
                  { length: text.getNumberOfChars() },
                  (_, index) => {
                    const a = text.getStartPositionOfChar(index),
                      b = text.getEndPositionOfChar(index),
                      rect = text.getExtentOfChar(index);
                    return {
                      index,
                      start: { x: a.x, y: a.y },
                      end: { x: b.x, y: b.y },
                      extent: {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                      },
                      rotation: text.getRotationOfChar(index),
                    };
                  },
                ),
                probe = text.cloneNode(true) as SVGTextElement;
              probe.setAttribute("x", "0");
              probe.setAttribute("y", "0");
              for (const span of probe.querySelectorAll("tspan")) {
                span.style.letterSpacing = "0px";
                span.style.wordSpacing = "0px";
                span.style.fontKerning = "none";
              }
              text.parentElement!.append(probe);
              let visual;
              try {
                visual = Array.from(
                  { length: probe.getNumberOfChars() },
                  (_, index) => {
                    const a = probe.getStartPositionOfChar(index),
                      b = probe.getEndPositionOfChar(index);
                    return {
                      order: Math.min(a.y, b.y),
                      direction:
                        b.y < a.y
                          ? ("rtl" as const)
                          : b.y > a.y
                            ? ("ltr" as const)
                            : null,
                      rotation: probe.getRotationOfChar(index),
                    };
                  },
                );
              } finally {
                probe.remove();
              }
              const plan = {
                scene: { width: 512, height: 512, transform: m, lines: [line] },
                metrics: [
                  {
                    advance: text.getComputedTextLength(),
                    ink: {
                      x: box.x,
                      y: box.y,
                      width: box.width,
                      height: box.height,
                    },
                  },
                ],
                paint: {
                  visual: [visual],
                  characters: [characters],
                  pathCharacters: [null],
                  colors: [
                    [
                      [1, 0, 0, 1],
                      [0, 1, 0, 1],
                      [1, 0, 0, 1],
                    ],
                  ],
                },
                markup,
                check,
                async captureGlyphFont() {
                  check();
                  return font;
                },
              } as unknown as import("../src/engine/styled-text").StyledTextPlan;
              const match = await matcher.matchNativeStyledSvgLine(plan, 0, [
                {
                  id: "prepared-source",
                  resource: {
                    report: { faces: [{ cssFamily: sourceFamily }] },
                  },
                },
              ] as import("../src/core/font-files").FontFileData[]);
              rows.push({
                direction,
                affine,
                status: match.status,
                evidence: match.evidence,
                ...(match.status === "matched"
                  ? {
                      glyphs: match.glyphs.map((g) => g.glyphId),
                      texts: match.runs!.map((r) => r.request.text),
                    }
                  : { reason: match.reason }),
              });
            } finally {
              host.remove();
            }
          }
        return {
          rows,
          leases,
          contexts: contexts.map((r) => r.text),
          developmentGlobal: "luma" in window,
          probes: document.querySelectorAll("[data-canoli-svg-glyph-probe]")
            .length,
        };
      } finally {
        font.release();
        document.fonts.delete(original);
      }
    },
    {
      source: [...source],
      prepared: [...prepared.bytes],
      selectors: [...prepared.selectors],
      glyphCount: prepared.glyphCount,
      module,
      metricModule,
      worker,
      defaults: DEFAULT_CHARACTER_FORMAT,
    },
  );
  expect(result).toMatchObject({
    leases: 0,
    developmentGlobal: false,
    probes: 0,
  });
  expect(result.rows).toHaveLength(4);
  for (const row of result.rows) {
    expect(row.status, JSON.stringify(row)).toBe("matched");
    expect(row.evidence).toMatchObject({
      svgMaxAlphaError: 0,
      paintOwnership: { error: 0, colors: 2 },
    });
    if ("texts" in row)
      for (const text of row.texts) expect(text).toBe("AV a\u0301 fi");
  }
  await writeFile(
    info.outputPath("production-source-spans.json"),
    JSON.stringify(
      {
        module,
        bytes: moduleBytes.length,
        sha256: createHash("sha256").update(moduleBytes).digest("hex"),
        metricModule,
        worker,
        scope:
          "Actual emitted native styled matcher, SVG metrics, calibration and shaping worker. Prepared complete original-font adapters; independent original native SVG spans in four direction/affine controls. Complete source capture, original priority and lifetime are checked separately in source browser tests.",
        result,
      },
      null,
      2,
    ),
  );
});
