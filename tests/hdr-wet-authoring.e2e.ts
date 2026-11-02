import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("trusted Float32 wet authoring commits unclipped native pixels, exact envelope and TIFF sources through one Undo", async ({
  page,
}, info) => {
  const code = (await readFile("docs/HDR_WET_DOCUMENTS.md", "utf8")).match(
    /<!-- example: hdr-wet-authored -->\s*```js\n([\s\S]*?)\n```/,
  )![1];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, code }) => {
      const { editor, PencilStroke, RasterLayer } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native HDR authoring.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const target = editor.document.layers.at(0);
      if (!(target instanceof RasterLayer)) throw new Error("No native target");
      editor.document.selectedLayer = target;
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
        before = await read(),
        saved = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length,
        count = editor.assetStore.values().length;
      const opacity = 0.64123,
        operation = await new Function(
          "editor",
          "PencilStroke",
          "return (async()=>{" + code + ";return result;})()",
        )(editor, PencilStroke);
      if (!operation) throw new Error("No HDR operation");
      const after = await read(),
        edited = JSON.stringify(editor.document.toJSON()),
        oneUndo = editor.document.getSnapshot().past.length === past + 1,
        files = [];
      for (const tile of operation.tiles) {
        for (const [kind, id] of [
          ["pixels", tile.assetId],
          ["coverage", tile.coverage.assetId],
        ] as const) {
          const asset = editor.assetStore.get(id);
          files.push({
            kind,
            id,
            region: {
              x: tile.x,
              y: tile.y,
              width: tile.width,
              height: tile.height,
            },
            type: asset.blob.type,
            precision: asset.tiff?.editingPrecision,
            bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
          });
        }
      }
      editor.document.undo();
      const undo = saved === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = edited === JSON.stringify(editor.document.toJSON()),
        project = await editor.saveProject();
      await editor.openProject(new File([project], "authored-HDR.luma"));
      const reopened = await read(),
        modelExact = edited === JSON.stringify(editor.document.toJSON()),
        asset = editor.assetStore.get(target.assetId),
        source = new Uint8Array(await asset.blob.arrayBuffer()),
        words = (a: Float32Array) => [...new Uint8Array(a.buffer)];
      return {
        oneUndo,
        undo,
        redo,
        modelExact,
        sourceExact:
          source.length === bytes.length &&
          source.every((v, i) => v === bytes[i]),
        added: editor.assetStore.values().length - count,
        precision: operation.precision,
        load: operation.load,
        mix: operation.mix,
        operationOpacity: operation.opacity,
        brushOpacity: operation.brush.opacity,
        scope,
        opacity,
        files,
        before: words(before),
        after: words(after),
        reopened: words(reopened),
      };
    },
    {
      bytes: [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
      code,
    },
  );
  expect(result).toMatchObject({
    oneUndo: true,
    undo: true,
    redo: true,
    modelExact: true,
    sourceExact: true,
    precision: "float32",
    operationOpacity: 1,
    brushOpacity: 0.64123,
  });
  expect(result.added).toBeGreaterThan(0);
  expect(
    result.files.every(
      (file) => file.type === "image/tiff" && file.precision === "float32",
    ),
  ).toBe(true);
  for (const name of ["before", "after", "reopened"] as const)
    await writeFile(
      info.outputPath(name + ".f32le"),
      Buffer.from(result[name]),
    );
  for (let index = 0; index < result.files.length; index++)
    await writeFile(
      info.outputPath(index + "-" + result.files[index].kind + ".tif"),
      Buffer.from(result.files[index].bytes),
    );
  await writeFile(
    info.outputPath("hdr-authoring.json"),
    JSON.stringify(
      {
        ...result,
        before: undefined,
        after: undefined,
        reopened: undefined,
        files: result.files.map(({ bytes, ...file }, index) => ({
          ...file,
          file: index + "-" + file.kind + ".tif",
        })),
      },
      null,
      2,
    ),
  );
  const reference = spawnSync(
    process.env.CANOLI_REFERENCE_PYTHON ?? "python3",
    ["scripts/check-hdr-wet-authoring.py", info.outputDir],
    { encoding: "utf8", timeout: 120000 },
  );
  expect(reference.status, reference.stderr || reference.stdout).toBe(0);
  await writeFile(
    info.outputPath("independent-hdr-authoring.json"),
    reference.stdout,
  );
});

