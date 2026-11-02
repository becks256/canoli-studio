import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("editable linear paint replays native source-over, precise opacity, eraser and fill in order through project and Undo", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PaintLayer, PencilStroke, EraserStroke, PaintFill } =
        window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Paint original.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.layers.at(0)!.visible = false;
      const layer = editor.document.layers.add(
        new PaintLayer({ name: "Native editable paint" }),
      );
      editor.document.selectedLayer = layer;
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      editor.document.transaction("Native dry paint", () => {
        layer.strokes.add(
          new PencilStroke({
            points: [{ x: 20.5, y: 20.5 }],
            size: 6,
            pressureSize: false,
            color: "#ff0000",
            opacity: 0.375,
          }),
        );
        layer.strokes.add(
          new PencilStroke({
            points: [{ x: 20.5, y: 20.5 }],
            size: 4,
            pressureSize: false,
            color: "#00ff00",
            opacity: 0.64123,
          }),
        );
        layer.strokes.add(
          new EraserStroke({
            points: [{ x: 20.5, y: 20.5 }],
            size: 4,
            hardness: 1,
            pressureSize: false,
            opacity: 0.12345,
          }),
        );
        layer.strokes.add(
          new PaintFill({
            bounds: { x: 40, y: 20, width: 4, height: 4 },
            color: "#0000ff",
            opacity: 0.64123,
          }),
        );
        layer.strokes.add(
          new PaintFill({
            bounds: { x: 40, y: 20, width: 2, height: 2 },
            erase: true,
            opacity: 0.375,
          }),
        );
      });
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
        actual = await read(),
        after = JSON.stringify(editor.document.toJSON()),
        one = editor.document.getSnapshot().past.length === past + 1;
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = after === JSON.stringify(editor.document.toJSON()),
        project = await editor.saveProject();
      await editor.openProject(new File([project], "Float paint.luma"));
      const reopened = await read(),
        word = (data: Float32Array) => [...new Uint8Array(data.buffer)],
        center = (data: Float32Array, x: number, y: number) => [
          ...data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
        ];
      return {
        scope,
        actual: word(actual),
        reopened: word(reopened),
        center: center(actual, 20, 20),
        fill: center(actual, 40, 20),
        one,
        undo,
        redo,
        model: after === JSON.stringify(editor.document.toJSON()),
        operations: layer.strokes.length,
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toMatchObject({
    one: true,
    undo: true,
    redo: true,
    model: true,
    operations: 5,
  });
  expect(result.actual).toEqual(result.reopened);
  const a = 0.64123,
    b = 0.375 * (1 - a),
    alpha = Math.fround(a + b),
    color = new Float32Array([
      b / (a + b),
      a / (a + b),
      0,
      Math.fround(alpha * (1 - 0.12345)),
    ]);
  expect(result.center).toEqual([...color]);
  expect(result.fill).toEqual([
    0,
    0,
    1,
    Math.fround(Math.fround(0.64123) * (1 - 0.375)),
  ]);
  await writeFile(
    info.outputPath("native-dry-paint.f32le"),
    Buffer.from(result.actual),
  );
  await writeFile(
    info.outputPath("native-dry-paint-reopened.f32le"),
    Buffer.from(result.reopened),
  );
  await writeFile(
    info.outputPath("native-dry-paint.json"),
    JSON.stringify(
      { ...result, actual: undefined, reopened: undefined },
      null,
      2,
    ),
  );
});

