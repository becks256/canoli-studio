import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { ProjectiveFieldOptions } from "../src/core/projective-field";

for (const projected of [false, true])
  test(`bounded ${projected ? "perspective" : "identity"} wet composition matches a complete-canvas native-field control for every RGBA byte`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const rows = await page.evaluate(async (projected) => {
      const { AssetStore } = await import(
        /* @vite-ignore */ String("/src/core/assets.ts")
      );
      const { PixelProcessor } = await import(
        /* @vite-ignore */ String("/src/engine/processor.ts")
      );
      const { compositeWetPaint } = await import(
        /* @vite-ignore */ String("/src/engine/wet-composite.ts")
      );
      const { createCanvas, release } = await import(
        /* @vite-ignore */ String("/src/engine/canvas.ts")
      );
      const {
        WetPaintStroke,
        BrushStroke,
        PerspectiveTransform,
        AffineTransform,
      } = window.luma;
      const assets = new AssetStore(),
        processor = new PixelProcessor(),
        width = 520,
        height = 144,
        background = createCanvas(width, height),
        bg = background.getContext("2d")!,
        initial = bg.createImageData(width, height);
      for (let i = 0; i < width * height; i++) {
        const alpha = [0, 1, 31, 63, 127, 191, 255][i % 7];
        initial.data.set(
          [(i * 13) & 255, (i * 37) & 255, (i * 71) & 255, alpha],
          i * 4,
        );
      }
      bg.putImageData(initial, 0, 0);
      const sourcePng = async (
        w: number,
        h: number,
        alpha: number,
        coverage: boolean,
      ) => {
        const c = new OffscreenCanvas(w, h),
          ctx = c.getContext("2d")!,
          image = ctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++)
          image.data.set(
            coverage ? [0, 0, 0, alpha] : [201, 83, 47, alpha],
            i * 4,
          );
        ctx.putImageData(image, 0, 0);
        return (
          await assets.add(
            await c.convertToBlob(),
            "Composition source",
            undefined,
            false,
          )
        ).id;
      };
      const rows: {
        pattern: string;
        opacity: number;
        different: number;
        changed: number;
        convertedPixels: number;
        fullPixels: number;
        packets: number;
        rgbaSha256: string;
      }[] = [];
      try {
        for (const pattern of [
          "sparse",
          "border",
          "clear",
          "tiny",
          "empty",
          "dense",
        ]) {
          const w = pattern === "dense" ? width : pattern === "border" ? 40 : 8,
            h = pattern === "dense" ? height : 6,
            x = pattern === "dense" ? 0 : pattern === "border" ? 478 : 64,
            y = pattern === "dense" ? 0 : 32;
          const alpha =
              pattern === "clear" || pattern === "empty"
                ? 0
                : pattern === "tiny"
                  ? 1
                  : 151,
            coverageAlpha =
              pattern === "empty" ? 0 : pattern === "tiny" ? 1 : 211,
            outputId = await sourcePng(w, h, alpha, false),
            coverageId = await sourcePng(w, h, coverageAlpha, true);
          for (const opacity of [0.23, 0.5, 1]) {
            const stroke = new WetPaintStroke({
              brush: new BrushStroke({ points: [{ x: 64, y: 32 }], size: 8 }),
              opacity,
              nativeTransform: new AffineTransform(),
              placement: {
                width,
                height,
                perspective: new PerspectiveTransform({
                  corners: projected
                    ? [
                        { x: 0.02, y: 0.01 },
                        { x: 0.98, y: 0 },
                        { x: 0.9, y: 0.95 },
                        { x: 0.1, y: 1 },
                      ]
                    : [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                        { x: 1, y: 1 },
                        { x: 0, y: 1 },
                      ],
                }),
                basis: new AffineTransform(),
              },
              tiles: [
                {
                  x,
                  y,
                  width: w,
                  height: h,
                  assetId: outputId,
                  coverage: { assetId: coverageId },
                },
              ],
            });
            const target = createCanvas(width, height),
              raw = createCanvas(width, height, true),
              mask = createCanvas(width, height, true),
              replacement = createCanvas(width, height, true),
              native = processor.floatProjectiveWet.bind(processor),
              combined = new Float32Array(width * height * 5),
              allocations: { width: number; height: number }[] = [],
              create = CanvasRenderingContext2D.prototype.createImageData;
            let packets = 0;
            target.getContext("2d")!.drawImage(background, 0, 0);
            processor.floatProjectiveWet = async (
              p: Float32Array,
              options: ProjectiveFieldOptions,
            ) => {
              const value = await native(p, options),
                r = options.output;
              packets++;
              for (let row = 0; row < r.height; row++)
                combined.set(
                  value.subarray(row * r.width * 5, (row + 1) * r.width * 5),
                  ((r.y + row) * width + r.x) * 5,
                );
              return value;
            };
            CanvasRenderingContext2D.prototype.createImageData = function (
              this: CanvasRenderingContext2D,
              ...args: Parameters<CanvasRenderingContext2D["createImageData"]>
            ) {
              const value = create.apply(this, args);
              if (new Error().stack?.includes("/src/engine/projected-wet.ts"))
                allocations.push({ width: value.width, height: value.height });
              return value;
            } as CanvasRenderingContext2D["createImageData"];
            try {
              await compositeWetPaint(
                stroke.toJSON(),
                assets,
                target,
                { x: 0, y: 0, width, height, sx: 1, sy: 1 },
                new AffineTransform(),
                processor,
              );
              CanvasRenderingContext2D.prototype.createImageData = create;
              processor.floatProjectiveWet = native;
              // Complete-canvas control uses the actual returned native fields and the
              // existing Canvas removal/replacement operators, independent of ROI bounds.
              const c = raw.getContext("2d")!,
                m = mask.getContext("2d")!,
                p = replacement.getContext("2d")!,
                colors = p.createImageData(width, height),
                coverage = m.createImageData(width, height);
              c.drawImage(background, 0, 0);
              const before = c.getImageData(0, 0, width, height).data;
              for (let i = 0; i < width * height; i++) {
                const a = combined[i * 5 + 3],
                  at = i * 4;
                colors.data[at + 3] = Math.round(a * 255);
                coverage.data[at + 3] = Math.round(combined[i * 5 + 4] * 255);
                for (let k = 0; k < 3; k++)
                  colors.data[at + k] = a
                    ? Math.round((combined[i * 5 + k] / a) * 255)
                    : 0;
              }
              p.putImageData(colors, 0, 0);
              m.putImageData(coverage, 0, 0);
              c.globalCompositeOperation = "destination-out";
              c.drawImage(mask, 0, 0);
              c.globalCompositeOperation = "lighter";
              c.drawImage(replacement, 0, 0);
              const after = c.getImageData(0, 0, width, height).data;
              let expected: Uint8ClampedArray = after;
              if (opacity !== 1) {
                const amount = new Uint8ClampedArray(after.length);
                for (let i = 0; i < after.length; i += 4)
                  if (
                    before[i] !== after[i] ||
                    before[i + 1] !== after[i + 1] ||
                    before[i + 2] !== after[i + 2] ||
                    before[i + 3] !== after[i + 3]
                  )
                    amount[i + 3] = Math.round(opacity * 255);
                expected = await processor.mixFiltered(before, after, amount);
              }
              // Match the final Canvas storage round trip, including premultiplied
              // quantization of translucent pixels; the control still composes all pixels.
              const expectedCanvas = createCanvas(width, height);
              try {
                const ctx = expectedCanvas.getContext("2d")!,
                  image = ctx.createImageData(width, height);
                image.data.set(expected);
                ctx.putImageData(image, 0, 0);
                expected = ctx.getImageData(0, 0, width, height).data;
              } finally {
                release(expectedCanvas);
              }
              const actual = target
                .getContext("2d")!
                .getImageData(0, 0, width, height).data;
              let different = 0,
                changed = 0;
              for (let i = 0; i < actual.length; i++) {
                if (actual[i] !== expected[i]) different++;
                if (actual[i] !== before[i]) changed++;
              }
              const convertedPixels = allocations.reduce(
                  (n, v) => n + v.width * v.height,
                  0,
                ),
                fullPixels = width * height * (opacity === 1 ? 2 : 3),
                rgbaSha256 = [
                  ...new Uint8Array(
                    await crypto.subtle.digest("SHA-256", actual),
                  ),
                ]
                  .map((v) => v.toString(16).padStart(2, "0"))
                  .join("");
              rows.push({
                pattern,
                opacity,
                different,
                changed,
                convertedPixels,
                fullPixels,
                packets,
                rgbaSha256,
              });
            } finally {
              CanvasRenderingContext2D.prototype.createImageData = create;
              processor.floatProjectiveWet = native;
              release(target);
              release(raw);
              release(mask);
              release(replacement);
            }
          }
        }
        return rows;
      } finally {
        release(background);
        processor.dispose();
        assets.dispose();
      }
    }, projected);
    await writeFile(
      info.outputPath("native-composition.json"),
      JSON.stringify({ projected, rows }, null, 2),
    );
    expect(rows).toHaveLength(18);
    for (const row of rows) {
      expect(row.different, JSON.stringify(row)).toBe(0);
      expect(row.packets).toBeGreaterThan(0);
      if (row.pattern === "border") expect(row.packets).toBeGreaterThan(1);
      if (row.pattern === "empty") {
        expect(row.changed).toBe(0);
        expect(row.convertedPixels).toBe(0);
      } else {
        if (row.pattern === "tiny" && row.opacity === 0.23)
          expect(row.changed).toBe(0);
        else expect(row.changed).toBeGreaterThan(0);
        expect(row.convertedPixels).toBeGreaterThan(0);
        expect(row.convertedPixels).toBeLessThanOrEqual(row.fullPixels);
        if (row.pattern !== "dense")
          expect(row.convertedPixels).toBeLessThan(row.fullPixels / 4);
      }
    }
  });
