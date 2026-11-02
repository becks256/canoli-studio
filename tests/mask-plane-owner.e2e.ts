import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

for (const linked of [false, true])
  test(`retained ${linked ? "linked" : "independent"} ordinary mask keeps its native original when shared smart contents change resolution`, async ({
    page,
  }, info) => {
    await page.goto("/");
    await page.waitForFunction(() => !!window.luma?.editor);
    const result = await page.evaluate(async (linked) => {
      const {
        editor,
        Document,
        RasterLayer,
        LayerMask,
        MarqueeSelection,
        BrushStroke,
        PerspectiveTransform,
      } = window.luma;
      const { serializeProject, readProject } = await import(
        /* @vite-ignore */ String("/src/core/project.ts")
      );
      editor.newDocument({ width: 192, height: 144 });
      const doc = editor.document;
      const image = async (width: number, height: number, color: string) => {
        const canvas = new OffscreenCanvas(width, height),
          c = canvas.getContext("2d")!;
        c.fillStyle = color;
        c.fillRect(0, 0, width, height);
        return editor.assetStore.add(
          await canvas.convertToBlob(),
          color,
          undefined,
          false,
        );
      };
      const original = await image(192, 144, "#ff0000"),
        replacement = await image(384, 288, "#0000ff");
      const instance = doc.layers
        .add(
          new RasterLayer({
            assetId: original.id,
            width: 96,
            height: 72,
            x: 30,
            y: 22,
          }),
        )
        .convertToSmartObject();
      instance.perspective = new PerspectiveTransform({
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.85, y: 1 },
          { x: 0.08, y: 1 },
        ],
      });
      instance.mask = new LayerMask({
        selection: new MarqueeSelection({
          shape: "ellipse",
          x: 25,
          y: 20,
          width: 40,
          height: 30,
        }),
        feather: 1.2,
        density: 1,
      });
      instance.setMaskLinked(false);
      if (linked) instance.setMaskLinked(true);
      instance.paintMask(
        new BrushStroke({
          points: [{ x: 42, y: 33 }],
          size: 8,
          hardness: 0.5,
          pressureSize: false,
        }),
        "hide",
        { space: "placed" },
      );
      const read = async (cache: boolean) => {
        const out = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache, readback: true },
        );
        try {
          return [...out.getContext("2d")!.getImageData(0, 0, 192, 144).data];
        } finally {
          out.width = out.height = 0;
        }
      };
      const baseline = await read(true);
      await read(true);
      const before = doc.toJSON(),
        rawMask = instance.mask!.toJSON(),
        past = doc.getSnapshot().past.length;
      const contents = new Document({ width: 384, height: 288 });
      contents.layers.add(
        new RasterLayer({ assetId: replacement.id, width: 384, height: 288 }),
      );
      instance.replaceContents(contents);
      const changed = doc.toJSON(),
        after = await read(true),
        uncached = await read(false),
        oneUndo = doc.getSnapshot().past.length === past + 1;
      doc.undo();
      const undo = JSON.stringify(before) === JSON.stringify(doc.toJSON()),
        undoPixels = (await read(true)).every((v, i) => v === baseline[i]);
      doc.redo();
      const redo = JSON.stringify(changed) === JSON.stringify(doc.toJSON()),
        redoPixels = (await read(true)).every((v, i) => v === after[i]);
      // Deliberately omit retained history: only the live mask plane owns the old original.
      const file = await serializeProject(doc.toJSON(), editor.assetStore),
        decoded = await readProject(file);
      await editor.openProject(new File([file], "replaced-mask-owner.luma"));
      const reopened = await read(true),
        grid = editor.assetStore.get(original.id),
        originalBytes = new Uint8Array(await original.blob.arrayBuffer()),
        restoredBytes = new Uint8Array(await grid.blob.arrayBuffer());
      return {
        oneUndo,
        undo,
        undoPixels,
        redo,
        redoPixels,
        cacheExact: after.every((v, i) => v === uncached[i]),
        alphaExact: after.every((v, i) => i % 4 !== 3 || v === baseline[i]),
        redBefore: baseline.some(
          (v, i) => i % 4 === 0 && v === 255 && baseline[i + 3] > 0,
        ),
        blueAfter: after.some(
          (v, i) => i % 4 === 2 && v === 255 && after[i + 1] > 0,
        ),
        geometryExact:
          JSON.stringify(rawMask) ===
          JSON.stringify(editor.document.layers.at(0)!.mask!.toJSON()),
        reopenedModel:
          JSON.stringify(changed) === JSON.stringify(editor.document.toJSON()),
        reopenedPixels: reopened.every((v, i) => v === after[i]),
        sourceExact:
          originalBytes.length === restoredBytes.length &&
          originalBytes.every((v, i) => v === restoredBytes[i]),
        native: [grid.width, grid.height],
        sources: decoded.entries
          .map((entry: { id: string }) => entry.id)
          .sort(),
        expectedSources: [original.id, replacement.id].sort(),
        project: [...new Uint8Array(await file.arrayBuffer())],
        original: [...originalBytes],
        baseline,
        after,
      };
    }, linked);
    await writeFile(
      info.outputPath("owner-before.rgba8"),
      new Uint8Array(result.baseline),
    );
    await writeFile(
      info.outputPath("owner-after.rgba8"),
      new Uint8Array(result.after),
    );
    await writeFile(
      info.outputPath("source-replacement.luma"),
      new Uint8Array(result.project),
    );
    await writeFile(
      info.outputPath("geometry-original.png"),
      new Uint8Array(result.original),
    );
    const { baseline, after, project, original, ...report } = result;
    await writeFile(
      info.outputPath("source-replacement.json"),
      JSON.stringify(
        {
          ...report,
          samples: baseline.length,
          afterSamples: after.length,
          projectBytes: project.length,
          originalBytes: original.length,
        },
        null,
        2,
      ),
    );
    expect(result).toMatchObject({
      oneUndo: true,
      undo: true,
      undoPixels: true,
      redo: true,
      redoPixels: true,
      cacheExact: true,
      alphaExact: true,
      redBefore: true,
      blueAfter: true,
      geometryExact: true,
      reopenedModel: true,
      reopenedPixels: true,
      sourceExact: true,
      native: [192, 144],
    });
    expect(result.sources).toEqual(result.expectedSources);
  });

