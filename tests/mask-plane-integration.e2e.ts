import { test, expect } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";

for (const filter of [false, true])
  for (const kind of [
    "paint",
    "selection",
    "vector",
    "bitmap",
    "raster-erasures",
  ])
    test(`legacy wet ${kind} ${filter ? "filter" : "ordinary"} mask retains exact pixels when relinked`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const result = await page.evaluate(
        async ({ filter, kind }) => {
          const {
            editor,
            RasterLayer,
            LayerMask,
            BrushStroke,
            EraserStroke,
            VectorPath,
            MarqueeSelection,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
          } = window.luma;
          editor.newDocument({ width: 120, height: 90 });
          const canvas = new OffscreenCanvas(128, 96),
            c = canvas.getContext("2d")!;
          c.fillStyle = "#ee4010";
          c.fillRect(0, 0, 128, 96);
          const asset = await editor.assetStore.add(
              await canvas.convertToBlob(),
              "Wet native grid",
              undefined,
              false,
            ),
            raster = editor.document.layers.add(
              new RasterLayer({
                assetId: asset.id,
                width: 64,
                height: 48,
                x: 20,
                y: 15,
              }),
            ),
            layer = filter ? raster.convertToSmartObject() : raster;
          layer.perspective = new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.8, y: 1 },
              { x: 0.1, y: 1 },
            ],
          });
          let mask =
            kind === "paint"
              ? new LayerMask({ base: 0.8 })
              : kind === "selection"
                ? new LayerMask({
                    selection: new MarqueeSelection({
                      x: 4,
                      y: 3,
                      width: 45,
                      height: 35,
                      shape: "ellipse",
                    }),
                  })
                : kind === "vector"
                  ? new LayerMask({
                      paths: [
                        new VectorPath({
                          closed: true,
                          points: [
                            { x: 4, y: 2 },
                            { x: 50, y: 3 },
                            { x: 42, y: 39 },
                            { x: 3, y: 36 },
                          ],
                        }),
                      ],
                    })
                  : kind === "bitmap"
                    ? LayerMask.fromBitmap(asset.id)
                    : new LayerMask({
                        rasterErasures: {
                          width: 64,
                          height: 48,
                          operations: [
                            {
                              width: 64,
                              height: 48,
                              stroke: new EraserStroke({
                                points: [{ x: 22, y: 18 }],
                                size: 12,
                                hardness: 0.3,
                              }),
                            },
                          ],
                        },
                      });
          mask = mask
            .with({
              x: 2,
              y: -1,
              basis: AffineTransform.rotation(0.1),
              feather: 2.5,
              density: 0.67,
            })
            .paint(
              new BrushStroke({
                points: [{ x: 20, y: 15 }],
                size: 7,
                hardness: 0.4,
              }),
              "hide",
            );
          if (layer instanceof window.luma.SmartObjectLayer) {
            layer.addFilter(new SmartToneFilter({ saturation: -100 }));
            layer.filterMask = mask;
          } else layer.mask = mask;
          editor.document.selectedLayer = layer;
          const wet = await editor.applyWetPaint(
            new BrushStroke({
              points: [
                { x: 28, y: 22 },
                { x: 36, y: 26 },
              ],
              size: 9,
              hardness: 0.4,
              pressureSize: false,
            }),
            {
              space: "placed",
              mode: "mixer",
              target: filter ? "filter-mask" : "mask",
              load: { load: 1, color: [255, 255, 255, 0] },
              mix: { wetness: 0, pickup: 0 },
            },
          );
          if (!wet) throw Error("Missing actual prepared wet edit");
          const sample = async () => {
            const out = await editor.renderer.render(
              editor.document.toJSON(),
              editor.assetStore,
              { cache: false, readback: true },
            );
            try {
              return out.getContext("2d")!.getImageData(0, 0, 120, 90).data;
            } finally {
              out.width = out.height = 0;
            }
          };
          const before = editor.document.toJSON(),
            pixels = await sample(),
            past = editor.document.getSnapshot().past.length;
          if (layer instanceof window.luma.SmartObjectLayer)
            layer.setFilterMaskLinked(false);
          else layer.setMaskLinked(false);
          const after = await sample(),
            saved = editor.document.toJSON(),
            oneUndo = editor.document.getSnapshot().past.length === past + 1;
          editor.document.undo();
          const undo =
            JSON.stringify(before) === JSON.stringify(editor.document.toJSON());
          editor.document.redo();
          const redo =
            JSON.stringify(saved) === JSON.stringify(editor.document.toJSON());
          if (layer instanceof window.luma.SmartObjectLayer)
            layer.setFilterMaskLinked(true);
          else layer.setMaskLinked(true);
          const relinked = await sample();
          return {
            firstExact: pixels.every((v, i) => v === after[i]),
            secondExact: pixels.every((v, i) => v === relinked[i]),
            oneUndo,
            undo,
            redo,
            native: [asset.width, asset.height],
            logical: [64, 48],
          };
        },
        { filter, kind },
      );
      expect(result).toMatchObject({
        firstExact: true,
        secondExact: true,
        oneUndo: true,
        undo: true,
        redo: true,
      });
      await writeFile(
        info.outputPath("legacy-wet-link.json"),
        JSON.stringify(result, null, 2),
      );
    });