test("affine float dry paint retains native crop parity, texture, pressure, symmetry, clipping, masks and appearance", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const {
        editor,
        PaintLayer,
        BrushStroke,
        EraserStroke,
        LayerGroup,
        LayerMask,
        MarqueeSelection,
        AffineTransform,
        BrushSymmetry,
      } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Paint geometry.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.layers.at(0)!.visible = false;
      const texture = new OffscreenCanvas(3, 2),
        ctx = texture.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 2, 2);
      const source = await editor.assetStore.add(
          await texture.convertToBlob(),
          "Coverage texture",
          undefined,
          false,
        ),
        group = editor.document.layers.add(new LayerGroup({ opacity: 0.75 })),
        layer = group.layers.add(new PaintLayer({ opacity: 0.625 }));
      group.transform = new AffineTransform(-1, 0.1, 0.25, 1, 65, 2);
      layer.transform = new AffineTransform(1, 0.15, -0.1, 1, 3, 4);
      layer.mask = new LayerMask({ base: 0.75 });
      layer.strokes.add(
        new BrushStroke({
          points: [
            { x: 8, y: 8, pressure: 0.5 },
            { x: 30, y: 22, pressure: 1 },
          ],
          size: 9,
          hardness: 0.3,
          opacity: 0.64123,
          flow: 0.375,
          pressureOpacity: true,
          color: "#208040",
          symmetry: BrushSymmetry.mirrorVertical(24),
          texture: { assetId: source.id, channel: "alpha", invert: false },
          clip: new MarqueeSelection({
            x: 4,
            y: 2,
            width: 38,
            height: 28,
            shape: "rectangle",
          }),
        }),
      );
      layer.strokes.add(
        new EraserStroke({
          points: [{ x: 12, y: 12 }],
          size: 3,
          pressureSize: false,
          opacity: 0.2,
        }),
      );
      const area = { x: 0, y: 0, width: 80, height: 64 },
        scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        );
      let actual: Float32Array,
        partitioned = new Float32Array(80 * 64 * 4);
      try {
        actual = await scene.read(area);
        for (let y = 0; y < 64; y += 11)
          for (let x = 0; x < 80; x += 13) {
            const width = Math.min(13, 80 - x),
              height = Math.min(11, 64 - y),
              pixels = await scene.read({ x, y, width, height });
            for (let row = 0; row < height; row++)
              partitioned.set(
                pixels.subarray(row * width * 4, (row + 1) * width * 4),
                ((y + row) * 80 + x) * 4,
              );
          }
      } finally {
        scene.dispose();
      }
      const same = (a: Float32Array, b: Float32Array) =>
          new Uint32Array(a.buffer).every(
            (word, i) => word === new Uint32Array(b.buffer)[i],
          ),
        project = await editor.saveProject();
      await editor.openProject(new File([project], "Mapped paint.luma"));
      const reopened = await editor.renderer.captureFloatScene(
        editor.document.toJSON(),
        editor.assetStore,
      );
      try {
        return {
          cropExact: same(actual!, partitioned),
          reopenedExact: same(actual!, await reopened.read(area)),
          nonzero: actual!.filter((v, i) => i % 4 === 3 && v > 0).length,
          words: actual!.length,
        };
      } finally {
        reopened.dispose();
      }
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toMatchObject({
    cropExact: true,
    reopenedExact: true,
    words: 80 * 64 * 4,
  });
  expect(result.nonzero).toBeGreaterThan(0);
  await writeFile(
    info.outputPath("float-paint-geometry.json"),
    JSON.stringify(result, null, 2),
  );
});