for (const target of ["ordinary", "native-filter", "document-filter"] as const)
  for (const linked of [false, true]) {
    test(`Image Size transports a retained ${linked ? "linked" : "independent"} ${target} mask like an independent root/document frame`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const result = await page.evaluate(
        async ({ target, linked }) => {
          const {
            editor,
            Document,
            RasterLayer,
            LayerGroup,
            LayerMask,
            MarqueeSelection,
            BrushStroke,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
          } = window.luma;
          editor.newDocument({ width: 160, height: 120 });
          const doc = editor.document;
          const canvas = new OffscreenCanvas(128, 96),
            c = canvas.getContext("2d")!;
          c.fillStyle = "#ef4020";
          c.fillRect(0, 0, 128, 96);
          c.fillStyle = "#2040ef";
          c.fillRect(64, 0, 64, 96);
          const asset = await editor.assetStore.add(
            await canvas.convertToBlob(),
            "Image Size original",
            undefined,
            false,
          );
          const parent = doc.layers.add(new LayerGroup());
          parent.transform = new AffineTransform(1, 0.125, 0.25, 1, 18, 14);
          const raster = parent.layers.add(
            new RasterLayer({
              assetId: asset.id,
              width: 64,
              height: 48,
              x: 10,
              y: 8,
              perspective: new PerspectiveTransform({
                corners: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 },
                  { x: 0.85, y: 1 },
                  { x: 0.08, y: 1 },
                ],
              }),
            }),
          );
          const layer =
            target === "ordinary" ? raster : raster.convertToSmartObject();
          const mask = new LayerMask({
            linked: target !== "document-filter",
            selection: new MarqueeSelection({
              shape: "ellipse",
              x: 20,
              y: 15,
              width: 40,
              height: 30,
            }),
            x: 2,
            y: -1,
            basis: AffineTransform.rotation(0.13),
            placedX: 1,
            placedY: -2,
            feather: 1.5,
            density: 0.7,
          }).paint(
            new BrushStroke({
              points: [{ x: 36, y: 28 }],
              size: 7,
              hardness: 0.4,
              opacity: 0.6,
              pressureSize: false,
            }),
            "hide",
          );
          if (
            target !== "ordinary" &&
            layer instanceof window.luma.SmartObjectLayer
          ) {
            layer.addFilter(new SmartToneFilter({ saturation: -100 }));
            layer.filterMask = mask;
            layer.setFilterMaskLinked(target === "document-filter");
            if (linked !== (target === "document-filter"))
              layer.setFilterMaskLinked(linked);
          } else {
            layer.mask = mask;
            layer.setMaskLinked(false);
            if (linked) layer.setMaskLinked(true);
          }
          const before = doc.toJSON(),
            past = doc.getSnapshot().past.length,
            reference = Document.fromJSON(before);
          reference.resize(320, 180);
          const scale = AffineTransform.scale(2, 1.5);
          const read = async (
            model: ReturnType<typeof doc.toJSON>,
            cache: boolean,
            frame = false,
          ) => {
            const out = await editor.renderer.render(model, editor.assetStore, {
              cache,
              readback: true,
              ...(frame
                ? { rootTransform: scale, documentTransform: scale }
                : {}),
            });
            try {
              return [
                ...out
                  .getContext("2d")!
                  .getImageData(0, 0, model.width, model.height).data,
              ];
            } finally {
              out.width = out.height = 0;
            }
          };
          await read(before, true);
          doc.resizeImage(320, 180);
          const saved = doc.toJSON(),
            actual = await read(saved, true),
            expected = await read(reference.toJSON(), false, true),
            uncached = await read(saved, false);
          const oneUndo = doc.getSnapshot().past.length === past + 1;
          doc.undo();
          const undo = JSON.stringify(before) === JSON.stringify(doc.toJSON());
          doc.redo();
          const redo = JSON.stringify(saved) === JSON.stringify(doc.toJSON());
          const maskAfter =
            layer instanceof window.luma.SmartObjectLayer
              ? layer.filterMask!.toJSON()
              : layer.mask!.toJSON();
          return {
            differences: actual.reduce(
              (n, v, i) => n + (v !== expected[i] ? 1 : 0),
              0,
            ),
            cacheDifferences: actual.reduce(
              (n, v, i) => n + (v !== uncached[i] ? 1 : 0),
              0,
            ),
            visible: actual.filter((v, i) => i % 4 === 3 && v > 0).length,
            oneUndo,
            undo,
            redo,
            phase: maskAfter.plane!.phase,
            plane: maskAfter.plane,
            actual,
            expected,
          };
        },
        { target, linked },
      );
      await writeFile(
        info.outputPath("resize-actual.rgba8"),
        new Uint8Array(result.actual),
      );
      await writeFile(
        info.outputPath("resize-expected.rgba8"),
        new Uint8Array(result.expected),
      );
      const { actual, expected, ...report } = result;
      await writeFile(
        info.outputPath("mask-image-resize.json"),
        JSON.stringify(
          {
            ...report,
            samples: actual.length,
            expectedSamples: expected.length,
          },
          null,
          2,
        ),
      );
      expect(result).toMatchObject({
        differences: 0,
        cacheDifferences: 0,
        oneUndo: true,
        undo: true,
        redo: true,
        phase: target === "native-filter" ? "native" : "document",
      });
      expect(result.visible).toBeGreaterThan(100);
    });
  }

