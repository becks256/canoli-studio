import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("float gradient coordinates retain exact affine partitions and half-pixels at extreme placement", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, VectorLayer, VectorPath, AffineTransform } = window.luma;
    editor.newDocument({ width: 360, height: 240 });
    await editor.convertDocumentToFloat();
    const layer = editor.document.layers.add(new VectorLayer()),
      path = layer.paths.add(
        VectorPath.rectangle({ x: 0, y: 0, width: 360, height: 240 }, 0, {
          stroke: null,
          fillGradient: {
            kind: "linear",
            start: { x: 0, y: 0 },
            end: { x: 360, y: 0 },
            transform: { a: 0.9, b: 0.13, c: 0.2, d: 1.3, e: -7, f: -5 },
            stops: [
              { position: 0, color: "#ff0000", opacity: 0.25 },
              { position: 1, color: "#0000ff", opacity: 0.75 },
            ],
          },
        }),
      );
    layer.transform = new AffineTransform(-0.9, 0.14, 0.22, 0.75, 330, 4);
    let scene = await editor.renderer.captureFloatScene(
        editor.document.toJSON(),
        editor.assetStore,
      ),
      partitionExact = false;
    try {
      const full = await scene.read({ x: 0, y: 0, width: 360, height: 240 }),
        parts = new Float32Array(full.length);
      for (let y = 0; y < 240; y += 37)
        for (let x = 0; x < 360; x += 53) {
          const width = Math.min(53, 360 - x),
            height = Math.min(37, 240 - y),
            pixels = await scene.read({ x, y, width, height });
          for (let row = 0; row < height; row++)
            parts.set(
              pixels.subarray(row * width * 4, (row + 1) * width * 4),
              ((y + row) * 360 + x) * 4,
            );
        }
      partitionExact = new Uint32Array(parts.buffer).every(
        (v, i) => v === new Uint32Array(full.buffer)[i],
      );
    } finally {
      scene.dispose();
    }
    const origin = 2 ** 52 + 32;
    layer.transform = AffineTransform.translation(origin, 0);
    const replacement = VectorPath.rectangle(
      { x: 0, y: 0, width: 8, height: 8 },
      0,
      {
        stroke: null,
        fillGradient: {
          kind: "linear",
          start: { x: 0, y: 0 },
          end: { x: 8, y: 0 },
          stops: [
            { position: 0, color: "#ff0000", opacity: 0.25 },
            { position: 1, color: "#0000ff", opacity: 0.75 },
          ],
        },
      },
    ).toJSON();
    path.update({
      points: replacement.points,
      closed: replacement.closed,
      fill: replacement.fill,
      stroke: replacement.stroke,
      strokeWidth: replacement.strokeWidth,
      fillGradient: replacement.fillGradient,
    });
    scene = await editor.renderer.captureFloatScene(
      editor.document.toJSON(),
      editor.assetStore,
    );
    try {
      return {
        partitionExact,
        extreme: [
          ...(await scene.read({ x: origin + 2, y: 2, width: 1, height: 1 })),
        ],
      };
    } finally {
      scene.dispose();
    }
  });
  expect(result).toEqual({
    partitionExact: true,
    extreme: [0.6875, 0, 0.3125, 0.40625],
  });
  await writeFile(
    info.outputPath("float-vector-native-coordinates.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native Pen anchor previews are private, match the committed float words and cancel without history", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, VectorLayer, VectorPath } = window.luma;
    editor.newDocument({ width: 131, height: 79 });
    await editor.convertDocumentToFloat();
    const layer = editor.document.layers.add(new VectorLayer()),
      path = layer.paths.add(
        VectorPath.rectangle({ x: 20, y: 20, width: 50, height: 30 }, 0, {
          stroke: "#208040",
          strokeWidth: 4,
          fillGradient: {
            kind: "linear",
            start: { x: 20, y: 0 },
            end: { x: 70, y: 0 },
            stops: [
              { position: 0, color: "#ff0000", opacity: 0.375 },
              { position: 1, color: "#0000ff", opacity: 0.75 },
            ],
          },
        }),
      );
    editor.document.selectedLayer = layer;
    editor.tools.configure({ penEditTarget: "layer" });
    const before = JSON.stringify(editor.document.toJSON()),
      past = editor.document.getSnapshot().past.length,
      mods = { alt: false, shift: false, pressure: 1 },
      read = async (model: ReturnType<typeof editor.document.toJSON>) => {
        const scene = await editor.renderer.captureFloatScene(
          model,
          editor.assetStore,
        );
        try {
          return new Uint32Array(
            (await scene.read({ x: 0, y: 0, width: 131, height: 79 })).buffer,
          );
        } finally {
          scene.dispose();
        }
      };
    editor.tools.begin("pen", { x: 20, y: 20 }, mods, 1);
    editor.tools.move({ x: 25, y: 17 }, mods);
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    const command = editor.tools.getSnapshot().preview;
    if (!command) throw new Error("No native Pen preview");
    const detached = Document.fromJSON(editor.document.toJSON());
    detached._dispatch(command);
    const preview = await read(detached.toJSON()),
      privatePreview =
        before === JSON.stringify(editor.document.toJSON()) &&
        editor.document.getSnapshot().past.length === past;
    await editor.tools.end();
    const committed = await read(editor.document.toJSON()),
      edited = JSON.stringify(editor.document.toJSON()),
      one = editor.document.getSnapshot().past.length === past + 1,
      anchor = path.points[0];
    editor.document.undo();
    const undo = before === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    editor.tools.begin("pen", anchor, mods, 1);
    editor.tools.move({ x: 28, y: 15 }, mods);
    editor.tools.cancel();
    return {
      privatePreview,
      previewExact: preview.every((v, i) => v === committed[i]),
      one,
      undo,
      anchor: { x: anchor.x, y: anchor.y },
      cancelExact: edited === JSON.stringify(editor.document.toJSON()),
    };
  });
  expect(result).toEqual({
    privatePreview: true,
    previewExact: true,
    one: true,
    undo: true,
    anchor: { x: 25, y: 17 },
    cancelExact: true,
  });
  await writeFile(
    info.outputPath("float-pen-preview.json"),
    JSON.stringify(result, null, 2),
  );
});