for (const legacyPrefix of [false, true])
  test(`mapped wet native field retains every prepared coverage pixel ${legacyPrefix ? "after a legacy wet prefix" : "on a fresh mask"}`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (legacyPrefix) => {
      const {
        editor,
        Document,
        RasterLayer,
        LayerMask,
        WetPaintStroke,
        BrushStroke,
        PerspectiveTransform,
        AffineTransform,
      } = window.luma;
      const { encodeRgbaPng } = await import(
          /* @vite-ignore */ String("/src/engine/png.ts")
        ),
        { captureMaskMappedPlacement } = await import(
          /* @vite-ignore */ String("/src/core/mask-plane-brush.ts")
        ),
        { maskOwnerPose } = await import(
          /* @vite-ignore */ String("/src/core/mask-plane.ts")
        );
      const pixels = new Uint8Array(128 * 96 * 4).fill(255),
        original = await editor.assetStore.add(
          await encodeRgbaPng(pixels, 128, 96),
          "Original native grid",
          undefined,
          false,
        ),
        output = Uint8Array.from({ length: 24 * 4 * 4 }, (_, i) =>
          i % 4 === 3 ? ((i >> 2) % 2 ? 240 : 16) : 255,
        ),
        coverage = new Uint8Array(output.length).fill(255),
        color = await editor.assetStore.add(
          await encodeRgbaPng(output, 24, 4),
          "Independent wet pigment",
          undefined,
          false,
        ),
        support = await editor.assetStore.add(
          await encodeRgbaPng(coverage, 24, 4),
          "Independent removal",
          undefined,
          false,
        );
      const doc = new Document({ width: 64, height: 48 }),
        layer = doc.layers.add(
          new RasterLayer({
            assetId: original.id,
            width: 64,
            height: 48,
            perspective: new PerspectiveTransform({
              corners: [
                { x: 0.0625, y: 0 },
                { x: 1.0625, y: 0 },
                { x: 1.0625, y: 1 },
                { x: 0.0625, y: 1 },
              ],
            }),
          }),
        );
      layer.mask = new LayerMask({ base: 0.5 });
      layer.setMaskLinked(false);
      layer.setMaskLinked(true);
      if (legacyPrefix)
        layer.mask = layer.mask.applyWetPaint(
          new WetPaintStroke({
            brush: new BrushStroke({ points: [{ x: 1, y: 1 }], size: 1 }),
            tiles: [
              {
                x: 0,
                y: 0,
                width: 24,
                height: 4,
                assetId: color.id,
                coverage: { assetId: support.id },
              },
            ],
          }),
        );
      const placement = captureMaskMappedPlacement(
          layer.mask.toJSON(),
          maskOwnerPose(layer.toJSON(), new AffineTransform()),
          new AffineTransform(),
          64,
          48,
        ),
        wet = new WetPaintStroke({
          brush: new BrushStroke({ points: [{ x: 8, y: 10 }], size: 8 }),
          nativeTransform: AffineTransform.scale(0.5, 0.5),
          placement,
          tiles: [
            {
              x: 16,
              y: 20,
              width: 24,
              height: 4,
              assetId: color.id,
              coverage: { assetId: support.id },
            },
          ],
        });
      layer.mask = layer.mask.applyWetPaint(wet);
      const capture = editor.renderer.captureMaskPlane(
        layer.mask.toJSON(),
        maskOwnerPose(layer.toJSON(), new AffineTransform()),
        editor.assetStore,
        {},
        { documentTransform: new AffineTransform(2, 0, 0, 2, -8, 0) },
      );
      try {
        const region = { x: 8, y: 20, width: 24, height: 4 },
          actual = await capture.read(region, false),
          expected = Float32Array.from(
            { length: 24 * 4 },
            (_, i) => output[i * 4 + 3] / 255,
          );
        let different = 0;
        for (let i = 0; i < actual.length; i++)
          if (actual[i] !== expected[i]) different++;
        return {
          different,
          actual: [...actual],
          expected: [...expected],
          field: wet.toJSON(),
          native: [original.width, original.height],
          logical: [64, 48],
        };
      } finally {
        capture.dispose();
      }
    }, legacyPrefix);
    await writeFile(
      info.outputPath("wet-native-grid.json"),
      JSON.stringify(result, null, 2),
    );
    expect(result.different).toBe(0);
    expect(result.native).toEqual([128, 96]);
  });

