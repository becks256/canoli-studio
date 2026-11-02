import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("mixed float paint reconstructs native ordered HDR content before reflected affine sampling and partitions", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const {
          editor,
          PaintLayer,
          PaintFill,
          LayerGroup,
          WetPaintStroke,
          PencilStroke,
          AffineTransform,
        } = window.luma,
        { tile } = await prepareHdrWetDocument(editor, bytes);
      for (const layer of editor.document.layers) layer.visible = false;
      const group = editor.document.layers.add(
          new LayerGroup({ blendMode: "normal" }),
        ),
        paint = group.layers.add(
          new PaintLayer({ name: "Mixed native paint" }),
        ),
        before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      editor.document.transaction("Mixed native content", () => {
        paint.strokes.add(
          new PaintFill({
            bounds: { x: 0, y: 0, width: 16, height: 12 },
            color: "#ff0000",
            opacity: 0.375,
          }),
        );
        paint.strokes.add(
          new WetPaintStroke({
            precision: "float32",
            brush: new PencilStroke({
              points: [{ x: 3.5, y: 4.5 }],
              opacity: 0.01,
            }),
            opacity: 0.64123,
            tiles: [tile],
          }),
        );
        paint.strokes.add(
          new WetPaintStroke({
            precision: "float32",
            brush: new PencilStroke({ points: [{ x: -2.5, y: 4.5 }] }),
            opacity: 0.375,
            tiles: [{ ...tile, x: -3 }],
          }),
        );
        paint.strokes.add(
          new PaintFill({
            bounds: { x: 3, y: 4, width: 1, height: 1 },
            erase: true,
            opacity: 0.125,
          }),
        );
        paint.strokes.add(
          new PaintFill({
            bounds: { x: 4, y: 4, width: 1, height: 1 },
            color: "#0000ff",
            opacity: 0.25,
          }),
        );
      });
      const scope = { x: -8, y: -8, width: 80, height: 64 },
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
      group.x = 55.25;
      group.y = 10.5;
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
              part = await scene.read({
                x: scope.x + x,
                y: scope.y + y,
                width,
                height,
              });
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
        project = await editor.saveProject();
      await editor.openProject(new File([project], "Mixed float paint.luma"));
      const reopened = await read(),
        same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer).every(
            (v, i) => v === new Uint32Array(b.buffer)[i],
          ),
        raw = (a: Float32Array) => [...new Uint8Array(a.buffer)];
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
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toMatchObject({
    one: true,
    undo: true,
    redo: true,
    partitionExact: true,
    modelExact: true,
    reopenExact: true,
  });
  for (const name of ["native", "placed", "reopened"] as const)
    await writeFile(
      info.outputPath(name + ".f32le"),
      Buffer.from(result[name]),
    );
  await writeFile(
    info.outputPath("float-wet-paint.json"),
    JSON.stringify(
      { ...result, native: undefined, placed: undefined, reopened: undefined },
      null,
      2,
    ),
  );
  const reference = spawnSync(
    "python3",
    ["scripts/check-float-wet-paint.py", info.outputDir],
    { encoding: "utf8", timeout: 120000 },
  );
  expect(reference.status, reference.stderr || reference.stdout).toBe(0);
  await writeFile(info.outputPath("independent-native.json"), reference.stdout);
});