for (const tool of ["brush", "pencil"] as const)
  test(
    "real float " +
      tool +
      " pointer creates editable color paint, private preview, Escape and one Undo",
    async ({ page }, info) => {
      await page.goto("/");
      await page.evaluate(
        async (bytes) => {
          const { editor } = window.luma;
          await editor.openTiff(
            new File([new Uint8Array(bytes)], "Draw HDR.tif", {
              type: "image/tiff",
            }),
            { editingPrecision: "float32" },
          );
          editor.document.selectedLayer = editor.document.layers.at(0);
          editor.tools.configure({
            size: 6,
            hardness: 1,
            opacity: 0.64123,
            flow: 0.7,
            pressureSize: false,
            pressureOpacity: false,
            color: "#208040",
          });
        },
        [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
      );
      await page
        .getByRole("button", {
          name: tool === "brush" ? "Brush tool (B)" : "Pencil tool (N)",
          exact: true,
        })
        .click();
      await page.keyboard.press("Control+1");
      const before = await page.evaluate(() => ({
          model: window.luma.editor.document.toJSON(),
          past: window.luma.editor.document.getSnapshot().past.length,
          assets: window.luma.editor.assetStore.values().length,
        })),
        box = (await page.locator(".canvas-wrap").boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 42, box.y + 20, { steps: 6 });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.luma.editor.tools
                .getSnapshot()
                .paintPreview?.stroke.points.at(-1)?.x,
          ),
        )
        .toBe(42);
      const preview = await page.evaluate(async () => {
        const { editor } = window.luma,
          state = editor.tools.getSnapshot(),
          candidate = state.preview;
        if (!candidate) throw new Error("No new layer candidate");
        const { execute } = await import(
            /* @vite-ignore */ String("/src/core/commands.ts")
          ),
          doc = execute(editor.document.toJSON(), candidate),
          canvas = await editor.renderer.render(doc, editor.assetStore, {
            paintPreview: state.paintPreview,
            cache: false,
          });
        try {
          return [
            ...canvas
              .getContext("2d")!
              .getImageData(0, 0, canvas.width, canvas.height).data,
          ];
        } finally {
          canvas.width = canvas.height = 0;
        }
      });
      expect(
        await page.evaluate(() => ({
          model: window.luma.editor.document.toJSON(),
          past: window.luma.editor.document.getSnapshot().past.length,
          assets: window.luma.editor.assetStore.values().length,
        })),
      ).toEqual(before);
      await page.mouse.up();
      await expect
        .poll(() =>
          page.evaluate(() => window.luma.editor.tools.getSnapshot().drawing),
        )
        .toBe(false);
      const after = await page.evaluate(async () => {
        const { editor, PaintLayer } = window.luma,
          layer = editor.document.selectedLayer;
        if (!(layer instanceof PaintLayer))
          throw new Error("No editable paint");
        const canvas = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false },
        );
        try {
          const pixels = [
              ...canvas
                .getContext("2d")!
                .getImageData(0, 0, canvas.width, canvas.height).data,
            ],
            past = editor.document.getSnapshot().past.length,
            stroke = layer.strokes.at(0)!.toJSON();
          editor.document.undo();
          const undo = editor.document.toJSON();
          editor.document.redo();
          return {
            pixels,
            past,
            stroke,
            undo,
            error: editor.tools.getSnapshot().error,
          };
        } finally {
          canvas.width = canvas.height = 0;
        }
      });
      expect(after.pixels).toEqual(preview);
      expect(after.past).toBe(before.past + 1);
      expect(after.undo).toEqual(before.model);
      expect(after.stroke.kind).toBe(tool);
      expect(after.error).toBeNull();
      const saved = await page.evaluate(() => ({
        model: window.luma.editor.document.toJSON(),
        assets: window.luma.editor.assetStore.values().length,
      }));
      await page.mouse.move(box.x + 20, box.y + 28);
      await page.mouse.down();
      await page.mouse.move(box.x + 42, box.y + 28, { steps: 4 });
      await expect
        .poll(() =>
          page.evaluate(
            () => !!window.luma.editor.tools.getSnapshot().paintPreview,
          ),
        )
        .toBe(true);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      expect(
        await page.evaluate(() => ({
          model: window.luma.editor.document.toJSON(),
          assets: window.luma.editor.assetStore.values().length,
        })),
      ).toEqual(saved);
      await writeFile(
        info.outputPath("float-" + tool + "-pointer.json"),
        JSON.stringify(
          {
            tool,
            previewCommitExact: true,
            private: true,
            oneUndo: true,
            cancellation: true,
            stroke: after.stroke,
          },
          null,
          2,
        ),
      );
    },
  );