test("native linear and radial vector fills retain all continuous color/alpha words and exact awkward partitions", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, VectorLayer, VectorPath } = window.luma;
    editor.newDocument({ width: 600, height: 300 });
    await editor.convertDocumentToFloat();
    const layer = editor.document.layers.add(new VectorLayer()),
      path = layer.paths.add(
        VectorPath.rectangle({ x: -20, y: -20, width: 640, height: 340 }, 0, {
          stroke: null,
          fill: "#ffffff",
        }),
      ),
      rows = [];
    for (const kind of ["linear", "radial"] as const) {
      path.fillGradient =
        kind === "linear"
          ? {
              kind,
              start: { x: 0, y: 0 },
              end: { x: 600, y: 0 },
              stops: [
                { position: 0, color: "#ff0000", opacity: 0.375 },
                { position: 1, color: "#0000ff", opacity: 0.64123 },
              ],
            }
          : {
              kind,
              start: { x: 300, y: 150, radius: 0 },
              end: { x: 300, y: 150, radius: 300 },
              stops: [
                { position: 0, color: "#ff0000", opacity: 0.375 },
                { position: 1, color: "#0000ff", opacity: 0.64123 },
              ],
            };
      const scene = await editor.renderer.captureFloatScene(
        editor.document.toJSON(),
        editor.assetStore,
      );
      try {
        const all = await scene.read({ x: 0, y: 0, width: 600, height: 300 }),
          words = new Uint32Array(all.buffer),
          parts = new Float32Array(all.length);
        for (let y = 0; y < 300; y += 73)
          for (let x = 0; x < 600; x += 119) {
            const width = Math.min(119, 600 - x),
              height = Math.min(73, 300 - y),
              pixels = await scene.read({ x, y, width, height });
            for (let row = 0; row < height; row++)
              parts.set(
                pixels.subarray(row * width * 4, (row + 1) * width * 4),
                ((y + row) * 600 + x) * 4,
              );
          }
        let mismatches = 0;
        const expected = new Float32Array(4);
        for (let y = 0; y < 300; y++)
          for (let x = 0; x < 600; x++) {
            const t =
              kind === "linear"
                ? (x + 0.5) / 600
                : Math.min(1, Math.hypot(x + 0.5 - 300, y + 0.5 - 150) / 300);
            expected.set([1 - t, 0, t, 0.375 + (0.64123 - 0.375) * t]);
            const ew = new Uint32Array(expected.buffer),
              p = (y * 600 + x) * 4;
            for (let c = 0; c < 4; c++)
              if (words[p + c] !== ew[c]) mismatches++;
          }
        rows.push({
          kind,
          mismatches,
          partitionExact: new Uint32Array(parts.buffer).every(
            (v, i) => v === words[i],
          ),
          words: all.length,
          continuous: new Set(all.filter((_, i) => i % 4 === 0)).size,
        });
      } finally {
        scene.dispose();
      }
    }
    return rows;
  });
  for (const row of result) {
    expect(row.mismatches).toBe(0);
    expect(row.partitionExact).toBe(true);
    expect(row.continuous).toBeGreaterThan(256);
  }
  await writeFile(
    info.outputPath("continuous-vectors.json"),
    JSON.stringify(result, null, 2),
  );
});