test("float PaintLayer wet authoring retains private prefixes, HDR reservoirs, cancellation and one-shot parity", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const { editor, PaintLayer, PencilStroke, WetPaintStroke } = window.luma,
        { tile } = await prepareHdrWetDocument(editor, bytes);
      for (const layer of editor.document.layers) layer.visible = false;
      const paint = editor.document.layers.add(
        new PaintLayer({ name: "HDR reservoir" }),
      );
      paint.strokes.add(
        new WetPaintStroke({
          precision: "float32",
          brush: new PencilStroke({ points: [{ x: 3.5, y: 4.5 }] }),
          tiles: [tile],
        }),
      );
      editor.document.selectedLayer = paint;
      const points = [
          { x: 3.5, y: 4.5, pressure: 1 },
          { x: 7.5, y: 4.5, pressure: 1 },
        ],
        brush = (path: typeof points) =>
          new PencilStroke({
            points: path,
            size: 2,
            pressureSize: false,
            opacity: 0.625,
          }),
        options = {
          mode: "mixer" as const,
          load: {
            load: 0.37,
            color: [8, -4, 16, 0.25] as [number, number, number, number],
          },
          mix: { wetness: 0.2, pickup: 0.7 },
        },
        scope = { x: 0, y: 0, width: 16, height: 12 },
        read = async (
          doc = editor.document.toJSON(),
          assets = editor.assetStore,
        ) => {
          const scene = await editor.renderer.captureFloatScene(doc, assets);
          try {
            return new Uint32Array((await scene.read(scope)).buffer);
          } finally {
            scene.dispose();
          }
        },
        same = (a: Uint32Array, b: Uint32Array) =>
          a.every((word, i) => word === b[i]);
      const saved = JSON.stringify(editor.document.toJSON()),
        assets = editor.assetStore.values().length,
        past = editor.document.getSnapshot().past.length,
        job = await editor._beginWetPaint(brush(points.slice(0, 1)), options),
        prefix = await job.preview();
      if (!prefix) throw new Error("Missing prefix");
      const release = prefix.retain(),
        first = await read(prefix.document, prefix.assets);
      prefix.dispose();
      await job.append(points.slice(1));
      const final = await job.preview();
      if (!final) throw new Error("Missing final");
      const expected = await read(final.document, final.assets),
        privateState =
          saved === JSON.stringify(editor.document.toJSON()) &&
          assets === editor.assetStore.values().length;
      await job.dispose();
      const prefixAlive = same(
          first,
          await read(prefix.document, prefix.assets),
        ),
        finalAlive = same(expected, await read(final.document, final.assets));
      final.dispose();
      release();
      const operation = await editor.applyWetPaint(brush(points), options),
        actual = await read(),
        one = editor.document.getSnapshot().past.length === past + 1,
        values = new Float32Array(actual.buffer),
        extended = [...values].some((v, i) => i % 4 !== 3 && (v < 0 || v > 1));
      editor.document.undo();
      const undo = saved === JSON.stringify(editor.document.toJSON());
      const cancel = new AbortController();
      let cancelled = false;
      try {
        await editor.applyWetPaint(brush(points), {
          ...options,
          signal: cancel.signal,
          onProgress: () => cancel.abort(),
        });
      } catch {
        cancelled = true;
      }
      const cancelExact = JSON.stringify(editor.document.toJSON()) === saved;
      editor.document.selectedLayer = null;
      const freshBefore = JSON.stringify(editor.document.toJSON()),
        freshPast = editor.document.getSnapshot().past.length,
        count = editor.document.layers.length,
        fresh = await editor.applyWetPaint(
          new PencilStroke({
            points: [{ x: 20.5, y: 20.5 }],
            size: 2,
            pressureSize: false,
          }),
          {
            mode: "mixer",
            load: { color: [4, -2, 8, 0.375] },
            mix: { wetness: 0, pickup: 0 },
          },
        ),
        newLayer = editor.document.layers.at(count),
        freshOne = editor.document.getSnapshot().past.length === freshPast + 1,
        freshAfter = JSON.stringify(editor.document.toJSON());
      const freshScene = await editor.renderer.captureFloatScene(
        editor.document.toJSON(),
        editor.assetStore,
      );
      let freshColor: number[];
      try {
        freshColor = [
          ...(await freshScene.read({ x: 20, y: 20, width: 1, height: 1 })),
        ];
      } finally {
        freshScene.dispose();
      }
      const newPaint =
        newLayer instanceof PaintLayer &&
        newLayer.strokes.length === 1 &&
        fresh?.precision === "float32";
      editor.document.undo();
      const freshUndo =
        freshBefore === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const freshRedo = freshAfter === JSON.stringify(editor.document.toJSON());
      return {
        freshOne,
        freshUndo,
        freshRedo,
        freshColor,
        privateState,
        prefixAlive,
        finalAlive,
        closed: prefix.isDisposed && final.isDisposed,
        parity: same(actual, expected),
        extended,
        one,
        undo,
        cancelled,
        cancelExact,
        precision: operation?.precision,
        newPaint,
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toMatchObject({
    privateState: true,
    prefixAlive: true,
    finalAlive: true,
    closed: true,
    parity: true,
    extended: true,
    one: true,
    undo: true,
    cancelled: true,
    cancelExact: true,
    precision: "float32",
    newPaint: true,
    freshOne: true,
    freshUndo: true,
    freshRedo: true,
    freshColor: [4, -2, 8, 0.375],
  });
  await writeFile(
    info.outputPath("float-paint-authoring.json"),
    JSON.stringify(result, null, 2),
  );
});