test("isolated editable float paint retains permissions, recipe packages and redo-only workspace state", async ({
  page,
}, info) => {
  const code = (await readFile("docs/FLOAT_PAINT.md", "utf8")).match(
    /<!-- example: float-dry-paint -->\s*```js\n([\s\S]*?)\n```/,
  )![1];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ bytes, code }) => {
      const { editor } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Script paint.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const before = JSON.stringify(editor.document.toJSON()),
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
      await editor.runScript(code);
      const expected = await read(),
        recipe = await editor.recipes.stopRecording({
          name: "Editable linear paint",
        }),
        file = await editor.recipes.exportRecipePackage(recipe);
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      await editor.recipes.executeRecipePackage(file);
      const recipeExact = same(expected, await read()),
        one = editor.document.getSnapshot().past.length === past + 1,
        edited = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      await editor.saveWorkspace();
      await editor.restoreWorkspace();
      editor.document.redo();
      const workspaceExact = same(expected, await read());
      const manifest = {
        format: "luma-plugin" as const,
        apiVersion: 1 as const,
        id: "float-paint-test",
        name: "Linear paint",
        description: "Existing write permission",
        version: "1.0.0",
        permissions: ["document:read", "document:write"] as (
          "document:read" | "document:write"
        )[],
        commands: [
          {
            id: "paint",
            title: "Paint",
            source:
              'document.layers.at(1).strokes.add(new PencilStroke({points:[{x:30.5,y:20.5}],color:"#ff0000"}));',
          },
        ],
      };
      editor.plugins.install(manifest);
      const inert = edited === JSON.stringify(editor.document.toJSON());
      await editor.runPlugin(manifest.id, "paint");
      editor.document.undo();
      const pluginUndo = edited === JSON.stringify(editor.document.toJSON());
      editor.plugins.install({
        ...manifest,
        version: "1.0.1",
        permissions: ["document:read"],
      });
      let denied = false;
      try {
        await editor.runPlugin(manifest.id, "paint");
      } catch {
        denied = true;
      }
      return {
        undo,
        recipeExact,
        one,
        workspaceExact,
        inert,
        pluginUndo,
        denied,
        modelExact: edited === JSON.stringify(editor.document.toJSON()),
      };
    },
    {
      bytes: [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
      code,
    },
  );
  expect(Object.values(result).every(Boolean), JSON.stringify(result)).toBe(
    true,
  );
  await writeFile(
    info.outputPath("float-paint-isolation-transport.json"),
    JSON.stringify(result, null, 2),
  );
});

test("editable float dry paint preserves genuine 50 MP original words and geometry through a native window and Undo", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PaintLayer, PencilStroke, RasterLayer } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "native-50mp.tif", {
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
        before = await read(),
        saved = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      editor.document.transaction("Float paint on original", () => {
        editor.document.layers
          .add(new PaintLayer())
          .strokes.add(
            new PencilStroke({
              points: [{ x: 3.5, y: 4.5 }],
              size: 2,
              pressureSize: false,
              color: "#ff0000",
              opacity: 0.625,
            }),
          );
      });
      const actual = await read(),
        at = (4 * 64 + 3) * 4,
        sa = 0.625,
        ba = before[at + 3] * (1 - sa),
        a = sa + ba,
        expected = new Float32Array([
          (sa + before[at] * ba) / a,
          (before[at + 1] * ba) / a,
          (before[at + 2] * ba) / a,
          a,
        ]),
        one = editor.document.getSnapshot().past.length === past + 1,
        centerExact = new Uint32Array(actual.slice(at, at + 4).buffer).every(
          (word, i) => word === new Uint32Array(expected.buffer)[i],
        );
      const expectedWindow = before.slice();
      for (let y = 3; y < 5; y++)
        for (let x = 2; x < 4; x++) {
          const offset = (y * 64 + x) * 4,
            keep = before[offset + 3] * (1 - 0.625),
            alpha = 0.625 + keep;
          for (let c = 0; c < 3; c++)
            expectedWindow[offset + c] =
              ((c === 0 ? 0.625 : 0) + before[offset + c] * keep) / alpha;
          expectedWindow[offset + 3] = alpha;
        }
      const windowExact = new Uint32Array(actual.buffer).every(
        (word, i) => word === new Uint32Array(expectedWindow.buffer)[i],
      );
      const edited = JSON.stringify(editor.document.toJSON());
      editor.document.undo();
      const undo = saved === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = edited === JSON.stringify(editor.document.toJSON()),
        source = editor.assetStore.get(original.assetId),
        raw = new Uint8Array(await source.blob.arrayBuffer());
      return {
        scope,
        dimensions: [source.width, source.height],
        words: actual.length,
        centerExact,
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
    centerExact: true,
    windowExact: true,
    one: true,
    undo: true,
    redo: true,
    sourceExact: true,
  });
  await writeFile(
    info.outputPath("float-paint-50mp-window.json"),
    JSON.stringify(result, null, 2),
  );
});

