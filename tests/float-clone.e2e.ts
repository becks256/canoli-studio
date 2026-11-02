import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("prepared native clone example source-overs HDR originals with exact affine, partition, Undo and project transport", async ({
  page,
}, info) => {
  const example = (await readFile("docs/FLOAT_CLONE.md", "utf8")).match(
    /<!-- example: float-clone-prepared -->\s*```js\n([\s\S]*?)\n```/,
  )![1];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, example }) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const { editor, PaintLayer, PaintFill, LayerGroup, AffineTransform } =
        window.luma;
      await prepareHdrWetDocument(editor, bytes);
      for (const layer of editor.document.layers) {
        layer.visible = false;
        if (layer.name === "HDR wet output") layer.name = "Native clone source";
      }
      editor.document.layers
        .add(new PaintLayer({ name: "Clone backdrop" }))
        .strokes.add(
          new PaintFill({
            bounds: {
              x: 0,
              y: 0,
              width: editor.document.width,
              height: editor.document.height,
            },
            color: "#ff0000",
            opacity: 0.5,
          }),
        );
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      await editor.runScript(example);
      const paint = editor.document.selectedLayer;
      if (!(paint instanceof PaintLayer)) throw new Error("No clone target");
      const scope = { x: 0, y: 0, width: 131, height: 79 },
        read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read(scope);
          } finally {
            scene.dispose();
          }
        },
        native = await read(),
        after = JSON.stringify(editor.document.toJSON()),
        one = editor.document.getSnapshot().past.length === past + 1;
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = after === JSON.stringify(editor.document.toJSON());
      const group = editor.document.layers.add(
        new LayerGroup({ blendMode: "normal" }),
      );
      paint.moveTo(group);
      group.x = 80.25;
      group.y = 4.5;
      paint.transform = AffineTransform.scale(-1.5, 0.75);
      const placed = await read(),
        scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        ),
        partition = new Float32Array(placed.length);
      try {
        for (let y = 0; y < scope.height; y += 13)
          for (let x = 0; x < scope.width; x += 17) {
            const width = Math.min(17, scope.width - x),
              height = Math.min(13, scope.height - y),
              part = await scene.read({ x, y, width, height });
            for (let row = 0; row < height; row++)
              partition.set(
                part.subarray(row * width * 4, (row + 1) * width * 4),
                ((y + row) * scope.width + x) * 4,
              );
          }
      } finally {
        scene.dispose();
      }
      const model = JSON.stringify(editor.document.toJSON()),
        sources = await Promise.all(
          editor.assetStore
            .values()
            .map(async (asset) => ({
              id: asset.id,
              bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
            })),
        ),
        project = await editor.saveProject();
      await editor.openProject(new File([project], "Native clone.luma"));
      const reopened = await read(),
        same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer).every(
            (v, i) => v === new Uint32Array(b.buffer)[i],
          );
      let sourcesExact = true;
      for (const source of sources) {
        const file = new Uint8Array(
          await editor.assetStore.get(source.id).blob.arrayBuffer(),
        );
        sourcesExact &&=
          file.length === source.bytes.length &&
          file.every((v, i) => v === source.bytes[i]);
      }
      const raw = (a: Float32Array) => [...new Uint8Array(a.buffer)];
      return {
        scope,
        native: raw(native),
        placed: raw(placed),
        reopened: raw(reopened),
        one,
        undo,
        redo,
        partitionExact: same(placed, partition),
        modelExact: model === JSON.stringify(editor.document.toJSON()),
        reopenExact: same(placed, reopened),
        sourcesExact,
      };
    },
    {
      bytes: [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
      example,
    },
  );
  expect(result).toMatchObject({
    one: true,
    undo: true,
    redo: true,
    partitionExact: true,
    modelExact: true,
    reopenExact: true,
    sourcesExact: true,
  });
  for (const name of ["native", "placed", "reopened"] as const)
    await writeFile(
      info.outputPath(name + ".f32le"),
      Buffer.from(result[name]),
    );
  await writeFile(
    info.outputPath("float-clone.json"),
    JSON.stringify(
      { ...result, native: undefined, placed: undefined, reopened: undefined },
      null,
      2,
    ),
  );
  const reference = spawnSync(
    "python3",
    ["scripts/check-float-clone.py", info.outputDir],
    { encoding: "utf8", timeout: 120000 },
  );
  expect(reference.status, reference.stderr || reference.stdout).toBe(0);
  await writeFile(
    info.outputPath("independent-native-clone.json"),
    reference.stdout,
  );
});