test("isolated/plugin PaintLayer appends validate native pairs and recipe/workspace transport retains exact pixels", async ({
  page,
}, info) => {
  const example = (await readFile("docs/FLOAT_PAINT.md", "utf8")).match(
    /<!-- example: float-wet-paint -->\s*```js\n([\s\S]*?)\n```/,
  )![1];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, example }) => {
      const { prepareHdrWetDocument } = (await import(
        /* @vite-ignore */ String("/tests/helpers/hdr-wet-document.ts")
      )) as typeof import("./helpers/hdr-wet-document");
      const { editor } = window.luma;
      await prepareHdrWetDocument(editor, bytes);
      for (const layer of editor.document.layers) layer.visible = false;
      await editor.runScript(example);
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      const code = (name: string) =>
        `const output=[...document.layers].find(layer=>layer.name==='HDR wet output');const coverage=[...document.layers].find(layer=>layer.name===${JSON.stringify(name)});document.selectedLayer.strokes.add(new WetPaintStroke({precision:'float32',brush:new PencilStroke({points:[{x:3.5,y:4.5}]}),tiles:[{x:3,y:4,width:2,height:1,assetId:output.assetId,coverage:{assetId:coverage.assetId}}]}));`;
      let invalid = "";
      try {
        await editor.runScript(code("HDR wet invalid coverage"));
      } catch (error) {
        invalid = String(error);
      }
      const atomic =
        before === JSON.stringify(editor.document.toJSON()) &&
        editor.document.getSnapshot().past.length === past;
      const plugin = {
        format: "luma-plugin" as const,
        apiVersion: 1 as const,
        id: "float-wet-paint-test",
        name: "Native paint",
        version: "1.0.0",
        description: "Native prepared appends",
        permissions: ["document:read", "document:write"] as (
          "document:read" | "document:write"
        )[],
        commands: [
          { id: "apply", title: "Apply", source: code("HDR wet coverage") },
        ],
      };
      editor.plugins.install(plugin);
      const inert = before === JSON.stringify(editor.document.toJSON());
      const read = async () => {
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
          a.every((word, i) => word === b[i]);
      editor.recipes.startRecording();
      await editor.runPlugin(plugin.id, "apply");
      const expected = await read(),
        recipe = await editor.recipes.stopRecording({
          name: "Prepared HDR paint append",
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
      const recovered = retained === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = after === JSON.stringify(editor.document.toJSON()),
        workspace = same(expected, await read());
      return {
        invalid,
        atomic,
        inert,
        undo,
        replay,
        recovered,
        redo,
        workspace,
        actions: recipe.steps.map((step) => step.action.type),
      };
    },
    {
      bytes: [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
      example,
    },
  );
  expect(result.invalid).toMatch(/already be masked/);
  expect(result).toMatchObject({
    atomic: true,
    inert: true,
    undo: true,
    replay: true,
    recovered: true,
    redo: true,
    workspace: true,
    actions: ["paint.add"],
  });
  await writeFile(
    info.outputPath("float-wet-paint-transport.json"),
    JSON.stringify(result, null, 2),
  );
});

test("float PaintLayer wet authoring over a genuine 50 MP original retains source words and bounded native edit history", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PaintLayer, PaintFill, PencilStroke, RasterLayer } =
        window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "50mp-native.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const original = editor.document.layers.at(0);
      if (!(original instanceof RasterLayer)) throw new Error("No original");
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
        base = await read();
      const paint = editor.document.layers.add(new PaintLayer());
      paint.strokes.add(
        new PaintFill({
          bounds: { x: 2, y: 3, width: 4, height: 4 },
          color: "#ff0000",
        }),
      );
      editor.document.selectedLayer = paint;
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length,
        opacity = 0.64123,
        operation = await editor.applyWetPaint(
          new PencilStroke({
            points: [{ x: 3.5, y: 4.5 }],
            size: 2,
            pressureSize: false,
            opacity,
          }),
          {
            mode: "mixer",
            load: { color: [4, -2, 8, 0.375] },
            mix: { wetness: 0, pickup: 0 },
          },
        ),
        actual = await read(),
        keep = 1 - opacity,
        a = 0.375 * opacity + keep,
        front = new Float32Array([
          (4 * 0.375 * opacity + keep) / a,
          (-2 * 0.375 * opacity) / a,
          (8 * 0.375 * opacity) / a,
          a,
        ]),
        at = (4 * 64 + 3) * 4,
        b = base[at + 3] * (1 - front[3]),
        alpha = front[3] + b,
        expected = new Float32Array([
          (front[0] * front[3] + base[at] * b) / alpha,
          (front[1] * front[3] + base[at + 1] * b) / alpha,
          (front[2] * front[3] + base[at + 2] * b) / alpha,
          alpha,
        ]);
      const windowExpected = base.slice();
      for (let y = 3; y < 7; y++)
        for (let x = 2; x < 6; x++) {
          const pixel = (y * 64 + x) * 4,
            fg = x < 4 && y < 5 ? front : new Float32Array([1, 0, 0, 1]),
            back = base[pixel + 3] * (1 - fg[3]),
            alpha = fg[3] + back;
          for (let channel = 0; channel < 3; channel++)
            windowExpected[pixel + channel] =
              (fg[channel] * fg[3] + base[pixel + channel] * back) / alpha;
          windowExpected[pixel + 3] = alpha;
        }
      const windowExact = new Uint32Array(actual.buffer).every(
        (word, i) => word === new Uint32Array(windowExpected.buffer)[i],
      );
      const one = editor.document.getSnapshot().past.length === past + 1,
        centerExact = new Uint32Array(actual.slice(at, at + 4).buffer).every(
          (v, i) => v === new Uint32Array(expected.buffer)[i],
        ),
        after = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = after === JSON.stringify(editor.document.toJSON()),
        asset = editor.assetStore.get(original.assetId),
        raw = new Uint8Array(await asset.blob.arrayBuffer());
      return {
        scope,
        dimensions: [asset.width, asset.height],
        words: actual.length,
        precision: operation?.precision,
        one,
        undo,
        redo,
        centerExact,
        windowExact,
        sourceExact:
          raw.length === bytes.length && raw.every((v, i) => v === bytes[i]),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
  );
  expect(result).toMatchObject({
    dimensions: [10000, 5000],
    words: 64 * 48 * 4,
    precision: "float32",
    one: true,
    undo: true,
    redo: true,
    centerExact: true,
    windowExact: true,
    sourceExact: true,
  });
  await writeFile(
    info.outputPath("float-wet-paint-50mp.json"),
    JSON.stringify(result, null, 2),
  );
});

