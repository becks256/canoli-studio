import { test, expect } from "@playwright/test";

test("transformed vector masks with paint refinements and feather agree across export strips", async ({
  page,
}) => {
  await page.goto("/");
  const differences = await page.evaluate(async () => {
    const masksPath = "/src/engine/masks.ts",
      matrixPath = "/src/core/affine.ts";
    const { maskCoverage } = await import(masksPath);
    const { AffineTransform } = await import(matrixPath);
    const { editor, LayerMask, VectorPath, BrushStroke } = window.luma;
    const mask = new LayerMask({
      paths: [
        new VectorPath({
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 40 },
            { x: 0, y: 40 },
          ],
        }),
      ],
      feather: 6,
      strokes: [
        {
          mode: "hide",
          stroke: new BrushStroke({
            points: [
              { x: 20, y: 20, pressure: 1 },
              { x: 380, y: 20, pressure: 1 },
            ],
            size: 9,
            hardness: 0.6,
          }),
        },
      ],
    }).toJSON();
    const space = { x: 0, y: 0, width: 530, height: 90, sx: 1, sy: 1 };
    const world = new AffineTransform(1, 0.02, 0.5, 1, 5, 5);
    const full = await maskCoverage(
      mask,
      space,
      0,
      0,
      editor.renderer.processor,
      undefined,
      world,
    );
    const expected = full.getContext("2d")!.getImageData(0, 0, 530, 90).data;
    let max = 0,
      coverage = 0;
    for (let top = 0; top < 90; top += 17) {
      const height = Math.min(17, 90 - top);
      const tile = await maskCoverage(
        mask,
        { ...space, y: top, height },
        0,
        0,
        editor.renderer.processor,
        undefined,
        world,
      );
      const actual = tile
        .getContext("2d")!
        .getImageData(0, 0, 530, height).data;
      for (let i = 3; i < actual.length; i += 4) {
        max = Math.max(max, Math.abs(actual[i] - expected[top * 530 * 4 + i]));
        coverage += actual[i];
      }
      tile.width = 0;
    }
    full.width = 0;
    return { max, coverage };
  });
  expect(differences.max).toBeLessThanOrEqual(1);
  expect(differences.coverage).toBeGreaterThan(0);
});

test("affine paint clips in local coordinates and incremental strokes match full replay", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const drawingPath = "/src/engine/drawing.ts",
      matrixPath = "/src/core/affine.ts";
    const { drawPaint, ActiveStrokeRaster } = await import(drawingPath);
    const { AffineTransform } = await import(matrixPath);
    const { editor, PaintLayer, BrushStroke, MarqueeSelection } = window.luma;
    const assetPath = "/src/core/assets.ts";
    const { AssetStore } = await import(assetPath);
    const assets = new AssetStore();
    const layer = new PaintLayer();
    const clip = new MarqueeSelection({
      shape: "rectangle",
      x: 0,
      y: 0,
      width: 15,
      height: 30,
    });
    const points = [
      { x: 5, y: 5, pressure: 1 },
      { x: 10, y: 12, pressure: 0.8 },
      { x: 22, y: 20, pressure: 1 },
    ];
    const stroke = new BrushStroke({
      points,
      size: 12,
      hardness: 0.5,
      opacity: 0.7,
      color: "#8040c0",
      clip,
    });
    layer.strokes.add(stroke);
    const data = layer.toJSON();
    if (data.kind !== "paint") throw new Error("Expected paint layer");
    const world = new AffineTransform(0, 1, -1, 0.3, 50, 10);
    const space = { x: 0, y: 0, width: 80, height: 80, sx: 1, sy: 1 };
    const full = document.createElement("canvas"),
      incremental = document.createElement("canvas");
    full.width = incremental.width = 80;
    full.height = incremental.height = 80;
    const active = new ActiveStrokeRaster();
    try {
      for (const length of [2, 3]) {
        incremental.getContext("2d")!.clearRect(0, 0, 80, 80);
        await drawPaint(
          {
            ...data,
            strokes: [{ ...data.strokes[0], points: points.slice(0, length) }],
          },
          assets,
          incremental,
          space,
          world,
          editor.renderer.processor,
          active,
        );
      }
      await drawPaint(
        data,
        assets,
        full,
        space,
        world,
        editor.renderer.processor,
      );
      const a = full.getContext("2d")!.getImageData(0, 0, 80, 80).data;
      const b = incremental.getContext("2d")!.getImageData(0, 0, 80, 80).data;
      let max = 0,
        coverage = 0,
        outside = 0;
      for (let y = 0; y < 80; y++)
        for (let x = 0; x < 80; x++) {
          const i = (y * 80 + x) * 4;
          for (let c = 0; c < 4; c++)
            max = Math.max(max, Math.abs(a[i + c] - b[i + c]));
          coverage += a[i + 3];
          const local = world.inverse().point({ x: x + 0.5, y: y + 0.5 });
          if (local.x < -1 || local.x > 16 || local.y < -1 || local.y > 31)
            outside += a[i + 3];
        }
      return { max, coverage, outside, appended: active.appendedPoints };
    } finally {
      active.clear();
    }
  });
  expect(result.max).toBe(0);
  expect(result.coverage).toBeGreaterThan(0);
  expect(result.outside).toBe(0);
  expect(result.appended).toBe(3);
});

