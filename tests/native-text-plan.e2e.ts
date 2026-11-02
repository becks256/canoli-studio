import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("native text plans retain whole shaping chunks, exact linear colors and original addressable geometry without reading pixels", async ({
  page,
}, info) => {
  await page.goto("/developer/api.html");
  const result = await page.evaluate(async () => {
    const { captureStyledTextPlan } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const { Document } = (await import(
      /* @vite-ignore */ String("/src/dom/index.ts")
    )) as typeof import("../src/dom/index");
    const assets = new AssetStore(),
      doc = new Document({ assets, width: 500, height: 200 }),
      results = [];
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      throw new Error("Plan source cannot read pixels");
    };
    try {
      for (const value of ["MM", "AVffi", "a\u0301a", "لاسلام", "क्षि", "👩‍💻"])
        for (const spacing of [0, -45]) {
          const input = {
            width: 500,
            height: 200,
            style: {
              fontFamily: "serif",
              fontSize: 80,
              letterSpacing: spacing,
              color: "color(srgb-linear 4 -.25 1.5 / .00000001)",
            },
            lines: [{ x: 120, y: 120, spans: [{ text: value }] }],
          };
          const plan = await captureStyledTextPlan(
            input,
            doc.toJSON(),
            assets,
            { captureLinearPaint: true },
          );
          try {
            const ns = "http://www.w3.org/2000/svg",
              svg = document.createElementNS(ns, "svg"),
              text = document.createElementNS(ns, "text"),
              span = document.createElementNS(ns, "tspan");
            svg.setAttribute("width", "500");
            svg.setAttribute("height", "200");
            text.setAttribute("x", "120");
            text.setAttribute("y", "120");
            text.setAttribute("direction", "ltr");
            text.style.whiteSpace = "pre";
            span.textContent = value;
            span.style.cssText = `font:normal 400 80px serif;letter-spacing:${spacing}px;word-spacing:0px;font-kerning:auto;font-variant-caps:normal;font-stretch:normal;font-variation-settings:normal`;
            text.append(span);
            svg.append(text);
            document.body.append(svg);
            try {
              const expected = Array.from(
                { length: text.getNumberOfChars() },
                (_, index) => {
                  const a = text.getStartPositionOfChar(index),
                    b = text.getEndPositionOfChar(index),
                    box = text.getExtentOfChar(index);
                  return {
                    index,
                    start: { x: a.x, y: a.y },
                    end: { x: b.x, y: b.y },
                    extent: {
                      x: box.x,
                      y: box.y,
                      width: box.width,
                      height: box.height,
                    },
                    rotation: text.getRotationOfChar(index),
                  };
                },
              );
              const parsed = new DOMParser().parseFromString(
                plan.markup,
                "image/svg+xml",
              );
              results.push({
                value,
                spacing,
                exact:
                  JSON.stringify(expected) ===
                  JSON.stringify(plan.paint!.characters[0]),
                colors: plan.paint!.colors[0],
                spans: parsed.querySelectorAll("tspan").length,
                text: parsed.querySelector("text")!.textContent,
                frozen:
                  Object.isFrozen(plan.paint) &&
                  Object.isFrozen(plan.paint!.colors[0]) &&
                  plan.paint!.characters[0].every(
                    (item) =>
                      Object.isFrozen(item) && Object.isFrozen(item.extent),
                  ),
              });
            } finally {
              svg.remove();
            }
          } finally {
            plan.release();
          }
        }
      return {
        results,
        probes: document.querySelectorAll(
          "[data-canoli-styled-text-probe],[data-canoli-float-text-color-probe]",
        ).length,
      };
    } finally {
      CanvasRenderingContext2D.prototype.getImageData = read;
      assets.dispose();
    }
  });
  expect(result.probes).toBe(0);
  expect(result.results).toHaveLength(12);
  for (const entry of result.results) {
    expect(entry).toMatchObject({
      exact: true,
      spans: 1,
      text: entry.value,
      frozen: true,
    });
    expect(entry.colors).toEqual([[4, -0.25, 1.5, Math.fround(1e-8)]]);
  }
  await writeFile(
    info.outputPath("whole-native-text-plan.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native plans snapshot authored text and retain exact variable font ownership after model and history removal", async ({
  page,
}, info) => {
  const source = await readFile("tests/fixtures/font-variations/Axes.ttf");
  await page.goto("/");
  const result = await page.evaluate(
    async (source) => {
      const { captureStyledTextPlan } = (await import(
        /* @vite-ignore */ String("/src/engine/styled-text.ts")
      )) as typeof import("../src/engine/styled-text");
      const { AssetStore } = (await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      )) as typeof import("../src/core/assets");
      const assets = new AssetStore(),
        doc = new window.luma.Document({ assets, width: 320, height: 160 });
      try {
        const font = await doc.fonts.embed(new Blob([new Uint8Array(source)]));
        const input = {
          width: 320,
          height: 160,
          style: {
            fontFamily: font.family,
            fontSize: 40,
            fontVariationSettings: '"TEST" 50,"wght" 600',
            color: "#2468ac",
          },
          lines: [{ x: 12, y: 80, spans: [{ text: "AAAA" }] }],
        };
        const pending = captureStyledTextPlan(input, doc.toJSON(), assets, {
          captureLinearPaint: true,
        });
        input.lines[0].spans[0].text = "CHANGED";
        input.style.fontVariationSettings = '"TEST" 0,"wght" 400';
        const plan = await pending;
        try {
          plan.retireMeasurement();
          plan.retireMeasurement();
          const retiredProbes = document.querySelectorAll(
            "[data-canoli-styled-text-probe]",
          ).length;
          font.remove();
          for (let i = 0; i < 65; i++) doc.name = "Plan lease " + i;
          plan.check();
          const retained = assets.fonts.size,
            markup = plan.markup,
            source = plan.scene.lines[0].spans[0];
          const beforeRelease = {
            text: source.text,
            axes: source.style.fontVariationSettings,
            retained,
            retiredProbes,
            definitions: markup.includes("data:font/"),
            familyOriginal: source.style.fontFamily === input.style.fontFamily,
          };
          plan.release();
          plan.release();
          const errors = [];
          for (const read of [() => plan.check(), () => plan.markup])
            try {
              read();
              errors.push("Unexpected success");
            } catch (error) {
              errors.push(String(error));
            }
          return {
            ...beforeRelease,
            remaining: assets.fonts.size,
            errors,
            probes: document.querySelectorAll("[data-canoli-styled-text-probe]")
              .length,
          };
        } finally {
          plan.release();
        }
      } finally {
        assets.dispose();
      }
    },
    [...source],
  );
  expect(result).toMatchObject({
    text: "AAAA",
    axes: '"TEST" 50,"wght" 600',
    retained: 1,
    retiredProbes: 0,
    definitions: true,
    familyOriginal: true,
    remaining: 0,
    probes: 0,
  });
  expect(result.errors.every((error) => error.includes("released"))).toBe(true);
  await writeFile(
    info.outputPath("native-plan-font-owner.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const fault of ["abort", "retire", "nonfinite"] as const)
  test(`native text plan cleans up failed ${fault} geometry capture and permits retry`, async ({
    page,
  }, info) => {
    const bytes = await readFile("tests/fixtures/fonts/Regular.ttf");
    await page.goto("/");
    const result = await page.evaluate(
      async ({ bytes, fault }) => {
        const { captureStyledTextPlan } = (await import(
          /* @vite-ignore */ String("/src/engine/styled-text.ts")
        )) as typeof import("../src/engine/styled-text");
        const { AssetStore } = (await import(
          /* @vite-ignore */ String("/src/core/assets.ts")
        )) as typeof import("../src/core/assets");
        const assets = new AssetStore(),
          doc = new window.luma.Document({ assets, width: 320, height: 160 }),
          abort = new AbortController();
        const original = SVGTextContentElement.prototype.getStartPositionOfChar;
        let triggered = false;
        try {
          const font = await doc.fonts.embed(new Blob([new Uint8Array(bytes)])),
            input = {
              width: 320,
              height: 160,
              style: { fontFamily: font.family },
              lines: [{ x: 12, y: 80, spans: [{ text: "AAAA" }] }],
            };
          SVGTextContentElement.prototype.getStartPositionOfChar = function (
            index,
          ) {
            const point = original.call(this, index);
            if (!triggered) {
              triggered = true;
              if (fault === "abort")
                abort.abort(new Error("Expected plan cancellation"));
              if (fault === "retire")
                document
                  .querySelector("[data-canoli-styled-text-probe]")!
                  .remove();
              if (fault === "nonfinite")
                return { x: Infinity, y: point.y } as SVGPoint;
            }
            return point;
          };
          let error = "Unexpected success";
          try {
            const plan = await captureStyledTextPlan(
              input,
              doc.toJSON(),
              assets,
              { captureLinearPaint: true, signal: abort.signal },
            );
            plan.release();
          } catch (value) {
            error = String(value);
          }
          SVGTextContentElement.prototype.getStartPositionOfChar = original;
          const retry = await captureStyledTextPlan(
            input,
            doc.toJSON(),
            assets,
            { captureLinearPaint: true },
          );
          retry.check();
          const characters = retry.paint!.characters[0].length;
          retry.release();
          font.remove();
          for (let i = 0; i < 65; i++) doc.name = "Plan cleanup " + i;
          return {
            error,
            triggered,
            characters,
            remaining: assets.fonts.size,
            probes: document.querySelectorAll(
              "[data-canoli-styled-text-probe],[data-canoli-float-text-color-probe]",
            ).length,
          };
        } finally {
          SVGTextContentElement.prototype.getStartPositionOfChar = original;
          assets.dispose();
        }
      },
      { bytes: [...bytes], fault },
    );
    expect(result).toMatchObject({
      triggered: true,
      characters: 4,
      remaining: 0,
      probes: 0,
    });
    expect(result.error).toContain(
      fault === "abort"
        ? "Expected plan cancellation"
        : fault === "retire"
          ? "removed"
          : "geometry is invalid",
    );
    await writeFile(
      info.outputPath("native-plan-" + fault + ".json"),
      JSON.stringify(result, null, 2),
    );
  });

test("ordinary native text rasterization keeps linear color and character metadata work optional", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { prepareStyledTextSurface } = (await import(
      /* @vite-ignore */ String("/src/engine/styled-text.ts")
    )) as typeof import("../src/engine/styled-text");
    const { AssetStore } = (await import(
      /* @vite-ignore */ String("/src/core/assets.ts")
    )) as typeof import("../src/core/assets");
    const assets = new AssetStore(),
      doc = new window.luma.Document({ assets, width: 320, height: 160 }),
      geometry = SVGTextContentElement.prototype.getStartPositionOfChar,
      supports = CSS.supports;
    let metadataQueries = 0,
      colorQueries = 0;
    try {
      SVGTextContentElement.prototype.getStartPositionOfChar = function () {
        metadataQueries++;
        throw new Error("Ordinary rasterization must not query characters");
      };
      CSS.supports = ((...args: Parameters<typeof CSS.supports>) => {
        if (args.join(" ").includes("color(from")) {
          colorQueries++;
          return false;
        }
        return supports(...args);
      }) as typeof CSS.supports;
      const surface = await prepareStyledTextSurface(
        {
          width: 320,
          height: 160,
          style: { fontSize: 40, color: "#2468ac" },
          lines: [{ x: 12, y: 80, spans: [{ text: "office a\u0301" }] }],
        },
        doc.toJSON(),
        assets,
      );
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 160;
        const context = canvas.getContext("2d")!;
        context.drawImage(surface.bitmap, 0, 0);
        const painted = context
          .getImageData(0, 0, 320, 160)
          .data.some((v, i) => i % 4 === 3 && v > 0);
        return { painted, metadataQueries, colorQueries };
      } finally {
        surface.release();
      }
    } finally {
      SVGTextContentElement.prototype.getStartPositionOfChar = geometry;
      CSS.supports = supports;
      assets.dispose();
    }
  });
  expect(result).toEqual({
    painted: true,
    metadataQueries: 0,
    colorQueries: 0,
  });
  await writeFile(
    info.outputPath("ordinary-optional-work.json"),
    JSON.stringify(result, null, 2),
  );
});