for (const mode of ["brush", "wet"] as const)
  test(`inert mapped ${mode} metadata leaves legacy wet reconstruction and following edits unchanged`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (mode) => {
      const {
          editor,
          Document,
          RasterLayer,
          LayerMask,
          WetPaintStroke,
          BrushStroke,
          PerspectiveTransform,
          AffineTransform,
        } = window.luma,
        { encodeRgbaPng } = await import(
          /* @vite-ignore */ String("/src/engine/png.ts")
        ),
        { captureMaskMappedPlacement } = await import(
          /* @vite-ignore */ String("/src/core/mask-plane-brush.ts")
        ),
        { maskOwnerPose } = await import(
          /* @vite-ignore */ String("/src/core/mask-plane.ts")
        ),
        { maskPaintPlacementValue } = await import(
          /* @vite-ignore */ String("/src/dom/masks.ts")
        );
      const original = await editor.assetStore.add(
          await encodeRgbaPng(new Uint8Array(128 * 96 * 4).fill(255), 128, 96),
          "Original grid",
          undefined,
          false,
        ),
        source = await editor.assetStore.add(
          await encodeRgbaPng(new Uint8Array([255, 255, 255, 128]), 1, 1),
          "Legacy pigment",
          undefined,
          false,
        ),
        coverage = await editor.assetStore.add(
          await encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1),
          "Legacy removal",
          undefined,
          false,
        ),
        doc = new Document({ width: 64, height: 48 }),
        layer = doc.layers.add(
          new RasterLayer({
            assetId: original.id,
            width: 64,
            height: 48,
            perspective: new PerspectiveTransform({
              corners: [
                { x: 0.0625, y: 0 },
                { x: 1.0625, y: 0 },
                { x: 1.0625, y: 1 },
                { x: 0.0625, y: 1 },
              ],
            }),
          }),
        );
      layer.mask = new LayerMask({ base: 0.8 });
      layer.setMaskLinked(false);
      layer.setMaskLinked(true);
      const legacy = new WetPaintStroke({
          brush: new BrushStroke({ points: [{ x: 1, y: 1 }], size: 1 }),
          tiles: [
            {
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              assetId: source.id,
              coverage: { assetId: coverage.id },
            },
          ],
        }),
        base = layer.mask.applyWetPaint(legacy),
        owner = maskOwnerPose(layer.toJSON(), new AffineTransform()),
        placement = captureMaskMappedPlacement(
          base.toJSON(),
          owner,
          new AffineTransform(),
          64,
          48,
        ),
        following = new BrushStroke({
          points: [
            { x: 9.25, y: 8.5 },
            { x: 20, y: 11.5 },
          ],
          size: 7.5,
          hardness: 0.3,
          opacity: 0.67,
          pressureSize: false,
        });
      const expected = base.paint(following, "hide"),
        inert =
          mode === "wet"
            ? base.applyWetPaint(
                new WetPaintStroke({
                  ...legacy.toJSON(),
                  placement,
                  opacity: 0,
                }),
              )
            : base.paint(
                new BrushStroke({
                  points: [{ x: 8, y: 10 }],
                  size: 9,
                  opacity: 0,
                }),
                "hide",
                { placement: maskPaintPlacementValue(placement) },
              ),
        actual = inert.paint(following, "hide");
      const sample = async (mask: InstanceType<typeof LayerMask>) => {
          const capture = editor.renderer.captureMaskPlane(
            mask.toJSON(),
            owner,
            editor.assetStore,
            {},
            { documentTransform: new AffineTransform(2, 0, 0, 2, -8, 0) },
          );
          try {
            return await capture.read(
              { x: 0, y: 0, width: 80, height: 40 },
              false,
            );
          } finally {
            capture.dispose();
          }
        },
        a = await sample(expected),
        b = await sample(actual);
      return {
        different: new Uint32Array(a.buffer).reduce(
          (count, v, i) => count + (v === new Uint32Array(b.buffer)[i] ? 0 : 1),
          0,
        ),
        points: following.points.length,
        retained:
          actual.toJSON().strokes!.length ===
          expected.toJSON().strokes!.length + 1,
      };
    }, mode);
    expect(result).toMatchObject({ different: 0, points: 2, retained: true });
    await writeFile(
      info.outputPath("inert-native-grid.json"),
      JSON.stringify(result, null, 2),
    );
  });