test("internal vector and text drawing applies full matrices and transformed culling", async ({
  page,
}) => {
  await page.goto("/");
  const differences = await page.evaluate(async () => {
    const drawingPath = "/src/engine/drawing.ts",
      matrixPath = "/src/core/affine.ts";
    const { drawVectors, drawText } = await import(drawingPath);
    const { AffineTransform } = await import(matrixPath);
    const { VectorLayer, VectorPath, TextLayer } = window.luma;
    const space = { x: 0, y: 0, width: 160, height: 160, sx: 1, sy: 1 };
    const vectorLayer = new VectorLayer();
    vectorLayer.paths.add(
      new VectorPath({
        closed: true,
        fill: "#c04080",
        stroke: null,
        points: [
          { x: 300, y: 10 },
          { x: 340, y: 10 },
          { x: 300, y: 40 },
        ],
      }),
    );
    const vector = vectorLayer.toJSON();
    const text = new TextLayer({
      text: "Matrix",
      fontSize: 20,
      fontFamily: "sans-serif",
      color: "#4080c0",
    }).toJSON();
    const differences = [];
    for (const kind of ["vector", "text"]) {
      const actual = document.createElement("canvas"),
        expected = document.createElement("canvas");
      actual.width = expected.width = 160;
      actual.height = expected.height = 160;
      const world =
        kind === "vector"
          ? new AffineTransform(0, 1, -1, 0.5, 90, -280)
          : new AffineTransform(-1, 0.2, 0.3, 1, 110, 30);
      const context = expected.getContext("2d")!;
      context.setTransform(
        world.a,
        world.b,
        world.c,
        world.d,
        world.e,
        world.f,
      );
      if (kind === "vector") {
        drawVectors(vector, actual, space, world);
        context.beginPath();
        context.moveTo(300, 10);
        context.lineTo(340,10);
        context.lineTo(300,40);
        context.lineTo(300,10);
        context.closePath();
        context.fillStyle = "#c04080";
        context.fill();
      } else {
        drawText(text, actual, space, world);
        context.font = "20px sans-serif";
        context.fillStyle = "#4080c0";
        context.textBaseline = "top";
        context.fillText("Matrix", 0, 0);
      }
      const a = actual.getContext("2d")!.getImageData(0, 0, 160, 160).data;
      const b = context.getImageData(0, 0, 160, 160).data;
      let max = 0,
        coverage = 0;
      for (let i = 0; i < a.length; i++) {
        max = Math.max(max, Math.abs(a[i] - b[i]));
        if (i % 4 === 3) coverage += a[i];
      }
      differences.push({ kind, max, coverage });
    }
    return differences;
  });
  console.log(differences);
  for (const result of differences) {
    expect(result.max).toBe(0);
    expect(result.coverage).toBeGreaterThan(0);
  }
});