test("native Clone gesture previews original HDR words privately and commits identical source-over through one Undo", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const { execute } = (await import(
        /* @vite-ignore */ String("/src/core/commands.ts")
      )) as typeof import("../src/core/commands");
      const { editor, PaintLayer, PaintFill, RasterLayer } = window.luma;
      await prepareHdrWetDocument(editor, bytes);
      for (const layer of editor.document.layers) {
        layer.visible = false;
        if (layer.name === "HDR wet output" && layer instanceof RasterLayer) {
          layer.visible = true;
          layer.width = 32;
          layer.height = 16;
        }
      }
      const paint = editor.document.layers.add(
        new PaintLayer({ name: "Clone gesture target" }),
      );
      paint.strokes.add(
        new PaintFill({
          bounds: { x: 40, y: 20, width: 24, height: 24 },
          color: "#ff0000",
          opacity: 0.5,
        }),
      );
      editor.document.selectedLayer = paint;
      editor.tools.configure({
        size: 4,
        hardness: 1,
        opacity: 0.64123,
        flow: 1,
        pressureSize: false,
        pressureOpacity: false,
      });
      const mods = { alt: false, shift: false, pressure: 1 },
        scope = { x: 0, y: 0, width: 64, height: 48 },
        same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer).every(
            (v, i) => v === new Uint32Array(b.buffer)[i],
          );
      const before = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length,
        past = editor.document.getSnapshot().past.length;
      editor.tools.begin(
        "clone",
        { x: 4.5, y: 4.5 },
        { ...mods, alt: true },
        1,
      );
      editor.tools.begin("clone", { x: 50.5, y: 30.5 }, mods, 1);
      const frame = editor.tools.getSnapshot(),
        candidate = frame.preview
          ? execute(editor.document.toJSON(), frame.preview)
          : editor.document.toJSON(),
        scene = await editor.renderer.captureFloatScene(
          candidate,
          editor.assetStore,
          {},
          frame.paintPreview,
        );
      let preview: Float32Array;
      try {
        preview = await scene.read(scope);
      } finally {
        scene.dispose();
      }
      const privateState =
          before === JSON.stringify(editor.document.toJSON()) &&
          assets === editor.assetStore.values().length,
        source = frame.paintPreview?.floatCloneSource;
      await editor.tools.end();
      const read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read(scope);
          } finally {
            scene.dispose();
          }
        },
        actual = await read(),
        at = (30 * 64 + 50) * 4,
        sa = 0.375 * 0.64123,
        keep = 0.5 * (1 - sa),
        alpha = sa + keep,
        expected = new Float32Array([
          (4 * sa + keep) / alpha,
          (-2 * sa) / alpha,
          (8 * sa) / alpha,
          alpha,
        ]);
      const edited = JSON.stringify(editor.document.toJSON()),
        one = editor.document.getSnapshot().past.length === past + 1,
        operation = paint.strokes.at(1)!.toJSON();
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      return {
        privateState,
        previewExact: same(preview!, actual),
        one,
        undo,
        redo: edited === JSON.stringify(editor.document.toJSON()),
        sourceClosed: source?.isDisposed,
        center: [...actual.subarray(at, at + 4)],
        expected: [...expected],
        operation,
        allNative:
          operation.kind === "clone" &&
          operation.tiles.every(
            (tile) =>
              editor.assetStore.get(tile.assetId).tiff?.editingPrecision ===
              "float32",
          ),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toMatchObject({
    privateState: true,
    previewExact: true,
    one: true,
    undo: true,
    redo: true,
    sourceClosed: true,
    allNative: true,
    operation: { kind: "clone", precision: "float32", opacity: 0.64123 },
  });
  expect(result.center).toEqual(result.expected);
  await writeFile(
    info.outputPath("native-clone-gesture.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native Clone cancellation, source interpretation and selected-layer changes publish no assets or history", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Guarded clone.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const target = editor.document.layers.at(0)!;
      editor.document.selectedLayer = target;
      editor.tools.configure({
        size: 4,
        hardness: 1,
        opacity: 0.625,
        pressureSize: false,
        pressureOpacity: false,
      });
      const mods = { alt: false, shift: false, pressure: 1 },
        before = JSON.stringify(editor.document.toJSON()),
        count = editor.assetStore.values().length,
        past = editor.document.getSnapshot().past.length;
      const begin = () => {
          editor.tools.begin(
            "clone",
            { x: 4.5, y: 4.5 },
            { ...mods, alt: true },
            1,
          );
          editor.tools.begin("clone", { x: 50.5, y: 30.5 }, mods, 1);
        },
        rejected = async (run: () => Promise<unknown>) => {
          try {
            await run();
            return false;
          } catch {
            return true;
          }
        };
      begin();
      const frame = editor.tools.getSnapshot().paintPreview!,
        source = frame.floatCloneSource!;
      await source.read({ x: 49, y: 29, width: 3, height: 3 });
      editor.tools.cancel();
      const cancelled = source.isDisposed,
        unchanged =
          before === JSON.stringify(editor.document.toJSON()) &&
          count === editor.assetStore.values().length;
      begin();
      const native = editor.assetStore.values()[0],
        choice = native.tiff;
      Object.assign(native, { tiff: { ...choice } });
      const stale = await rejected(() => editor.tools.end());
      Object.assign(native, { tiff: choice });
      editor.tools.cancel();
      begin();
      editor.document.selectedLayer = null;
      const selection = await rejected(() => editor.tools.end());
      editor.tools.cancel();
      editor.document.selectedLayer = target;
      return {
        cancelled,
        unchanged,
        stale,
        selection,
        modelExact: before === JSON.stringify(editor.document.toJSON()),
        assetsExact: count === editor.assetStore.values().length,
        historyExact: past === editor.document.getSnapshot().past.length,
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toEqual({
    cancelled: true,
    unchanged: true,
    stale: true,
    selection: true,
    modelExact: true,
    assetsExact: true,
    historyExact: true,
  });
  await writeFile(
    info.outputPath("native-clone-guards.json"),
    JSON.stringify(result, null, 2),
  );
});

test("isolated/plugin native clone validation, recorded recipes and redo-only workspace retain original sources", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const { editor, PaintLayer } = window.luma;
      await prepareHdrWetDocument(editor, bytes);
      const paint = editor.document.layers.add(
        new PaintLayer({ name: "Clone transport" }),
      );
      editor.document.selectedLayer = paint;
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length,
        code = (width: number) =>
          `const source=[...document.layers].find(layer=>layer.name==='HDR wet output');document.selectedLayer.strokes.add(new CloneStroke({precision:'float32',points:[{x:20.5,y:20.5}],size:12,hardness:1,pressureSize:false,opacity:.64123,tiles:[{x:20,y:20,width:${width},height:1,assetId:source.assetId}]}));`;
      let invalid = "";
      try {
        await editor.runScript(`document.name='Must roll back';` + code(1));
      } catch (error) {
        invalid = String(error);
      }
      const atomic =
        before === JSON.stringify(editor.document.toJSON()) &&
        past === editor.document.getSnapshot().past.length;
      const manifest = {
        format: "luma-plugin" as const,
        apiVersion: 1 as const,
        id: "native-clone-test",
        name: "Native clone",
        version: "1.0.0",
        description: "Prepared native clone",
        permissions: ["document:read", "document:write"] as (
          "document:read" | "document:write"
        )[],
        commands: [{ id: "apply", title: "Apply clone", source: code(2) }],
      };
      editor.plugins.install(manifest);
      const inert = before === JSON.stringify(editor.document.toJSON()),
        read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return new Uint32Array(
              (await scene.read({ x: 0, y: 0, width: 64, height: 48 })).buffer,
            );
          } finally {
            scene.dispose();
          }
        },
        same = (a: Uint32Array, b: Uint32Array) =>
          a.every((v, i) => v === b[i]);
      editor.recipes.startRecording();
      await editor.runPlugin(manifest.id, "apply");
      const expected = await read(),
        recipe = await editor.recipes.stopRecording({
          name: "Native clone append",
        }),
        file = await editor.recipes.exportRecipePackage(recipe);
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      await editor.recipes.executeRecipePackage(file);
      const replay = same(expected, await read()),
        after = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      const retained = JSON.stringify(editor.document.toJSON());
      await editor.saveWorkspace();
      await editor.restoreWorkspace();
      const restored = retained === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      return {
        invalid,
        atomic,
        inert,
        undo,
        replay,
        restored,
        redo: after === JSON.stringify(editor.document.toJSON()),
        workspaceExact: same(expected, await read()),
        actions: recipe.steps.map((step) => step.action.type),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result.invalid).toMatch(/dimensions/);
  expect(result).toMatchObject({
    atomic: true,
    inert: true,
    undo: true,
    replay: true,
    restored: true,
    redo: true,
    workspaceExact: true,
    actions: ["paint.add"],
  });
  await writeFile(
    info.outputPath("native-clone-transport.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const wet of [false, true])
  test(`affine native Clone preserves textured pressure/symmetry/selection previews and source files, wet ${wet}`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const result = await page.evaluate(
      async ({ bytes, wet }) => {
        const { prepareHdrWetDocument } = (await import(
          /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
        )) as typeof import("./helpers/hdr-wet-document");
        const {
            editor,
            PaintLayer,
            PaintFill,
            RasterLayer,
            LayerGroup,
            LayerMask,
            LayerStyle,
            MarqueeSelection,
            AffineTransform,
            BrushSymmetry,
            WetPaintStroke,
            PencilStroke,
          } = window.luma,
          { tile } = await prepareHdrWetDocument(editor, bytes);
        editor.document.resize(160, 120);
        for (const layer of editor.document.layers) {
          layer.visible = false;
          if (layer.name === "HDR wet output" && layer instanceof RasterLayer) {
            layer.visible = true;
            layer.width = 64;
            layer.height = 32;
          }
        }
        const texture = new OffscreenCanvas(3, 2),
          context = texture.getContext("2d")!;
        context.fillStyle = "white";
        context.fillRect(0, 0, 2, 2);
        const source = await editor.assetStore.add(
          await texture.convertToBlob(),
          "Clone coverage",
          undefined,
          false,
        );
        editor.brushTextureSource.capture(editor.assetStore, source.id);
        const group = editor.document.layers.add(
            new LayerGroup({ blendMode: "normal", opacity: 0.75 }),
          ),
          paint = group.layers.add(
            new PaintLayer({ opacity: 0.625, fillOpacity: 0.5 }),
          );
        group.transform = new AffineTransform(-0.8, 0.2, 0.1, 1.2, 130, 50);
        paint.mask = new LayerMask({ base: 0.75 });
        paint.styles = new LayerStyle({
          colorOverlay: { enabled: true, color: "#0040ff", opacity: 0.125 },
        });
        paint.strokes.add(
          new PaintFill({
            bounds: { x: 0, y: 0, width: 64, height: 48 },
            color: "#ff0000",
            opacity: 0.5,
          }),
        );
        if (wet)
          paint.strokes.add(
            new WetPaintStroke({
              precision: "float32",
              brush: new PencilStroke({ points: [{ x: 2.5, y: 2.5 }] }),
              tiles: [{ ...tile, x: 2, y: 2 }],
            }),
          );
        editor.document.selectedLayer = paint;
        editor.document.selection = new MarqueeSelection({
          shape: "ellipse",
          x: 75,
          y: 55,
          width: 70,
          height: 55,
        });
        editor.tools.configure({
          size: 10,
          hardness: 0.3,
          opacity: 0.64123,
          flow: 0.375,
          pressureSize: true,
          pressureOpacity: true,
          tip: { roundness: 0.4, angle: 0.25 },
          symmetry: BrushSymmetry.mirrorVertical(110).toJSON(),
          texture: { channel: "alpha", invert: false },
        });
        const mods = { alt: false, shift: false, pressure: 0.5 },
          before = JSON.stringify(editor.document.toJSON()),
          count = editor.assetStore.values().length,
          past = editor.document.getSnapshot().past.length;
        editor.tools.begin(
          "clone",
          { x: 16.5, y: 12.5 },
          { ...mods, alt: true },
          1,
        );
        editor.tools.begin("clone", { x: 99.65, y: 82.7 }, mods, 1);
        editor.tools.move({ x: 103.65, y: 85.7 }, { ...mods, pressure: 1 });
        const beforeFramePoints =
          editor.tools.getSnapshot().paintPreview!.stroke.points.length;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const state = editor.tools.getSnapshot(),
          scope = { x: 0, y: 0, width: 160, height: 120 },
          scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
            {},
            state.paintPreview,
          );
        let preview: Float32Array;
        try {
          preview = await scene.read(scope);
        } finally {
          scene.dispose();
        }
        const privateState =
          before === JSON.stringify(editor.document.toJSON()) &&
          count === editor.assetStore.values().length;
        await editor.tools.end();
        const read = async () => {
            const capture = await editor.renderer.captureFloatScene(
              editor.document.toJSON(),
              editor.assetStore,
            );
            try {
              return await capture.read(scope);
            } finally {
              capture.dispose();
            }
          },
          actual = await read(),
          same = (a: Float32Array, b: Float32Array) =>
            new Uint32Array(a.buffer).every(
              (v, i) => v === new Uint32Array(b.buffer)[i],
            ),
          one = editor.document.getSnapshot().past.length === past + 1,
          edited = JSON.stringify(editor.document.toJSON());
        editor.document.undo();
        const undo = before === JSON.stringify(editor.document.toJSON());
        editor.document.redo();
        const redo = edited === JSON.stringify(editor.document.toJSON()),
          file = await editor.saveProject();
        await editor.openProject(new File([file], "Affine native clone.luma"));
        return {
          wet,
          beforeFramePoints,
          previewPoints: state.paintPreview!.stroke.points.length,
          committedPoints: (
            paint.strokes
              .at(paint.strokes.length - 1)!
              .toJSON() as import("../src/core/drawing").BrushStrokeData
          ).points.length,
          privateState,
          previewExact: same(preview!, actual),
          one,
          undo,
          redo,
          reopenExact: same(actual, await read()),
          words: actual.length,
        };
      },
      {
        bytes: [
          ...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif")),
        ],
        wet,
      },
    );
    expect(result).toEqual({
      wet,
      beforeFramePoints: 1,
      previewPoints: 2,
      committedPoints: 2,
      privateState: true,
      previewExact: true,
      one: true,
      undo: true,
      redo: true,
      reopenExact: true,
      words: 160 * 120 * 4,
    });
    await writeFile(
      info.outputPath("affine-native-clone.json"),
      JSON.stringify(result, null, 2),
    );
  });

test("native Clone on a genuine 50 MP original preserves every word in a bounded source-over window and original ownership", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, RasterLayer, PaintLayer, AffineTransform } = window.luma,
        { renderFloatPaintCoverage } = (await import(
          /* @vite-ignore */ String("/src/engine/float-paint.ts")
        )) as typeof import("../src/engine/float-paint"),
        { BrushTextureSampler } = (await import(
          /* @vite-ignore */ String("/src/engine/brush-texture.ts")
        )) as typeof import("../src/engine/brush-texture");
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native clone 50MP.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const original = editor.document.layers.at(0);
      if (!(original instanceof RasterLayer)) throw new Error("No original");
      editor.document.selectedLayer = original;
      const scope = { x: 0, y: 0, width: 64, height: 48 },
        read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read(scope);
          } finally {
            scene.dispose();
          }
        },
        base = await read(),
        before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      editor.tools.configure({
        size: 4,
        hardness: 1,
        opacity: 0.64123,
        flow: 1,
        pressureSize: false,
        pressureOpacity: false,
      });
      const mods = { alt: false, shift: false, pressure: 1 };
      editor.tools.begin(
        "clone",
        { x: 4.5, y: 4.5 },
        { ...mods, alt: true },
        1,
      );
      editor.tools.begin("clone", { x: 50.5, y: 30.5 }, mods, 1);
      await editor.tools.end();
      const paint = editor.document.selectedLayer;
      if (!(paint instanceof PaintLayer)) throw new Error("No native clone");
      const operation = paint.strokes.at(0)!.toJSON();
      if (operation.kind !== "clone") throw new Error("No clone value");
      const textures = new BrushTextureSampler(editor.renderer.processor);
      let coverage: Float32Array;
      try {
        coverage = await renderFloatPaintCoverage(
          operation,
          { ...scope, sx: 1, sy: 1 },
          new AffineTransform(),
          editor.renderer.processor,
          editor.assetStore,
          textures,
          () => {},
        );
      } finally {
        textures.dispose();
      }
      const actual = await read(),
        expected = base.slice();
      for (let y = 0; y < scope.height; y++)
        for (let x = 0; x < scope.width; x++) {
          const offset = (y * scope.width + x) * 4,
            sx = x - 46,
            sy = y - 26;
          if (
            !coverage![y * scope.width + x] ||
            sx < 0 ||
            sy < 0 ||
            sx >= scope.width ||
            sy >= scope.height
          )
            continue;
          const at = (sy * scope.width + sx) * 4,
            sa = Math.fround(
              base[at + 3] * operation.opacity * coverage![y * scope.width + x],
            ),
            keep = base[offset + 3] * (1 - sa),
            alpha = sa + keep;
          if (alpha) {
            for (let c = 0; c < 3; c++)
              expected[offset + c] =
                (base[at + c] * sa + base[offset + c] * keep) / alpha;
            expected[offset + 3] = alpha;
          } else expected.fill(0, offset, offset + 4);
        }
      const one = editor.document.getSnapshot().past.length === past + 1,
        windowExact = new Uint32Array(actual.buffer).every(
          (word, i) => word === new Uint32Array(expected.buffer)[i],
        ),
        edited = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = edited === JSON.stringify(editor.document.toJSON()),
        source = editor.assetStore.get(original.assetId),
        raw = new Uint8Array(await source.blob.arrayBuffer());
      return {
        scope,
        words: actual.length,
        dimensions: [source.width, source.height],
        windowExact,
        one,
        undo,
        redo,
        sourceExact:
          raw.length === bytes.length && raw.every((v, i) => v === bytes[i]),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
  );
  expect(result).toMatchObject({
    dimensions: [10000, 5000],
    words: 64 * 48 * 4,
    windowExact: true,
    one: true,
    undo: true,
    redo: true,
    sourceExact: true,
  });
  await writeFile(
    info.outputPath("native-clone-50mp.json"),
    JSON.stringify(result, null, 2),
  );
});