test("retained native HDR previews own their files through append, cancellation, lease retirement and a matching one-shot commit", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PencilStroke } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Retained HDR.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.selectedLayer = editor.document.layers.at(0);
      const points = [
          { x: 20, y: 20, pressure: 1 },
          { x: 26, y: 24, pressure: 1 },
          { x: 22, y: 29, pressure: 1 },
        ],
        brush = (path: typeof points) =>
          new PencilStroke({
            size: 7,
            pressureSize: false,
            opacity: 0.625,
            flow: 0.7,
            points: path,
          }),
        options = {
          mode: "mixer" as const,
          load: {
            color: [4, -2, 8, 0.375] as [number, number, number, number],
            load: 0.37,
          },
          mix: { wetness: 0.2, pickup: 0.7 },
        },
        scope = { x: 0, y: 0, width: 64, height: 48 },
        before = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length;
      const read = async (
          document = editor.document.toJSON(),
          store = editor.assetStore,
        ) => {
          const scene = await editor.renderer.captureFloatScene(
            document,
            store,
          );
          try {
            return await scene.read(scope);
          } finally {
            scene.dispose();
          }
        },
        same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer).every(
            (v, i) => v === new Uint32Array(b.buffer)[i],
          );
      const job = await editor._beginWetPaint(
          brush(points.slice(0, 1)),
          options,
        ),
        first = await job.preview();
      if (!first) throw new Error("No native prefix");
      const release = first.retain(),
        prefix = await read(first.document, first.assets);
      first.dispose();
      await job.append(points.slice(1));
      const final = await job.preview();
      if (!final) throw new Error("No complete preview");
      const preview = await read(final.document, final.assets),
        unchanged =
          before === JSON.stringify(editor.document.toJSON()) &&
          editor.assetStore.values().length === assets;
      await job.dispose();
      const retained = same(prefix, await read(first.document, first.assets)),
        finalRetained = same(preview, await read(final.document, final.assets)),
        inactive = !first.isCurrent() && !final.isCurrent();
      final.dispose();
      release();
      await editor.applyWetPaint(brush(points), options);
      const committed = await read(),
        matches = same(preview, committed),
        reopenedSources = editor.assetStore
          .values()
          .filter((asset) => asset.name.startsWith("Wet-paint"))
          .every((asset) => asset.tiff?.editingPrecision === "float32");
      editor.document.undo();
      return {
        unchanged,
        retained,
        finalRetained,
        inactive,
        closed: first.isDisposed && final.isDisposed,
        matches,
        reopenedSources,
        undo: before === JSON.stringify(editor.document.toJSON()),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await writeFile(
    info.outputPath("hdr-private-prefixes.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toEqual({
    unchanged: true,
    retained: true,
    finalRetained: true,
    inactive: true,
    closed: true,
    matches: true,
    reopenedSources: true,
    undo: true,
  });
});

test("HDR preparation rejects stale original interpretation, human changes and cancellation without publishing files or leaking private storage", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PencilStroke, RasterLayer } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Guarded HDR.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const layer = editor.document.layers.at(0);
      if (!(layer instanceof RasterLayer)) throw new Error("No raster");
      editor.document.selectedLayer = layer;
      const brush = new PencilStroke({
          size: 3,
          pressureSize: false,
          points: [{ x: 4.5, y: 4.5 }],
          color: "#ff0000",
        }),
        options = { mode: "mixer" as const, mix: { wetness: 0, pickup: 0 } },
        saved = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length,
        databases = async () =>
          (await indexedDB.databases())
            .map((db) => db.name)
            .filter((name) => name?.startsWith("canoli-wet-job-"))
            .sort(),
        db = JSON.stringify(await databases());
      const rejected = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return false;
        } catch {
          return true;
        }
      };
      const noop = await editor.applyWetPaint(brush, {
          ...options,
          mix: { flow: 0 },
        }),
        noopExact = saved === JSON.stringify(editor.document.toJSON());
      const abort = new AbortController(),
        cancelled = await rejected(() =>
          editor.applyWetPaint(brush, {
            ...options,
            signal: abort.signal,
            onProgress: () => abort.abort(),
          }),
        ),
        cancelExact = saved === JSON.stringify(editor.document.toJSON());
      const job = await editor._beginWetPaint(brush, options),
        frame = await job.preview();
      if (!frame) throw new Error("No guarded prefix");
      const source = editor.assetStore.get(layer.assetId),
        original = source.tiff;
      Object.assign(source, { tiff: { ...original } });
      const staleInterpretation = await rejected(() => job.commit());
      Object.assign(source, { tiff: original });
      await job.dispose();
      frame.dispose();
      const identityExact = saved === JSON.stringify(editor.document.toJSON());
      const selected = await editor._beginWetPaint(brush, options);
      editor.document.selectedLayer = null;
      const staleSelection = await rejected(() => selected.commit());
      await selected.dispose();
      editor.document.selectedLayer = layer;
      const changed = await rejected(() =>
          editor.applyWetPaint(brush, {
            ...options,
            onProgress: () => {
              editor.document.name = "Human HDR edit";
            },
          }),
        ),
        humanPreserved =
          editor.document.name === "Human HDR edit" &&
          (layer.toJSON() as import("../src/core/model").RasterLayerData)
            .erasures?.length !== 1;
      layer.locked = true;
      const locked = await rejected(() => editor.applyWetPaint(brush, options));
      layer.locked = false;
      const invalidAlpha = await rejected(() =>
        editor.applyWetPaint(brush, {
          ...options,
          load: { color: [4, -2, 8, 255] },
        }),
      );
      editor.document.selectedLayer = null;
      const missingTarget = await rejected(() =>
        editor.applyWetPaint(brush, {
          ...options,
          targetId: "missing-explicit-target",
        }),
      );
      return {
        noop: noop === null,
        noopExact,
        cancelled,
        cancelExact,
        staleInterpretation,
        identityExact,
        staleSelection,
        changed,
        humanPreserved,
        locked,
        invalidAlpha,
        missingTarget,
        assetsExact: assets === editor.assetStore.values().length,
        storageClean: db === JSON.stringify(await databases()),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await writeFile(
    info.outputPath("hdr-guards.json"),
    JSON.stringify(result, null, 2),
  );
  expect(Object.values(result).every(Boolean), JSON.stringify(result)).toBe(
    true,
  );
});

