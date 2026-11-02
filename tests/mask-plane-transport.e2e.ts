import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("copied retained planes own geometry-only float originals after source closure, collision remapping and workspace history restoration", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const setup = await page.evaluate(
    async (bytes) => {
      const {
        editor,
        RasterLayer,
        LayerMask,
        MaskPlane,
        BrushStroke,
        PerspectiveTransform,
      } = window.luma;
      editor.newDocument({
        name: "Pending destination",
        width: 120,
        height: 90,
      });
      const target = editor.document;
      target.name = "Receiving retained artwork";
      editor.newDocument({
        name: "Source retained artwork",
        width: 120,
        height: 90,
      });
      const source = editor.document;
      const grid = await editor.assetStore.add(
        new Blob([new Uint8Array(bytes)], { type: "image/tiff" }),
        "Geometry-only original",
        "geometry-collision",
        false,
        { tiff: { editingPrecision: "float32" } },
      );
      const canvas = new OffscreenCanvas(96, 72),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#f04020";
      c.fillRect(0, 0, 96, 72);
      const artwork = await editor.assetStore.add(
        await canvas.convertToBlob(),
        "Current byte artwork",
        "artwork-collision",
        false,
      );
      const layer = source.layers.add(
        new RasterLayer({
          assetId: artwork.id,
          width: 64,
          height: 48,
          x: 25,
          y: 20,
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
        base: 0.9,
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
      layer.paintMask(
        new BrushStroke({
          points: [
            { x: 28, y: 20 },
            { x: 42, y: 27 },
          ],
          size: 13,
          hardness: 0.5,
          opacity: 0.7,
          pressureSize: false,
        }),
        "hide",
        { space: "placed" },
      );
      source.selectedLayer = layer;
      const sample = async () => {
        const canvas = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        try {
          return [...canvas.getContext("2d")!.getImageData(0, 0, 120, 90).data];
        } finally {
          canvas.width = canvas.height = 0;
        }
      };
      const expected = await sample(),
        mask = layer.mask!.toJSON();
      editor.activateDocument(target);
      // A pre-existing source with the same ID must never become the copied lattice.
      await editor.assetStore.add(
        await canvas.convertToBlob(),
        "Receiving collision",
        grid.id,
        false,
      );
      editor.activateDocument(source);
      const past = target.getSnapshot().past.length,
        [copy] = await editor.copySelectedLayersTo(target);
      await editor.closeDocument(source, { discardChanges: true });
      editor.activateDocument(target);
      const reference = copy.mask!.plane!.reference;
      if (typeof reference.assetId !== "string")
        throw Error("Missing copied native grid");
      const copiedGrid = editor.assetStore.get(reference.assetId),
        original = new Uint8Array(await copiedGrid.blob.arrayBuffer());
      const copiedMask = copy.mask!.toJSON(),
        freshStrokeIds = copiedMask.strokes!.every(
          (entry, i) => entry.stroke.id !== mask.strokes![i].stroke.id,
        );
      const normalized = {
        ...copiedMask,
        plane: { ...copiedMask.plane!, reference: mask.plane!.reference },
        strokes: copiedMask.strokes!.map((entry, i) => ({
          ...entry,
          stroke: { ...entry.stroke, id: mask.strokes![i].stroke.id },
        })),
      };
      const copiedPixels = await sample(),
        oneUndo = target.getSnapshot().past.length === past + 1;
      const artworkId = (copy as InstanceType<typeof RasterLayer>).assetId;
      target.undo();
      const removed = target.layers.length === 0;
      // Only redo history now refers to both the artwork and the geometry original.
      const history = target.getSnapshot(),
        state = {
          past: history.past.map((entry) => entry.label),
          future: history.future.map((entry) => entry.label),
        };
      await editor.saveWorkspace();
      return {
        id: copy.id,
        gridId: reference.assetId,
        artworkId,
        expected,
        state,
        oneUndo,
        removed,
        differentGrid: reference.assetId !== grid.id,
        differentArtwork: artworkId !== artwork.id,
        copiedExact: copiedPixels.every((v, i) => v === expected[i]),
        geometryExact: JSON.stringify(normalized) === JSON.stringify(mask),
        freshStrokeIds,
        sourceExact:
          original.length === bytes.length &&
          original.every((v, i) => v === bytes[i]),
        dimensions: [copiedGrid.width, copiedGrid.height],
        thumbnail: [copiedGrid.bitmap.width, copiedGrid.bitmap.height],
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await page.reload();
  await page.waitForFunction(() => !!window.luma?.editor);
  const restored = await page.evaluate(async (setup) => {
    const { editor } = window.luma;
    await editor.restoreWorkspace();
    const doc = editor.openDocuments.find(
      (doc) => doc.name === "Receiving retained artwork",
    )!;
    editor.activateDocument(doc);
    const history = doc.getSnapshot(),
      state = {
        past: history.past.map((entry) => entry.label),
        future: history.future.map((entry) => entry.label),
      };
    const empty = doc.layers.length === 0;
    doc.redo();
    const layer = doc.getLayer(setup.id)!,
      canvas = await editor.renderer.render(doc.toJSON(), editor.assetStore, {
        cache: false,
        readback: true,
      });
    let pixelsExact;
    try {
      pixelsExact = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 120, 90).data,
      ].every((v, i) => v === setup.expected[i]);
    } finally {
      canvas.width = canvas.height = 0;
    }
    const bytes = [
      ...new Uint8Array(
        await editor.assetStore.get(setup.gridId).blob.arrayBuffer(),
      ),
    ];
    return {
      state,
      empty,
      pixelsExact,
      bytes,
      reference: layer.mask!.plane!.reference,
      artworkExists: editor.assetStore.has(setup.artworkId),
      retainedSourceClosed: editor.openDocuments.every(
        (doc) => doc.name !== "Source retained artwork",
      ),
    };
  }, setup);
  expect(setup).toMatchObject({
    oneUndo: true,
    removed: true,
    differentGrid: true,
    differentArtwork: true,
    copiedExact: true,
    geometryExact: true,
    freshStrokeIds: true,
    sourceExact: true,
    dimensions: [131, 79],
    thumbnail: [96, 58],
  });
  expect(restored).toMatchObject({
    state: setup.state,
    empty: true,
    pixelsExact: true,
    reference: { assetId: setup.gridId },
    artworkExists: true,
    retainedSourceClosed: true,
  });
  expect(restored.bytes).toEqual([
    ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
  ]);
  await writeFile(
    info.outputPath("mask-plane-workspace-closure.json"),
    JSON.stringify(
      {
        setup: { ...setup, expected: { samples: setup.expected.length } },
        restored: {
          ...restored,
          bytes: { length: restored.bytes.length, exact: true },
        },
      },
      null,
      2,
    ),
  );
});

test("recorded retained-mask recipes package and remap geometry-only originals after the source document closes", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.waitForFunction(() => !!window.luma?.editor);
  const result = await page.evaluate(
    async (bytes) => {
      const {
        editor,
        RasterLayer,
        LayerMask,
        MaskPlane,
        BrushStroke,
        PerspectiveTransform,
      } = window.luma;
      editor.newDocument({ width: 120, height: 90 });
      const source = editor.document;
      const grid = await editor.assetStore.add(
        new Blob([new Uint8Array(bytes)], { type: "image/tiff" }),
        "Recipe native geometry",
        "recipe-grid",
        false,
        { tiff: { editingPrecision: "float32" } },
      );
      const canvas = new OffscreenCanvas(96, 72),
        c = canvas.getContext("2d")!;
      c.fillStyle = "#ef4020";
      c.fillRect(0, 0, 96, 72);
      const artwork = await editor.assetStore.add(
        await canvas.convertToBlob(),
        "Recipe artwork",
        "recipe-artwork",
        false,
      );
      const layer = new RasterLayer({
        assetId: artwork.id,
        width: 64,
        height: 48,
        x: 25,
        y: 20,
        perspective: new PerspectiveTransform({
          corners: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0.8, y: 1 },
            { x: 0.1, y: 1 },
          ],
        }),
      });
      layer.mask = new LayerMask({
        base: 0.9,
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
      editor.recipes.startRecording();
      source.layers.add(layer);
      source.selectedLayer = layer;
      layer.paintMask(
        new BrushStroke({
          points: [
            { x: 28, y: 20 },
            { x: 42, y: 27 },
          ],
          size: 13,
          hardness: 0.5,
          opacity: 0.7,
          pressureSize: false,
        }),
        "hide",
        { space: "placed" },
      );
      const recipe = await editor.recipes.stopRecording({
          name: "Portable retained geometry",
        }),
        file = await editor.recipes.packages.get(recipe.id);
      if (!file) throw Error("Missing recorded package");
      const { readRecipePackage } = await import(
        /* @vite-ignore */ String("/src/ai/recipes/package.ts")
      );
      const packageData: Awaited<
        ReturnType<typeof import("../src/ai/recipes/package").readRecipePackage>
      > = await readRecipePackage(file);
      const bundledGrid = packageData.assets.find(
        (asset) => asset.id === grid.id,
      );
      if (!bundledGrid) throw Error("Missing geometry original in package");
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
      const expected = await sample();
      editor.newDocument({
        name: "Recipe destination",
        width: 120,
        height: 90,
      });
      await editor.closeDocument(source, { discardChanges: true });
      c.fillStyle = "#1020ff";
      c.fillRect(0, 0, 96, 72);
      const collision = await canvas.convertToBlob();
      for (const id of [grid.id, artwork.id])
        await editor.assetStore.add(
          collision,
          "Unrelated receiving source",
          id,
          false,
        );
      const before = editor.document.toJSON(),
        past = editor.document.getSnapshot().past.length;
      await editor.recipes.executeRecipePackage(file);
      const saved = editor.document.toJSON(),
        actual = await sample(),
        copied = editor.document.layers.at(0) as InstanceType<
          typeof RasterLayer
        >,
        reference = copied.mask!.plane!.reference;
      if (typeof reference.assetId !== "string")
        throw Error("Missing mapped recipe grid");
      const gridId = reference.assetId,
        artworkId = copied.assetId,
        mask = copied.mask!.toJSON(),
        oneUndo = editor.document.getSnapshot().past.length === past + 1;
      editor.document.undo();
      const undo =
        JSON.stringify(before) === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo =
        JSON.stringify(saved) === JSON.stringify(editor.document.toJSON());
      const project = await editor.saveProject();
      await editor.openProject(new File([project], "recorded-mask-plane.luma"));
      const reopenedPixels = await sample(),
        original = new Uint8Array(
          await editor.assetStore.get(gridId).blob.arrayBuffer(),
        ),
        bundled = new Uint8Array(await bundledGrid.blob.arrayBuffer());
      return {
        oneUndo,
        undo,
        redo,
        pixelsExact: actual.every((v, i) => v === expected[i]),
        reopenedPixels: reopenedPixels.every((v, i) => v === expected[i]),
        reopenedModel:
          JSON.stringify(saved) === JSON.stringify(editor.document.toJSON()),
        remapped: gridId !== grid.id && artworkId !== artwork.id,
        geometryOriginalExact:
          original.length === bytes.length &&
          original.every((v, i) => v === bytes[i]),
        packageOriginalExact:
          bundled.length === bytes.length &&
          bundled.every((v, i) => v === bytes[i]),
        native: [
          editor.assetStore.get(gridId).width,
          editor.assetStore.get(gridId).height,
        ],
        mask,
        packageAssets: packageData.assets.map((asset) => ({
          id: asset.id,
          bytes: asset.blob.size,
        })),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await writeFile(
    info.outputPath("mask-plane-recipe-closure.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    oneUndo: true,
    undo: true,
    redo: true,
    pixelsExact: true,
    reopenedPixels: true,
    reopenedModel: true,
    remapped: true,
    geometryOriginalExact: true,
    packageOriginalExact: true,
    native: [131, 79],
  });
  expect(result.packageAssets).toHaveLength(2);
});