test("blank/editable paint conversion, New layer shortcut, Fill and Eraser share float previews and precise history", async ({
  page,
}, info) => {
  await page.goto("/");
  const conversion = await page.evaluate(async () => {
    const { editor, PaintLayer, PencilStroke } = window.luma;
    editor.newDocument({ width: 64, height: 48 });
    const layer = editor.document.layers.add(new PaintLayer());
    layer.strokes.add(
      new PencilStroke({
        points: [{ x: 20.5, y: 20.5 }],
        size: 8,
        pressureSize: false,
        color: "#ff0000",
        opacity: 0.375,
      }),
    );
    editor.document.selectedLayer = layer;
    const before = JSON.stringify(editor.document.toJSON()),
      issue = editor.floatConversionIssue;
    await editor.convertDocumentToFloat();
    const after = JSON.stringify(editor.document.toJSON());
    editor.document.undo();
    const undo = before === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    return {
      issue,
      undo,
      redo: after === JSON.stringify(editor.document.toJSON()),
      precision: editor.document.precision,
    };
  });
  expect(conversion).toEqual({
    issue: null,
    undo: true,
    redo: true,
    precision: "float32",
  });
  await expect(
    page.getByRole("button", { name: "New layer (Mod+Shift+N)", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Control+Shift+N");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(2);
  await page.keyboard.press("Control+z");
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, MarqueeSelection } = window.luma,
      layer = editor.document.layers.at(0);
    if (!(layer instanceof PaintLayer)) throw new Error("No editable paint");
    editor.document.selectedLayer = layer;
    const before = JSON.stringify(editor.document.toJSON()),
      past = editor.document.getSnapshot().past.length,
      mods = { alt: false, shift: false, pressure: 1 };
    editor.tools.configure({
      paintTarget: "layer",
      size: 4,
      hardness: 1,
      opacity: 0.64123,
      flow: 1,
      pressureSize: false,
      pressureOpacity: false,
    });
    editor.tools.begin("eraser", { x: 20.5, y: 20.5 }, mods, 1);
    const privateEraser = before === JSON.stringify(editor.document.toJSON());
    await editor.tools.end();
    const read = async (x: number, y: number) => {
        const scene = await editor.renderer.captureFloatScene(
          editor.document.toJSON(),
          editor.assetStore,
        );
        try {
          return [...(await scene.read({ x, y, width: 1, height: 1 }))];
        } finally {
          scene.dispose();
        }
      },
      erased = await read(20, 20),
      one = editor.document.getSnapshot().past.length === past + 1;
    editor.document.undo();
    const undo = before === JSON.stringify(editor.document.toJSON());
    editor.document.redo();
    editor.document.selection = new MarqueeSelection({
      x: 30,
      y: 20,
      width: 3,
      height: 3,
      shape: "rectangle",
    });
    editor.tools.configure({ color: "#0000ff", opacity: 0.375 });
    const selected = JSON.stringify(editor.document.toJSON());
    editor.tools.begin("fill", { x: 31, y: 21 }, mods, 1);
    const privateFill = selected === JSON.stringify(editor.document.toJSON());
    await editor.tools.end();
    return {
      privateEraser,
      privateFill,
      one,
      undo,
      erased,
      filled: await read(31, 21),
      ops: layer.strokes.length,
      error: editor.tools.getSnapshot().error,
    };
  });
  expect(result).toMatchObject({
    privateEraser: true,
    privateFill: true,
    one: true,
    undo: true,
    erased: [1, 0, 0, Math.fround(0.375 * (1 - 0.64123))],
    filled: [0, 0, 1, 0.375],
    ops: 3,
    error: null,
  });
  await writeFile(
    info.outputPath("float-paint-controls-conversion.json"),
    JSON.stringify({ conversion, ...result }, null, 2),
  );
});