for (const target of ["ordinary", "native-filter", "document-filter"] as const)
  for (const linked of [false, true]) {
    test(`nested masters preserve a retained ${linked ? "linked" : "independent"} ${target} mask through conversion and master Image Size`, async ({
      page,
    }, info) => {
      await page.goto("/");
      await page.waitForFunction(() => !!window.luma?.editor);
      const result = await page.evaluate(
        async ({ target, linked }) => {
          const {
            editor,
            RasterLayer,
            LayerGroup,
            LayerMask,
            MarqueeSelection,
            PerspectiveTransform,
            AffineTransform,
            SmartToneFilter,
          } = window.luma;
          editor.newDocument({ width: 180, height: 140 });
          const doc = editor.document;
          const canvas = new OffscreenCanvas(128, 96),
            c = canvas.getContext("2d")!;
          c.fillStyle = "#f04020";
          c.fillRect(0, 0, 128, 96);
          const asset = await editor.assetStore.add(
            await canvas.convertToBlob(),
            "Nested master original",
            undefined,
            false,
          );
          const parent = doc.layers.add(new LayerGroup());
          parent.transform = new AffineTransform(1, 0.125, 0.25, 1, 18, 14);
          const raster = parent.layers.add(
            new RasterLayer({
              assetId: asset.id,
              width: 64,
              height: 48,
              x: 10,
              y: 8,
              perspective: new PerspectiveTransform({
                corners: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 },
                  { x: 0.85, y: 1 },
                  { x: 0.08, y: 1 },
                ],
              }),
            }),
          );
          const layer =
            target === "ordinary" ? raster : raster.convertToSmartObject();
          const mask = new LayerMask({
            linked: target !== "document-filter",
            selection: new MarqueeSelection({
              shape: "ellipse",
              x: 25,
              y: 20,
              width: 35,
              height: 25,
            }),
            density: 1,
            x: 2,
            y: -1,
            basis: AffineTransform.rotation(0.13),
            placedX: 1,
            placedY: -2,
          });
          if (
            target !== "ordinary" &&
            layer instanceof window.luma.SmartObjectLayer
          ) {
            layer.addFilter(new SmartToneFilter({ saturation: -100 }));
            layer.filterMask = mask;
            layer.setFilterMaskLinked(target === "document-filter");
            if (linked !== (target === "document-filter"))
              layer.setFilterMaskLinked(linked);
          } else {
            layer.mask = mask;
            layer.setMaskLinked(false);
            if (linked) layer.setMaskLinked(true);
          }
          const read = async (cache: boolean) => {
            const out = await editor.renderer.render(
              editor.document.toJSON(),
              editor.assetStore,
              { cache, readback: true },
            );
            try {
              return [
                ...out.getContext("2d")!.getImageData(0, 0, 180, 140).data,
              ];
            } finally {
              out.width = out.height = 0;
            }
          };
          const original = await read(true),
            inner = doc.createSmartObject([parent]),
            first = await read(false),
            outer = doc.createSmartObject([inner]);
          const nested = await read(true),
            before = doc.toJSON(),
            past = doc.getSnapshot().past.length;
          const contents = outer.editContents();
          contents.resizeImage(contents.width * 2, contents.height * 2);
          outer.replaceContents(contents);
          const saved = doc.toJSON(),
            resized = await read(true),
            cold = await read(false),
            oneUndo = doc.getSnapshot().past.length === past + 1;
          doc.undo();
          const undo = JSON.stringify(before) === JSON.stringify(doc.toJSON()),
            undoPixels = (await read(true)).every((v, i) => v === nested[i]);
          doc.redo();
          const redo = JSON.stringify(saved) === JSON.stringify(doc.toJSON());
          const file = await editor.saveProject();
          await editor.openProject(new File([file], "nested-mask-owner.luma"));
          const reopened = await read(true),
            different = (a: number[], b: number[]) =>
              a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
          return {
            firstConversion: different(original, first),
            nestedConversion: different(original, nested),
            masterResize: different(nested, resized),
            cacheDifferences: different(resized, cold),
            oneUndo,
            undo,
            undoPixels,
            redo,
            reopenedPixels: different(resized, reopened),
            reopenedModel:
              JSON.stringify(saved) ===
              JSON.stringify(editor.document.toJSON()),
            original,
            nested,
            resized,
          };
        },
        { target, linked },
      );
      for (const [name, pixels] of Object.entries({
        original: result.original,
        nested: result.nested,
        resized: result.resized,
      }))
        await writeFile(
          info.outputPath(`nested-${name}.rgba8`),
          new Uint8Array(pixels),
        );
      const { original, nested, resized, ...report } = result;
      await writeFile(
        info.outputPath("nested-owner.json"),
        JSON.stringify(
          {
            ...report,
            samples: original.length,
            nestedSamples: nested.length,
            resizedSamples: resized.length,
          },
          null,
          2,
        ),
      );
      expect(result).toMatchObject({
        firstConversion: 0,
        nestedConversion: 0,
        masterResize: 0,
        cacheDifferences: 0,
        oneUndo: true,
        undo: true,
        undoPixels: true,
        redo: true,
        reopenedPixels: 0,
        reopenedModel: true,
      });
    });
  }