test("captured projected HDR authoring retains native previews through reflection, source resize, reset and source-bearing recipes/workspace", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const {
        editor,
        PencilStroke,
        RasterLayer,
        PerspectiveTransform,
        AffineTransform,
      } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Projected HDR.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const layer = editor.document.layers.at(0);
      if (!(layer instanceof RasterLayer)) throw new Error("No raster");
      layer.width = 65.5;
      layer.height = 39.5;
      layer.transform = new AffineTransform(-1, 0.1, 0.25, 1, 100, 4);
      layer.perspective = new PerspectiveTransform({
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.75, y: 1 },
          { x: 0.125, y: 1 },
        ],
      });
      editor.document.selectedLayer = layer;
      const scope = { x: 0, y: 0, width: 140, height: 90 },
        read = async (
          document = editor.document.toJSON(),
          assets = editor.assetStore,
        ) => {
          const scene = await editor.renderer.captureFloatScene(
            document,
            assets,
          );
          try {
            return new Uint32Array((await scene.read(scope)).buffer);
          } finally {
            scene.dispose();
          }
        },
        same = (a: Uint32Array, b: Uint32Array) =>
          a.length === b.length && a.every((word, i) => word === b[i]),
        before = JSON.stringify(editor.document.toJSON()),
        count = editor.document.getSnapshot().past.length;
      const job = await editor._beginWetPaint(
          new PencilStroke({
            size: 5,
            pressureSize: false,
            opacity: 0.625,
            points: [
              { x: 22.5, y: 18.5 },
              { x: 30.5, y: 22.5 },
            ],
          }),
          {
            space: "placed",
            mode: "mixer",
            respectSelection: false,
            load: { color: [4, -2, 8, 0.375], load: 1 },
            mix: { wetness: 0, pickup: 0 },
          },
        ),
        frame = await job.preview();
      if (!frame) throw new Error("No projected prefix");
      const preview = await read(frame.document, frame.assets);
      editor.recipes.startRecording();
      const operation = await job.commit();
      await job.dispose();
      frame.dispose();
      const actual = await read(),
        one = editor.document.getSnapshot().past.length === count + 1,
        recipe = await editor.recipes.stopRecording({
          name: "Authored HDR projected stroke",
        }),
        file = await editor.recipes.packages.get(recipe.id);
      if (!file) throw new Error("No recipe package");
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      await editor.recipes.executeRecipePackage(file);
      const recipeExact = same(actual, await read()),
        saved = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      await editor.saveWorkspace();
      await editor.restoreWorkspace();
      editor.document.redo();
      const workspaceExact = same(actual, await read()),
        modelExact = saved === JSON.stringify(editor.document.toJSON()),
        current = editor.document.layers.at(0) as InstanceType<
          typeof RasterLayer
        >;
      current.perspective = null;
      current.width = 131;
      current.height = 79;
      const reset = await read(),
        project = await editor.saveProject();
      await editor.openProject(
        new File([project], "Projected authored HDR.luma"),
      );
      const source = editor.assetStore.get(current.assetId),
        original = new Uint8Array(await source.blob.arrayBuffer());
      return {
        precision: operation?.precision,
        placed: !!operation?.placement,
        previewExact: same(preview, actual),
        one,
        undo,
        recipeExact,
        workspaceExact,
        modelExact,
        resetReopenExact: same(reset, await read()),
        sourceExact:
          original.length === bytes.length &&
          original.every((v, i) => v === bytes[i]),
        words: actual.length,
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await writeFile(
    info.outputPath("hdr-projected-authoring.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    precision: "float32",
    placed: true,
    previewExact: true,
    one: true,
    undo: true,
    recipeExact: true,
    workspaceExact: true,
    modelExact: true,
    resetReopenExact: true,
    sourceExact: true,
    words: 140 * 90 * 4,
  });
});