test("compound curves, dashed stroke, reflected ancestry, masks, clipping and shadows keep exact native crop and project replay", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      VectorLayer,
      VectorPath,
      VectorContour,
      LayerGroup,
      LayerMask,
      MarqueeSelection,
      LayerStyle,
      AffineTransform,
      PaintLayer,
      PaintFill,
    } = window.luma;
    editor.newDocument({ width: 360, height: 240 });
    await editor.convertDocumentToFloat();
    const group = editor.document.layers.add(new LayerGroup({ x: 330, y: 8 }));
    group.transform = new AffineTransform(-0.9, 0.13, 0.21, 0.85, 330, 8);
    const layer = group.layers.add(
        new VectorLayer({ opacity: 0.64123, fillOpacity: 0.75 }),
      ),
      outside = VectorPath.ellipse(
        { x: 12, y: 14, width: 310, height: 190 },
        {
          fill: "#208040",
          stroke: "#ff8040",
          strokeWidth: 7,
          strokeDashArray: [9, 3, 2],
          strokeCap: "square",
          strokeJoin: "miter",
        },
      ),
      hole = VectorPath.rectangle({ x: 100, y: 65, width: 80, height: 55 });
    outside.subpaths.add(new VectorContour({ points: hole.points }));
    outside.fillRule = "evenodd";
    layer.paths.add(outside);
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 25,
        y: 25,
        width: 250,
        height: 180,
      }),
      density: 0.8,
      feather: 2,
    });
    layer.styles = new LayerStyle({
      dropShadow: {
        enabled: true,
        color: "#0000ff",
        opacity: 0.375,
        x: 7,
        y: 3,
        blur: 2,
      },
      colorOverlay: { enabled: true, color: "#ff0000", opacity: 0.125 },
    });
    const clip = group.layers.add(
      new PaintLayer({ clipped: true, opacity: 0.5 }),
    );
    clip.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 350, height: 240 },
        color: "#8080ff",
      }),
    );
    const read = async () => {
        const scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        );
        try {
          return await scene.read({ x: 0, y: 0, width: 360, height: 240 });
        } finally {
          scene.dispose();
        }
      },
      all = await read(),
      words = new Uint32Array(all.buffer),
      scene = await editor.renderer.captureFloatScene(
        editor.document.toJSON(),
        editor.assetStore,
      ),
      parts = new Float32Array(all.length);
    try {
      for (let y = 0; y < 240; y += 61)
        for (let x = 0; x < 360; x += 113) {
          const width = Math.min(113, 360 - x),
            height = Math.min(61, 240 - y),
            pixels = await scene.read({ x, y, width, height });
          for (let row = 0; row < height; row++)
            parts.set(
              pixels.subarray(row * width * 4, (row + 1) * width * 4),
              ((y + row) * 360 + x) * 4,
            );
        }
    } finally {
      scene.dispose();
    }
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "Vector appearance.luma"));
    const again = await read();
    return {
      partitionExact: new Uint32Array(parts.buffer).every(
        (v, i) => v === words[i],
      ),
      reopened: new Uint32Array(again.buffer).every((v, i) => v === words[i]),
      nonzero: all.filter((v, i) => i % 4 === 3 && v > 0).length,
      partial: all.filter((v, i) => i % 4 === 3 && v > 0 && v < 0.2).length,
    };
  });
  expect(result).toMatchObject({ partitionExact: true, reopened: true });
  expect(result.nonzero).toBeGreaterThan(1000);
  expect(result.partial).toBeGreaterThan(100);
  await writeFile(
    info.outputPath("vector-appearance.json"),
    JSON.stringify(result, null, 2),
  );
});