for (const phase of ["ordinary", "native-filter", "document-filter"] as const)
  test(`retained ${phase} mask survives actual SVG and layered Photoshop delivery with explicit baked coverage`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (phase) => {
      const {
          editor,
          RasterLayer,
          LayerMask,
          BrushStroke,
          MarqueeSelection,
          PerspectiveTransform,
          SmartToneFilter,
        } = window.luma,
        { encodeRgbaPng } = await import(
          /* @vite-ignore */ String("/src/engine/png.ts")
        );
      editor.newDocument({ width: 120, height: 90 });
      const source = Uint8Array.from({ length: 128 * 96 * 4 }, (_, i) =>
          i % 4 === 3
            ? [128, 191, 255][(i >> 2) % 3]
            : i % 4 === 0
              ? 240
              : i % 4 === 1
                ? 64
                : 32,
        ),
        asset = await editor.assetStore.add(
          await encodeRgbaPng(source, 128, 96),
          "Retained export original",
          undefined,
          false,
        ),
        raster = editor.document.layers.add(
          new RasterLayer({
            assetId: asset.id,
            width: 64,
            height: 48,
            x: 25,
            y: 18,
          }),
        ),
        layer = phase === "ordinary" ? raster : raster.convertToSmartObject();
      layer.perspective = new PerspectiveTransform({
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.8, y: 1 },
          { x: 0.1, y: 1 },
        ],
      });
      const mask = new LayerMask({
        linked: phase !== "document-filter",
        selection: new MarqueeSelection({
          x: phase === "document-filter" ? 35 : 6,
          y: phase === "document-filter" ? 25 : 5,
          width: 42,
          height: 32,
          shape: "ellipse",
        }),
        feather: 2.5,
        density: 0.75,
      }).paint(
        new BrushStroke({
          points: [
            { x: 22, y: 18 },
            { x: 32, y: 23 },
          ],
          size: 8,
          hardness: 0.3,
        }),
        "hide",
      );
      if (layer instanceof window.luma.SmartObjectLayer) {
        layer.addFilter(new SmartToneFilter({ saturation: -100 }));
        layer.filterMask = mask;
        layer.setFilterMaskLinked(phase === "document-filter");
      } else {
        layer.mask = mask;
        layer.setMaskLinked(false);
      }
      const sample = async () => {
        const out = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        try {
          return [...out.getContext("2d")!.getImageData(0, 0, 120, 90).data];
        } finally {
          out.width = out.height = 0;
        }
      };
      const before = editor.document.toJSON(),
        expected = await sample(),
        svg = await editor.export({ format: "svg" }),
        psd = await editor.export({ format: "psd", psdMode: "layers" }),
        unchanged =
          JSON.stringify(before) === JSON.stringify(editor.document.toJSON()),
        originalExact = asset.blob === editor.assetStore.get(asset.id).blob,
        url = URL.createObjectURL(svg.blob),
        image = new Image(),
        canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 90;
      let svgDiff = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = reject;
          image.src = url;
        });
        canvas.getContext("2d")!.drawImage(image, 0, 0);
        const actual = canvas
          .getContext("2d")!
          .getImageData(0, 0, 120, 90).data;
        for (let i = 0; i < actual.length; i++)
          if (actual[i] !== expected[i]) svgDiff++;
      } finally {
        URL.revokeObjectURL(url);
        canvas.width = canvas.height = 0;
      }
      await editor.openPsd(psd.blob, { mode: "layered" });
      const imported = await sample();
      let psdDiff = 0;
      for (let i = 0; i < imported.length; i++)
        if (imported[i] !== expected[i]) psdDiff++;
      return {
        svgDiff,
        psdDiff,
        unchanged,
        originalExact,
        reports: { svg: svg.report, psd: psd.report },
        importedKind: editor.document.layers.at(0)!.kind,
      };
    }, phase);
    expect(result).toMatchObject({
      svgDiff: 0,
      psdDiff: 0,
      unchanged: true,
      originalExact: true,
    });
    for (const report of Object.values(result.reports))
      expect(report.featuresDegradedOrOmitted.join(" ")).toMatch(
        /retained mask planes/i,
      );
    await writeFile(
      info.outputPath("retained-export.json"),
      JSON.stringify(result, null, 2),
    );
  });