test("float paint intrinsic alpha drives native clipping, Fill, Color Overlay and independent shadows", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PaintLayer, PaintFill, LayerStyle } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Appearance paint.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.layers.at(0)!.visible = false;
      const layer = editor.document.layers.add(
        new PaintLayer({
          name: "Styled paint",
          opacity: 0.625,
          fillOpacity: 0.5,
        }),
      );
      layer.strokes.add(
        new PaintFill({
          bounds: { x: 18, y: 18, width: 4, height: 4 },
          color: "#ff0000",
        }),
      );
      layer.styles = new LayerStyle({
        dropShadow: {
          enabled: true,
          color: "#00ff00",
          opacity: 0.5,
          x: 6,
          y: 0,
          blur: 0,
        },
        colorOverlay: { enabled: true, color: "#0000ff", opacity: 0.5 },
      });
      const read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document.toJSON(),
            editor.assetStore,
          );
          try {
            return await scene.read({ x: 0, y: 0, width: 64, height: 48 });
          } finally {
            scene.dispose();
          }
        },
        styled = await read(),
        pixel = (data: Float32Array, x: number, y: number) => [
          ...data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4),
        ],
        foreground = pixel(styled, 20, 20),
        shadow = pixel(styled, 26, 20);
      layer.styles = new LayerStyle();
      layer.opacity = 1;
      layer.fillOpacity = 1;
      const clipped = editor.document.layers.add(
        new PaintLayer({ clipped: true }),
      );
      clipped.strokes.add(
        new PaintFill({
          bounds: { x: 0, y: 0, width: 64, height: 48 },
          color: "#0000ff",
        }),
      );
      const native = await read(),
        project = await editor.saveProject();
      await editor.openProject(new File([project], "Paint appearance.luma"));
      const reopened = await read();
      return {
        foreground,
        shadow,
        inside: pixel(native, 20, 20),
        outside: pixel(native, 26, 20),
        reopened: new Uint32Array(native.buffer).every(
          (word, i) => word === new Uint32Array(reopened.buffer)[i],
        ),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toEqual({
    foreground: [0.5, 0, 0.5, 0.3125],
    shadow: [0, 1, 0, 0.3125],
    inside: [0, 0, 1, 1],
    outside: [0, 0, 0, 0],
    reopened: true,
  });
  await writeFile(
    info.outputPath("float-paint-appearance.json"),
    JSON.stringify(result, null, 2),
  );
});

test("portable recipe paint append validates complete byte wet pairs before publishing and preserves healthy append Undo", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, PaintLayer, PencilStroke, WetPaintStroke } = window.luma,
      { encodeRgbaPng } = await import(
        /* @vite-ignore */ String("/src/engine/png.ts")
      ),
      { serializeRecipePackage } = await import(
        /* @vite-ignore */ String("/src/ai/recipes/package.ts")
      );
    editor.newDocument({ width: 16, height: 16 });
    const layer = editor.document.layers.add(
      new PaintLayer({ name: "Append target" }),
    );
    editor.document.selectedLayer = layer;
    const pixel = await editor.assetStore.add(
        await encodeRgbaPng(new Uint8Array([255, 0, 0, 255]), 1, 1),
        "Pigment",
        undefined,
        false,
      ),
      bad = await editor.assetStore.add(
        await encodeRgbaPng(new Uint8Array([255, 255, 255, 128]), 1, 1),
        "Bad support",
        undefined,
        false,
      ),
      good = await editor.assetStore.add(
        await encodeRgbaPng(new Uint8Array([255, 255, 255, 255]), 1, 1),
        "Good support",
        undefined,
        false,
      );
    const pack = async (coverageId: string) => {
      const stroke = new WetPaintStroke({
        brush: new PencilStroke({ points: [{ x: 3.5, y: 4.5 }] }),
        tiles: [
          {
            x: 3,
            y: 4,
            width: 1,
            height: 1,
            assetId: pixel.id,
            coverage: { assetId: coverageId },
          },
        ],
      }).toJSON();
      return serializeRecipePackage(
        {
          schemaVersion: 1,
          id: "paint-append",
          name: "Prepared append",
          description: "",
          version: 1,
          parameters: [],
          steps: [
            {
              id: "append",
              name: "Append wet paint",
              target: { role: "selected" },
              literalValues: true,
              action: { type: "paint.add", stroke },
            },
          ],
        },
        { get: (id: string) => editor.assetStore.get(id) },
      );
    };
    const invalid = await pack(bad.id),
      valid = await pack(good.id),
      before = JSON.stringify(editor.document.toJSON()),
      count = editor.assetStore.values().length;
    let rejected = "";
    try {
      await editor.recipes.executeRecipePackage(invalid);
    } catch (error) {
      rejected = String(error);
    }
    const atomic =
        before === JSON.stringify(editor.document.toJSON()) &&
        count === editor.assetStore.values().length,
      past = editor.document.getSnapshot().past.length;
    await editor.recipes.executeRecipePackage(valid);
    const one = editor.document.getSnapshot().past.length === past + 1,
      canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false },
      ),
      rgba = [...canvas.getContext("2d")!.getImageData(3, 4, 1, 1).data];
    canvas.width = canvas.height = 0;
    editor.document.undo();
    return {
      rejected,
      atomic,
      one,
      rgba,
      undo: before === JSON.stringify(editor.document.toJSON()),
    };
  });
  expect(result.rejected).toMatch(/coverage|masked|alpha/i);
  expect(result).toMatchObject({
    atomic: true,
    one: true,
    rgba: [255, 0, 0, 255],
    undo: true,
  });
  await writeFile(
    info.outputPath("recipe-paint-native-validation.json"),
    JSON.stringify(result, null, 2),
  );
});