test("float vector scripts, inert plugins, semantic recipes, redo-only workspace and Boolean paths share actual history", async ({
  page,
}, info) => {
  await page.goto("/");
  const code = (await readFile("docs/FLOAT_VECTORS.md", "utf8")).match(
    /```js\n([\s\S]*?)\n```/,
  )![1];
  const result = await page.evaluate(async (code) => {
    const { editor, VectorLayer, VectorPath } = window.luma;
    editor.newDocument({ width: 131, height: 79 });
    await editor.convertDocumentToFloat();
    const before = JSON.stringify(editor.document.toJSON()),
      read = async () => {
        const scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        );
        try {
          return new Uint32Array(
            (await scene.read({ x: 0, y: 0, width: 131, height: 79 })).buffer,
          );
        } finally {
          scene.dispose();
        }
      },
      same = (a: Uint32Array, b: Uint32Array) => a.every((v, i) => v === b[i]);
    editor.recipes.startRecording();
    await editor.runScript(code);
    const expected = await read(),
      recipe = await editor.recipes.stopRecording({ name: "Linear vectors" }),
      file = await editor.recipes.exportRecipePackage(recipe);
    editor.document.undo();
    const undo = before === JSON.stringify(editor.document.toJSON());
    await editor.recipes.executeRecipePackage(file);
    const recipeExact = same(expected, await read()),
      edited = JSON.stringify(editor.document.toJSON());
    editor.document.undo();
    await editor.saveWorkspace();
    await editor.restoreWorkspace();
    editor.document.redo();
    const workspaceExact =
      edited === JSON.stringify(editor.document.toJSON()) &&
      same(expected, await read());
    const manifest = {
      format: "luma-plugin" as const,
      apiVersion: 1 as const,
      id: "float-vectors",
      name: "Float vectors",
      version: "1.0.0",
      description: "Shared paths",
      permissions: ["document:read", "document:write"] as (
        "document:read" | "document:write"
      )[],
      commands: [
        {
          id: "edit",
          title: "Edit",
          source:
            'document.layers.at(0).paths.at(0).fillGradient=null;document.layers.at(0).paths.at(0).fill="#00ff00";',
        },
      ],
    };
    editor.plugins.install(manifest);
    const inert = edited === JSON.stringify(editor.document.toJSON());
    await editor.runPlugin(manifest.id, "edit");
    const applied = !same(expected, await read());
    editor.document.undo();
    const pluginUndo = edited === JSON.stringify(editor.document.toJSON());
    editor.plugins.install({
      ...manifest,
      version: "1.0.1",
      permissions: ["document:read"],
    });
    let denied = false;
    try {
      await editor.runPlugin(manifest.id, "edit");
    } catch {
      denied = true;
    }
    const target = editor.document.layers.at(0);
    if (!(target instanceof VectorLayer)) throw new Error("No vector");
    const second = target.paths.add(
        VectorPath.rectangle({ x: 30, y: 20, width: 50, height: 40 }, 0, {
          fill: "#ff0000",
          stroke: null,
        }),
      ),
      first = target.paths.at(0)!,
      prior = JSON.stringify(editor.document.toJSON()),
      past = editor.document.getSnapshot().past.length,
      combined = await editor.document.combinePaths("subtract", [
        first,
        second,
      ]);
    const boolean =
      !!combined && editor.document.getSnapshot().past.length === past + 1;
    editor.document.undo();
    return {
      undo,
      recipeExact,
      workspaceExact,
      inert,
      applied,
      pluginUndo,
      denied,
      boolean,
      booleanUndo: prior === JSON.stringify(editor.document.toJSON()),
    };
  }, code);
  expect(Object.values(result).every(Boolean), JSON.stringify(result)).toBe(
    true,
  );
  await writeFile(
    info.outputPath("vector-shared-authority.json"),
    JSON.stringify(result, null, 2),
  );
});

