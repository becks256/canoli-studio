import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

test("float text shares isolated script, inert plugin, portable recipe and redo-only workspace authority", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))],
    code = (await readFile("docs/SCRIPTING_API.md", "utf8")).match(
      /## Native float TextLayer[\s\S]*?```js\n([\s\S]*?)\n```/,
    )![1];
  await page.goto("/");
  const result = await page.evaluate(
    async ({ font, code }) => {
      const { editor } = window.luma;
      editor.newDocument({ width: 128, height: 96 });
      await editor.convertDocumentToFloat();
      await editor.document.fonts.embed(new Blob([new Uint8Array(font)]));
      const before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length;
      const read = async () => {
          const scene = await editor.renderer.captureFloatScene(
            editor.document._read(),
            editor.assetStore,
          );
          try {
            return new Uint32Array(
              (await scene.read({ x: 0, y: 0, width: 128, height: 96 })).buffer,
            );
          } finally {
            scene.dispose();
          }
        },
        same = (a: Uint32Array, b: Uint32Array) =>
          a.length === b.length && a.every((v, i) => v === b[i]);
      editor.recipes.startRecording();
      await editor.runScript(code);
      const expected = await read(),
        one = editor.document.getSnapshot().past.length === past + 1,
        recipe = await editor.recipes.stopRecording({
          name: "Float original text",
        }),
        pack = await editor.recipes.exportRecipePackage(recipe);
      editor.document.undo();
      const undo = JSON.stringify(editor.document.toJSON()) === before;
      await editor.recipes.executeRecipePackage(pack);
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
        id: "float-text",
        name: "Float text",
        version: "1.0.0",
        description: "Existing shared text",
        permissions: ["document:read", "document:write"] as (
          "document:read" | "document:write"
        )[],
        commands: [
          {
            id: "edit",
            title: "Edit",
            source:
              'document.layers.at(0).text="V";document.layers.at(0).color="color(srgb-linear -.5 2 4 / .25)";',
          },
        ],
      };
      editor.plugins.install(manifest);
      const inert = edited === JSON.stringify(editor.document.toJSON()),
        pluginPast = editor.document.getSnapshot().past.length;
      await editor.runPlugin(manifest.id, "edit");
      const applied = !same(expected, await read()),
        pluginOne =
          editor.document.getSnapshot().past.length === pluginPast + 1;
      editor.document.undo();
      const pluginUndo =
        edited === JSON.stringify(editor.document.toJSON()) &&
        same(expected, await read());
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
      return {
        one,
        undo,
        recipeExact,
        workspaceExact,
        inert,
        applied,
        pluginOne,
        pluginUndo,
        denied,
        unchangedAfterDenied:
          edited === JSON.stringify(editor.document.toJSON()),
        retainedFont: editor.document.fonts.files.length === 1,
      };
    },
    { font, code },
  );
  await writeFile(
    info.outputPath("shared-float-text.json"),
    JSON.stringify(result, null, 2),
  );
  expect(Object.values(result).every(Boolean), JSON.stringify(result)).toBe(
    true,
  );
});

test("float text participates in affine groups, masks, sibling clipping, styles and native project replay", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))];
  await page.goto("/");
  const result = await page.evaluate(async (font) => {
    const {
      editor,
      TextLayer,
      LayerGroup,
      LayerMask,
      MarqueeSelection,
      LayerStyle,
      PaintLayer,
      PaintFill,
      AffineTransform,
    } = window.luma;
    editor.newDocument({ width: 240, height: 128 });
    await editor.convertDocumentToFloat();
    const file = await editor.document.fonts.embed(
        new Blob([new Uint8Array(font)]),
      ),
      group = editor.document.layers.add(new LayerGroup());
    group.transform = new AffineTransform(0.9, 0.1, -0.13, 0.95, 22, 8);
    const layer = group.layers.add(
      new TextLayer({
        text: "AV AV",
        fontFamily: file.family,
        fontSize: 40,
        x: 16,
        y: 10,
        color: "color(srgb-linear 4 -.25 1.5 / .5)",
        opacity: 0.73,
        fillOpacity: 0.8,
      }),
    );
    layer.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 110,
        height: 90,
      }),
      density: 0.8,
      feather: 1,
    });
    layer.styles = new LayerStyle({
      colorOverlay: { enabled: true, color: "#ff0000", opacity: 0.25 },
      dropShadow: {
        enabled: true,
        color: "#0000ff",
        opacity: 0.375,
        x: 7,
        y: 4,
        blur: 2,
      },
    });
    const clip = group.layers.add(
      new PaintLayer({ clipped: true, opacity: 0.5 }),
    );
    clip.strokes.add(
      new PaintFill({
        bounds: { x: 0, y: 0, width: 220, height: 128 },
        color: "#80ff80",
      }),
    );
    const read = async () => {
        const scene = await editor.renderer.captureFloatScene(
          editor.document._read(),
          editor.assetStore,
        );
        try {
          return await scene.read({ x: 0, y: 0, width: 240, height: 128 });
        } finally {
          scene.dispose();
        }
      },
      full = await read(),
      scene = await editor.renderer.captureFloatScene(
        editor.document._read(),
        editor.assetStore,
      ),
      parts = new Float32Array(full.length);
    try {
      for (let y = 0; y < 128; y += 29)
        for (let x = 0; x < 240; x += 53) {
          const width = Math.min(53, 240 - x),
            height = Math.min(29, 128 - y),
            pixels = await scene.read({ x, y, width, height });
          for (let row = 0; row < height; row++)
            parts.set(
              pixels.subarray(row * width * 4, (row + 1) * width * 4),
              ((y + row) * 240 + x) * 4,
            );
        }
    } finally {
      scene.dispose();
    }
    const saved = JSON.stringify(editor.document.toJSON()),
      project = await editor.saveProject();
    await editor.openProject(
      new File([project], "Native text appearance.luma"),
    );
    const replay = await read(),
      same = (a: Float32Array, b: Float32Array) =>
        new Uint32Array(a.buffer).every(
          (n, i) => n === new Uint32Array(b.buffer)[i],
        );
    return {
      partitions: same(full, parts),
      replay: same(full, replay),
      model: saved === JSON.stringify(editor.document.toJSON()),
      ink: full.filter((v, i) => i % 4 === 3 && v > 0).length,
      partial: full.filter((v, i) => i % 4 === 3 && v > 0 && v < 0.1).length,
    };
  }, font);
  await writeFile(
    info.outputPath("float-text-appearance.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({ partitions: true, replay: true, model: true });
  expect(result.ink).toBeGreaterThan(100);
  expect(result.partial).toBeGreaterThan(100);
});

