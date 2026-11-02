import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("original negative path allocation retains hidden combining clusters and signed anchors", async ({
  page,
}, info) => {
  const sources = await Promise.all(
    ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(
      async (name) => [...(await readFile("tests/fixtures/" + name))],
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
      fonts = [];
    for (const bytes of sources)
      fonts.push(await doc.fonts.embed(new Blob([new Uint8Array(bytes)])));
    const before = JSON.stringify(doc.toJSON()),
      rows = [];
    try {
      for (const orientation of ["mixed", "sideways"] as const)
        for (const direction of ["ltr", "rtl"] as const)
          for (const affine of [false, true]) {
            const scene: import("../src/engine/styled-text").StyledTextSceneInput =
                {
                  width: 512,
                  height: 512,
                  transform: affine
                    ? [1.25, 0.125, -0.25, 0.9, 15, 14]
                    : [1, 0, 0, 1, 0, 0],
                  style: {
                    fontFamily: fonts.map((font) => font.family).join(", "),
                    fontSize: 40,
                    letterSpacing: -30,
                  },
                  lines: [
                    {
                      x: 220,
                      y: 160,
                      direction,
                      align: "center" as const,
                      writing: { mode: "vertical-rl" as const, orientation },
                      spans: [{ text: "AV fi a\u0301" }],
                    },
                  ],
                },
              path = {
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
              straight = await captureStyledTextPlan(
                scene,
                doc.toJSON(),
                assets,
                { captureLinearPaint: true },
              ),
              curved = await captureStyledTextPlan(
                {
                  ...scene,
                  lines: scene.lines.map((line) => ({ ...line, path })),
                },
                doc.toJSON(),
                assets,
                { captureLinearPaint: true },
              );
            try {
              const allocation = curved.paint!.inlineAllocation![0];
              if (!allocation)
                throw new Error("Original signed allocation was withheld");
              const chars = straight.paint!.characters[0],
                extent =
                  Math.max(...chars.flatMap((c) => [c.start.y, c.end.y])) -
                  Math.min(...chars.flatMap((c) => [c.start.y, c.end.y])),
                root = new DOMParser().parseFromString(
                  curved.markup,
                  "image/svg+xml",
                );
              rows.push({
                orientation,
                direction,
                affine,
                anchorExtent: allocation.anchorExtent,
                characters: allocation.characters,
                layoutExtent:
                  allocation.layoutRange.max - allocation.layoutRange.min,
                referenceExtent: extent,
                frozen:
                  Object.isFrozen(allocation) &&
                  Object.isFrozen(allocation.characters) &&
                  allocation.characters.every(
                    (c) =>
                      Object.isFrozen(c) &&
                      Object.isFrozen(c.start) &&
                      Object.isFrozen(c.extent),
                  ),
                text: root.querySelector("text")!.textContent,
                spans: root.querySelectorAll("tspan").length,
                temporaryDefinitions: !!root.querySelector(
                  "#canoli-signed-inline-baseline",
                ),
              });
            } finally {
              straight.release();
              curved.release();
            }
          }
      return {
        rows,
        unchanged: JSON.stringify(doc.toJSON()) === before,
        probes: document.querySelectorAll(
          "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
        ).length,
      };
    } finally {
      assets.dispose();
    }
  }, sources);
  await writeFile(
    info.outputPath("native-signed-inline.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ unchanged: true, probes: 0 });
  expect(result.rows).toHaveLength(8);
  for (const row of result.rows) {
    expect(row).toMatchObject({
      frozen: true,
      text: "AV fi a\u0301",
      spans: 1,
      temporaryDefinitions: false,
    });
    expect(row.characters).toHaveLength(8);
    expect(row.characters[6].rotation).toBe(90);
    expect(row.characters[6].extent.width).toBeGreaterThan(0);
    expect(row.characters[7]).toMatchObject({ rotation: 90 });
    expect(Math.abs(row.layoutExtent - row.referenceExtent)).toBeLessThan(
      0.0001,
    );
    expect(Number.isFinite(row.anchorExtent)).toBe(true);
    if (!row.affine) expect(row.anchorExtent).toBe(38);
  }
});

for (const fault of ["abort", "remove", "nonfinite"] as const)
  test(
    "signed inline " + fault + " retires disposable source probes",
    async ({ page }, info) => {
      const bytes = [
        ...(await readFile("tests/fixtures/shaping-font/Shaping.ttf")),
      ];
      await page.goto("/");
      const result = await page.evaluate(
        async ({ bytes, fault }) => {
          const { AssetStore } = (await import(
            /* @vite-ignore */ String("/src/core/assets.ts")
          )) as typeof import("../src/core/assets");
          const { captureStyledTextPlan } = (await import(
            /* @vite-ignore */ String("/src/engine/styled-text.ts")
          )) as typeof import("../src/engine/styled-text");
          const assets = new AssetStore(),
            doc = new window.luma.Document({ assets }),
            font = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
            before = JSON.stringify(doc.toJSON()),
            abort = new AbortController(),
            get = SVGTextElement.prototype.getStartPositionOfChar;
          let triggered = false,
            error = "",
            published = false;
          SVGTextElement.prototype.getStartPositionOfChar = function (index) {
            const point = get.call(this, index);
            if (
              this.querySelector(
                'textPath[href="#canoli-signed-inline-baseline"]',
              )
            ) {
              triggered = true;
              if (fault === "abort")
                abort.abort(new Error("Expected signed inline abort"));
              else if (fault === "remove")
                document
                  .querySelector("[data-canoli-styled-text-probe]")!
                  .remove();
              else return { x: NaN, y: point.y } as DOMPoint;
            }
            return point;
          };
          try {
            try {
              const plan = await captureStyledTextPlan(
                {
                  width: 512,
                  height: 512,
                  style: {
                    fontFamily: font.family,
                    fontSize: 40,
                    letterSpacing: -30,
                  },
                  lines: [
                    {
                      writing: { mode: "vertical-rl", orientation: "mixed" },
                      path: {
                        points: [
                          {
                            x: 0,
                            y: 100,
                            in: { x: 0, y: 100 },
                            out: { x: 100, y: 100 },
                          },
                          {
                            x: 400,
                            y: 100,
                            in: { x: 300, y: 100 },
                            out: { x: 400, y: 100 },
                          },
                        ],
                        startOffset: 200,
                      },
                      spans: [{ text: "AV fi a\u0301" }],
                    },
                  ],
                },
                doc.toJSON(),
                assets,
                { captureLinearPaint: true, signal: abort.signal },
              );
              published = true;
              plan.release();
            } catch (value) {
              error = String(value);
            }
            return {
              triggered,
              error,
              published,
              probes: document.querySelectorAll(
                "[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]",
              ).length,
              unchanged: JSON.stringify(doc.toJSON()) === before,
            };
          } finally {
            SVGTextElement.prototype.getStartPositionOfChar = get;
            assets.dispose();
          }
        },
        { bytes, fault },
      );
      await writeFile(
        info.outputPath("native-signed-inline-" + fault + ".json"),
        JSON.stringify(result, null, 2),
      );
      expect(result).toMatchObject({
        triggered: true,
        published: false,
        probes: 0,
        unchanged: true,
      });
      expect(result.error).toContain(
        fault === "abort"
          ? "Expected signed inline abort"
          : fault === "remove"
            ? "host was removed"
            : "inline geometry is invalid",
      );
    },
  );