test("byte wet editing retains geometry-only float originals without treating their thumbnails as pixels", async ({
  page,
}, info) => {
  const bytes = [
    ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
  ];
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const result = await page.evaluate(async (bytes) => {
    const {
      editor,
      RasterLayer,
      LayerMask,
      MaskPlane,
      BrushStroke,
      PerspectiveTransform,
    } = window.luma;
    editor.newDocument({ width: 100, height: 80 });
    const grid = await editor.assetStore.add(
        new Blob([new Uint8Array(bytes)], { type: "image/tiff" }),
        "Geometry-only native float",
        undefined,
        false,
        { tiff: { editingPrecision: "float32" } },
      ),
      canvas = new OffscreenCanvas(64, 48),
      c = canvas.getContext("2d")!;
    c.fillStyle = "#ff0000";
    c.fillRect(0, 0, 64, 48);
    const asset = await editor.assetStore.add(
        await canvas.convertToBlob(),
        "Byte artwork",
        undefined,
        false,
      ),
      layer = editor.document.layers.add(
        new RasterLayer({
          assetId: asset.id,
          width: 64,
          height: 48,
          x: 16,
          y: 12,
          perspective: new PerspectiveTransform({
            corners: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 0.8, y: 1 },
              { x: 0.1, y: 1 },
            ],
          }),
        }),
      );
    layer.mask = new LayerMask({
      base: 1,
      plane: new MaskPlane({
        reference: { assetId: grid.id },
        pose: {
          width: 64,
          height: 48,
          perspective: layer.perspective!,
          transform: layer.transform,
        },
      }),
    });
    editor.document.selectedLayer = layer;
    const sample = async () => {
      const out = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      try {
        return [...out.getContext("2d")!.getImageData(0, 0, 100, 80).data];
      } finally {
        out.width = out.height = 0;
      }
    };
    const before = await sample(),
      model = editor.document.toJSON(),
      past = editor.document.getSnapshot().past.length,
      wet = await editor.applyWetPaint(
        new BrushStroke({
          points: [
            { x: 28, y: 22 },
            { x: 36, y: 26 },
          ],
          size: 9,
          hardness: 0.5,
          pressureSize: false,
        }),
        {
          mode: "mixer",
          target: "mask",
          space: "placed",
          load: { load: 1, color: [255, 255, 255, 0] },
          mix: { wetness: 0, pickup: 0 },
        },
      );
    if (!wet) throw Error("Missing byte wet field");
    const after = await sample(),
      saved = editor.document.toJSON(),
      oneUndo = editor.document.getSnapshot().past.length === past + 1;
    editor.document.undo();
    const undo =
      JSON.stringify(model) === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    const redo =
        JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
      project = await editor.saveProject();
    await editor.openProject(new File([project], "geometry-only-float.luma"));
    const restored = editor.assetStore.get(grid.id),
      restoredBytes = new Uint8Array(await restored.blob.arrayBuffer());
    return {
      changed: before.some((v, i) => v !== after[i]),
      bytePrecision: editor.document.precision,
      oneUndo,
      undo,
      redo,
      reopened:
        JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
      sourceExact:
        restoredBytes.length === bytes.length &&
        restoredBytes.every((v, i) => v === bytes[i]),
      originalBytes: bytes.length,
      restoredBytes: restoredBytes.length,
      native: [restored.width, restored.height],
      display: [restored.bitmap.width, restored.bitmap.height],
      redOnly: after.every(
        (v, i) =>
          i % 4 === 3 ||
          after[i - (i % 4) + 3] === 0 ||
          v === (i % 4 === 0 ? 255 : 0),
      ),
    };
  }, bytes);
  expect(result).toMatchObject({
    changed: true,
    bytePrecision: "uint8",
    oneUndo: true,
    undo: true,
    redo: true,
    reopened: true,
    sourceExact: true,
    native: [131, 79],
    redOnly: true,
  });
  expect(result.display[0]).toBeLessThan(result.native[0]);
  await writeFile(
    info.outputPath("geometry-only-float.json"),
    JSON.stringify(result, null, 2),
  );
});