test("internal affine raster drawing preserves source pixels and tone tile placement", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rendererPath = "/src/engine/renderer.ts",
      affinePath = "/src/core/affine.ts";
    const assetPath = "/src/core/assets.ts",
      modelPath = "/src/core/model.ts";
    const { CanvasRenderer } = await import(rendererPath);
    const { AffineTransform } = await import(affinePath);
    const { AssetStore } = await import(assetPath);
    const { createRaster } = await import(modelPath);
    const assets = new AssetStore(),
      renderer = new CanvasRenderer();
    const source = document.createElement("canvas");
    source.width = 8;
    source.height = 4;
    const sourceContext = source.getContext("2d")!;
    sourceContext.fillStyle = "#802040";
    sourceContext.fillRect(0, 0, 4, 4);
    sourceContext.fillStyle = "#208060";
    sourceContext.fillRect(4, 0, 4, 2);
    const blob = await new Promise<Blob>((resolve) =>
      source.toBlob((value) => resolve(value!)),
    );
    const asset = await assets.add(blob, "fixture", undefined, false);
    const layer = createRaster("fixture", asset.id, 1200, 12);
    const results = [];
    try {
      for (const coefficients of [
        [1, 0, 0.5, 1, 12, 5],
        [-1, 0, 0, 1, 1220, 5],
        [0, 1, -1, 0, 24, 5],
      ]) {
        for (const toned of [false, true]) {
          const canvas = document.createElement("canvas"),
            expected = document.createElement("canvas");
          canvas.width = expected.width = 1240;
          canvas.height = expected.height = 1240;
          const space = { x: 0, y: 0, width: 1240, height: 1240, sx: 1, sy: 1 };
          layer.effects = toned
            ? [
                {
                  id: "tone",
                  kind: "tone",
                  enabled: true,
                  exposure: 0.5,
                  contrast: 0.1,
                  saturation: -0.2,
                },
              ]
            : [];
          // Exercise the internal raster boundary before general matrices enter the document schema.
          await renderer.raster(
            layer,
            assets,
            canvas,
            space,
            new AffineTransform(...coefficients),
          );
          const context = expected.getContext("2d")!;
          context.setTransform(
            coefficients[0],
            coefficients[1],
            coefficients[2],
            coefficients[3],
            coefficients[4],
            coefficients[5],
          );
          context.drawImage(asset.bitmap, 0, 0, 1200, 12);
          const expectedPixels = context.getImageData(0, 0, 1240, 1240).data;
          const reference = toned
            ? await renderer.processor.process(expectedPixels, layer.effects)
            : expectedPixels;
          const actual = canvas
            .getContext("2d")!
            .getImageData(0, 0, 1240, 1240).data;
          // Canvas round-trips premultiplied channels when processed pixels are written back.
          let alpha = 0,
            premultiplied = 0;
          for (let i = 0; i < actual.length; i += 4) {
            alpha = Math.max(alpha, Math.abs(actual[i + 3] - reference[i + 3]));
            for (let c = 0; c < 3; c++)
              premultiplied = Math.max(
                premultiplied,
                Math.abs(
                  actual[i + c] * actual[i + 3] -
                    reference[i + c] * reference[i + 3],
                ) / 255,
              );
          }
          results.push({ alpha, premultiplied });
          canvas.width = expected.width = 0;
        }
      }
      return {
        results,
        sourcePreserved:
          asset.blob === blob &&
          asset.bitmap.width === 8 &&
          asset.bitmap.height === 4,
      };
    } finally {
      renderer.dispose();
    }
  });
  expect(results.sourcePreserved).toBe(true);
  expect(results.results).toHaveLength(6);
  for (const result of results.results) {
    expect(result.alpha).toBeLessThanOrEqual(1);
    expect(result.premultiplied).toBeLessThanOrEqual(1);
  }
});