test("vector gradients on a genuine 50 MP original preserve every native edit-window word, original byte and geometry", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, VectorLayer, VectorPath } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "50MP vector.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const doc = editor.document,
        asset = editor.assetStore.values()[0],
        before = JSON.stringify(doc.toJSON()),
        scope = { x: 0, y: 0, width: 64, height: 48 },
        read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            doc.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read(scope);
          } finally {
            scene.dispose();
          }
        },
        base = await read();
      doc.transaction("Native gradient on original", () => {
        doc.layers.add(new VectorLayer({ opacity: 0.64123 })).paths.add(
          VectorPath.rectangle({ x: 0, y: 0, width: 64, height: 48 }, 0, {
            stroke: null,
            fillGradient: {
              kind: "linear",
              start: { x: 0, y: 0 },
              end: { x: 64, y: 0 },
              stops: [
                { position: 0, color: "#ff0000", opacity: 0.375 },
                { position: 1, color: "#0000ff", opacity: 0.75 },
              ],
            },
          }),
        );
      });
      const actual = await read(),
        expected = new Float32Array(actual.length);
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < 64; x++) {
          const t = (x + 0.5) / 64,
            source = new Float32Array([1 - t, 0, t, 0.375 + 0.375 * t]),
            p = (y * 64 + x) * 4,
            a = source[3] * 0.64123,
            keep = base[p + 3] * (1 - a),
            alpha = a + keep;
          for (let c = 0; c < 3; c++)
            expected[p + c] = (source[c] * a + base[p + c] * keep) / alpha;
          expected[p + 3] = alpha;
        }
      const edited = JSON.stringify(doc.toJSON());
      doc.undo();
      const undo = before === JSON.stringify(doc.toJSON());
      doc.redo();
      const original = new Uint8Array(await asset.blob.arrayBuffer());
      return {
        dimensions: [doc.width, doc.height, asset.width, asset.height],
        words: actual.length,
        windowExact: new Uint32Array(actual.buffer).every(
          (v, i) => v === new Uint32Array(expected.buffer)[i],
        ),
        undo,
        redo: edited === JSON.stringify(doc.toJSON()),
        originalExact:
          original.length === bytes.length &&
          original.every((v, i) => v === bytes[i]),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
  );
  expect(result).toEqual({
    dimensions: [10000, 5000, 10000, 5000],
    words: 12288,
    windowExact: true,
    undo: true,
    redo: true,
    originalExact: true,
  });
  await writeFile(
    info.outputPath("vector-50mp-window.json"),
    JSON.stringify(result, null, 2),
  );
});