test("float TIFF text output retains every independently composed original-font color and alpha word", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))];
  await page.goto("/");
  const result = await page.evaluate(async (font) => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 128, height: 96 });
    await editor.convertDocumentToFloat();
    const file = await editor.document.fonts.embed(
      new Blob([new Uint8Array(font)]),
    );
    editor.document.layers.add(
      new TextLayer({
        text: "AV",
        fontFamily: file.family,
        fontSize: 40,
        x: 16,
        y: 10,
        color: "color(srgb-linear 4 -.25 1.5 / .5)",
      }),
    );
    const scene = await editor.renderer.captureFloatScene(
      editor.document._read(),
      editor.assetStore,
    );
    let pixels: Float32Array;
    try {
      pixels = await scene.read({ x: 0, y: 0, width: 128, height: 96 });
    } finally {
      scene.dispose();
    }
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 96;
    const c = canvas.getContext("2d")!;
    c.font = `40px ${file.family}`;
    c.fontKerning = "auto";
    c.textBaseline = "alphabetic";
    const ascent = c.measureText("AV").actualBoundingBoxAscent;
    c.textBaseline = "top";
    const baseline = 10 + ascent - c.measureText("AV").actualBoundingBoxAscent;
    c.textBaseline = "alphabetic";
    c.fillStyle = "#fff";
    const advance = c.measureText("AV").width - c.measureText("V").width,
      masks: Uint8ClampedArray[] = [];
    for (const [value, x] of [
      ["A", 16],
      ["V", 16 + advance],
    ] as const) {
      c.clearRect(0, 0, 128, 96);
      c.fillText(value, x, baseline);
      masks.push(c.getImageData(0, 0, 128, 96).data);
    }
    const expected = new Float32Array(pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
      const a = Math.fround(0.5 * Math.fround(masks[0][i + 3] / 255)),
        b = Math.fround(0.5 * Math.fround(masks[1][i + 3] / 255)),
        alpha = Math.fround(b + a * (1 - b));
      if (alpha) expected.set([4, -0.25, 1.5, alpha], i);
    }
    const output = await editor.export({
        format: "tiff",
        tiffPrecision: "float32",
      }),
      same = new Uint32Array(expected.buffer).every(
        (n, i) => n === new Uint32Array(pixels.buffer)[i],
      );
    return {
      same,
      expected: [...new Uint8Array(expected.buffer)],
      tiff: [...new Uint8Array(await output.blob.arrayBuffer())],
    };
  }, font);
  expect(result.same).toBe(true);
  const output = info.outputPath("native-float-text.tif"),
    expected = info.outputPath("native-float-text.f32");
  await writeFile(output, Buffer.from(result.tiff));
  await writeFile(expected, Buffer.from(result.expected));
  const check = spawnSync(
    process.env.CANOLI_PDF_PYTHON || "python3",
    [
      "-c",
      String.raw`
import ctypes as C,ctypes.util,sys,numpy as np,json
lib=C.CDLL(ctypes.util.find_library('tiff'));P=C.c_void_p;U=C.c_uint32
lib.TIFFOpen.argtypes=[C.c_char_p,C.c_char_p];lib.TIFFOpen.restype=P
lib.TIFFGetField.argtypes=[P,U];lib.TIFFGetField.restype=C.c_int
lib.TIFFReadEncodedTile.argtypes=[P,U,P,C.c_ssize_t];lib.TIFFReadEncodedTile.restype=C.c_ssize_t
lib.TIFFClose.argtypes=[P]
h=lib.TIFFOpen(sys.argv[1].encode(),b'r');assert h
try:
 def get(tag,ty=U):
  v=ty();assert lib.TIFFGetField(h,tag,C.byref(v));return v.value
 assert(get(256),get(257),get(258,C.c_uint16),get(339,C.c_uint16),get(277,C.c_uint16))==(128,96,32,3,4)
 w=get(322);t=get(323);actual=np.empty((96,128,4),dtype='<f4')
 for y in range(0,96,t):
  for x in range(0,128,w):
   tile=np.empty((t,w,4),dtype='<f4');assert lib.TIFFReadEncodedTile(h,(y//t)*((128+w-1)//w)+x//w,tile.ctypes.data,-1)==tile.nbytes
   rows=min(t,96-y);cols=min(w,128-x);actual[y:y+rows,x:x+cols]=tile[:rows,:cols]
 expected=np.fromfile(sys.argv[2],dtype='<f4').reshape(actual.shape)
 assert np.array_equal(actual.view('<u4'),expected.view('<u4'))
 print(json.dumps({'reader':'native libtiff','words':int(actual.size),'wordErrors':0,'ink':int(np.count_nonzero(actual[:,:,3]))}))
finally:lib.TIFFClose(h)
`,
      output,
      expected,
    ],
    { encoding: "utf8" },
  );
  expect(check.status, check.stderr || check.stdout).toBe(0);
  await writeFile(info.outputPath("native-float-text-tiff.json"), check.stdout);
});