test("fresh byte wet layers preserve one Undo and source-bearing recipe replay after attachment", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, PencilStroke, PaintLayer } = window.luma;
    editor.newDocument({ width: 32, height: 32 });
    editor.document.selectedLayer = null;
    const before = JSON.stringify(editor.document.toJSON()),
      past = editor.document.getSnapshot().past.length;
    editor.recipes.startRecording();
    const operation = await editor.applyWetPaint(
        new PencilStroke({
          points: [{ x: 10.5, y: 10.5 }],
          size: 2,
          pressureSize: false,
          color: "#208040",
          opacity: 0.625,
        }),
        { mode: "mixer", mix: { wetness: 0, pickup: 0 } },
      ),
      recipe = await editor.recipes.stopRecording({
        name: "Fresh byte wet paint",
      }),
      one = editor.document.getSnapshot().past.length === past + 1,
      paint = editor.document.layers.at(0);
    const pixels = new Uint8Array(
        await (await editor.exportPng()).arrayBuffer(),
      ),
      file = await editor.recipes.exportRecipePackage(recipe),
      actions = recipe.steps.map((step) => step.action.type);
    editor.document.undo();
    const undo = before === JSON.stringify(editor.document.toJSON());
    await editor.recipes.executeRecipePackage(file);
    const replay = new Uint8Array(
      await (await editor.exportPng()).arrayBuffer(),
    );
    return {
      one,
      undo,
      paint: paint instanceof PaintLayer,
      byte: operation?.precision === undefined,
      actions,
      pixelsExact:
        pixels.length === replay.length &&
        pixels.every((v, i) => v === replay[i]),
    };
  });
  expect(result).toEqual({
    one: true,
    undo: true,
    paint: true,
    byte: true,
    actions: ["layer.add", "paint.add"],
    pixelsExact: true,
  });
  await writeFile(
    info.outputPath("fresh-byte-wet-paint.json"),
    JSON.stringify(result, null, 2),
  );
});