test("wet mask tools in a float document retain byte scalar coverage and untouched native RGB", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, RasterLayer, LayerMask } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Masked HDR.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const layer = editor.document.layers.at(0);
      if (!(layer instanceof RasterLayer)) throw new Error("No raster");
      layer.mask = new LayerMask({ base: 1 });
      editor.document.selectedLayer = layer;
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
        before = await read(),
        saved = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      editor.tools.configure({
        paintTarget: "mask-hide",
        size: 8,
        hardness: 1,
        opacity: 1,
        flow: 1,
        pressureSize: false,
        pressureOpacity: false,
        mixer: { load: 1, wetness: 0, pickup: 0 },
      });
      editor.tools.begin(
        "mixer",
        { x: 20.5, y: 20.5 },
        { alt: false, shift: false, pressure: 1 },
        1,
      );
      editor.tools.move(
        { x: 30.5, y: 20.5 },
        { alt: false, shift: false, pressure: 1 },
      );
      await editor.tools.end();
      const after = await read(),
        entry = layer.mask!.strokes.at(-1);
      if (entry?.mode !== "wet") throw new Error("No mask replacement");
      const operation = entry.stroke,
        files = operation.tiles
          .flatMap((tile) => [tile.assetId, tile.coverage.assetId])
          .map((id) => editor.assetStore.get(id));
      let changed = 0,
        rgbDifferences = 0;
      for (let p = 0; p < after.length; p += 4) {
        if (after[p + 3] !== before[p + 3]) changed++;
        if (after[p + 3])
          for (let c = 0; c < 3; c++)
            if (after[p + c] !== before[p + c]) rgbDifferences++;
      }
      const one = editor.document.getSnapshot().past.length === past + 1;
      editor.document.undo();
      return {
        byte: operation.precision === undefined,
        png: files.every(
          (file) => file.blob.type === "image/png" && !file.tiff,
        ),
        changed,
        rgbDifferences,
        one,
        undo: saved === JSON.stringify(editor.document.toJSON()),
        error: editor.tools.getSnapshot().error,
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  await writeFile(
    info.outputPath("hdr-byte-mask-authoring.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    byte: true,
    png: true,
    rgbDifferences: 0,
    one: true,
    undo: true,
    error: null,
  });
  expect(result.changed).toBeGreaterThan(0);
});

test("trusted HDR authoring on a genuine 50 MP original preserves source bytes, native geometry and one reversible window edit", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, RasterLayer, PencilStroke } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "native-50mp.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const layer = editor.document.layers.at(0);
      if (!(layer instanceof RasterLayer)) throw new Error("No raster");
      editor.document.selectedLayer = layer;
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
        before = await read(),
        saved = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      const operation = await editor.applyWetPaint(
          new PencilStroke({
            size: 2,
            opacity: 0.625,
            pressureSize: false,
            points: [{ x: 3.5, y: 4.5 }],
          }),
          {
            mode: "mixer",
            load: { color: [4, -2, 8, 0.375], load: 1 },
            mix: { wetness: 0, pickup: 0 },
          },
        ),
        after = await read(),
        at = (4 * 64 + 3) * 4,
        a = before[at + 3] * (1 - 0.625),
        b = 0.375 * 0.625,
        alpha = a + b,
        expected = new Float32Array([
          ...Array.from(
            { length: 3 },
            (_, c) => (before[at + c] * a + [4, -2, 8][c] * b) / alpha,
          ),
          alpha,
        ]),
        center = after.slice(at, at + 4),
        one = editor.document.getSnapshot().past.length === past + 1;
      const edited = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      const undo = saved === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = edited === JSON.stringify(editor.document.toJSON()),
        asset = editor.assetStore.get(layer.assetId),
        original = new Uint8Array(await asset.blob.arrayBuffer());
      return {
        scope,
        words: after.length,
        dimensions: [asset.width, asset.height],
        centerExact: new Uint32Array(center.buffer).every(
          (word, i) => word === new Uint32Array(expected.buffer)[i],
        ),
        one,
        undo,
        redo,
        precision: operation?.precision,
        sourceExact:
          original.length === bytes.length &&
          original.every((v, i) => v === bytes[i]),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
  );
  await writeFile(
    info.outputPath("hdr-authoring-50mp-window.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    words: 64 * 48 * 4,
    dimensions: [10000, 5000],
    centerExact: true,
    one: true,
    undo: true,
    redo: true,
    precision: "float32",
    sourceExact: true,
  });
});