test("native float text on a genuine 50 MP original preserves every edit-window word and complete source", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  const input = {
    bytes: [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
    font: [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))],
  };
  await page.goto("/");
  const result = await page.evaluate(async ({ bytes, font }) => {
    const { editor, TextLayer } = window.luma;
    await editor.openTiff(
      new File([new Uint8Array(bytes)], "50MP text original.tif", {
        type: "image/tiff",
      }),
      { editingPrecision: "float32" },
    );
    const doc = editor.document,
      asset = editor.assetStore.values()[0],
      file = await doc.fonts.embed(new Blob([new Uint8Array(font)])),
      before = JSON.stringify(doc.toJSON()),
      scope = { x: 0, y: 0, width: 64, height: 64 },
      read = async () => {
        const scene = await editor.renderer.captureFloatScene(
          doc._read(),
          editor.assetStore,
        );
        try {
          return await scene.read(scope);
        } finally {
          scene.dispose();
        }
      },
      base = await read();
    doc.layers.add(
      new TextLayer({
        text: "A",
        fontFamily: file.family,
        fontSize: 40,
        x: 16,
        y: 10,
        color: "color(srgb-linear 4 -.25 1.5 / .5)",
      }),
    );
    const actual = await read(),
      canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const c = canvas.getContext("2d")!;
    c.font = `40px ${file.family}`;
    c.textBaseline = "top";
    c.fillStyle = "#fff";
    c.fillText("A", 16, 10);
    const coverage = c.getImageData(0, 0, 64, 64).data,
      expected = new Float32Array(actual.length);
    let ink = 0;
    for (let i = 0; i < actual.length; i += 4) {
      const a = Math.fround(0.5 * Math.fround(coverage[i + 3] / 255)),
        keep = base[i + 3] * (1 - a),
        alpha = a + keep;
      expected[i + 3] = alpha;
      if (alpha) {
        expected[i] = (4 * a + base[i] * keep) / alpha;
        expected[i + 1] = (-0.25 * a + base[i + 1] * keep) / alpha;
        expected[i + 2] = (1.5 * a + base[i + 2] * keep) / alpha;
      }
      if (a) ink++;
    }
    const edited = JSON.stringify(doc.toJSON());
    doc.undo();
    const undo = before === JSON.stringify(doc.toJSON());
    doc.redo();
    const original = new Uint8Array(await asset.blob.arrayBuffer());
    return {
      dimensions: [doc.width, doc.height, asset.width, asset.height],
      words: actual.length,
      exact: new Uint32Array(actual.buffer).every(
        (n, i) => n === new Uint32Array(expected.buffer)[i],
      ),
      ink,
      undo,
      redo: edited === JSON.stringify(doc.toJSON()),
      originalExact:
        original.length === bytes.length &&
        original.every((n, i) => n === bytes[i]),
    };
  }, input);
  await writeFile(
    info.outputPath("float-text-50mp.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    dimensions: [10000, 5000, 10000, 5000],
    words: 16384,
    exact: true,
    undo: true,
    redo: true,
    originalExact: true,
  });
  expect(result.ink).toBeGreaterThan(100);
});