test("recorded textured float gestures package/remap original coverage sources and replay exact native pixels", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Textured float paint.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      editor.document.selectedLayer = editor.document.layers.at(0);
      const canvas = new OffscreenCanvas(3, 2),
        ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, 2, 2);
      const original = await canvas.convertToBlob();
      await editor.brushTextureSource.import(original, "Original coverage.png");
      editor.tools.configure({
        paintTarget: "layer",
        texture: { channel: "alpha", invert: false },
        size: 8,
        hardness: 1,
        opacity: 0.64123,
        flow: 0.375,
        pressureSize: false,
        color: "#208040",
      });
      const before = JSON.stringify(editor.document.toJSON());
      editor.recipes.startRecording();
      const mods = { alt: false, shift: false, pressure: 1 };
      editor.tools.begin("brush", { x: 20.5, y: 20.5 }, mods, 1);
      editor.tools.move({ x: 30.5, y: 23.5 }, mods);
      await editor.tools.end();
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
        expected = await read(),
        recipe = await editor.recipes.stopRecording({
          name: "Textured editable float paint",
        }),
        file = await editor.recipes.exportRecipePackage(recipe),
        { readRecipePackage } = await import(
          /* @vite-ignore */ String("/src/ai/recipes/package.ts")
        ),
        contents = await readRecipePackage(file);
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.selectedLayer = editor.document.layers.at(0);
      const past = editor.document.getSnapshot().past.length;
      await editor.recipes.executeRecipePackage(file);
      const actual = await read(),
        same = (a: Uint32Array, b: Uint32Array) =>
          a.every((v, i) => v === b[i]),
        sourceBytes = new Uint8Array(await original.arrayBuffer()),
        texture = contents.assets[0];
      return {
        undo,
        one: editor.document.getSnapshot().past.length === past + 1,
        nativeExact: same(expected, actual),
        sources: contents.assets.length,
        sourceExact:
          !!texture &&
          new Uint8Array(await texture.blob.arrayBuffer()).every(
            (v, i) => v === sourceBytes[i],
          ),
        append: recipe.steps.some((step) => step.action.type === "paint.add"),
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/rgba-raw-le.tif"))],
  );
  expect(result).toEqual({
    undo: true,
    one: true,
    nativeExact: true,
    sources: 1,
    sourceExact: true,
    append: true,
  });
  await writeFile(
    info.outputPath("float-paint-texture-recipe.json"),
    JSON.stringify(result, null, 2),
  );
});
