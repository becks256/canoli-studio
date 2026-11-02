import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("float Text tool installs its bundled original in one Undo and keeps HDR color editable", async ({
  page,
}, info) => {
  await page.goto("/");
  const past = await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.newDocument({ width: 256, height: 128 });
    await editor.convertDocumentToFloat();
    return editor.document.getSnapshot().past.length;
  });
  const tool = page.getByRole("button", { name: "Text tool (T)", exact: true });
  await expect(tool).toBeEnabled();
  await tool.click();
  const box = (await page.locator(".canvas-wrap").boundingBox())!;
  await page.mouse.click(
    box.x + box.width / 2 - 50,
    box.y + box.height / 2 - 20,
  );
  await expect
    .poll(() => page.evaluate(() => window.luma.editor.document.layers.length))
    .toBe(1);
  const added = await page.evaluate(() => {
    const doc = window.luma.editor.document;
    return {
      kind: doc.selectedLayer?.kind,
      files: doc.fonts.files.length,
      past: doc.getSnapshot().past.length,
    };
  });
  expect(added).toEqual({ kind: "text", files: 1, past: past + 1 });
  const history = await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.undo();
    const undo = { layers: doc.layers.length, files: doc.fonts.files.length };
    doc.redo();
    return {
      undo,
      redo: { layers: doc.layers.length, files: doc.fonts.files.length },
    };
  });
  expect(history).toEqual({
    undo: { layers: 0, files: 0 },
    redo: { layers: 1, files: 1 },
  });
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc.selectedLayer = doc.layers.at(0)!;
  });
  const color = page.getByRole("textbox", { name: "Text color", exact: true });
  await color.fill("color(srgb-linear 4 -.25 1.5 / .5)");
  await color.press("Enter");
  await expect(color).toHaveValue("color(srgb-linear 4 -.25 1.5 / .5)");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma,
      doc = editor.document,
      file = doc.fonts.files.items[0],
      source = editor.assetStore.fonts.get(file.id),
      digest = await crypto.subtle.digest(
        "SHA-256",
        await source.original.arrayBuffer(),
      ),
      scene = await editor.renderer.captureFloatScene(
        doc._read(),
        editor.assetStore,
      );
    let interior: number[] | undefined,
      ink = 0;
    try {
      const pixels = await scene.read({ x: 0, y: 0, width: 256, height: 128 });
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 0) ink++;
        if (pixels[i + 3] === 0.5) interior = [...pixels.slice(i, i + 4)];
      }
    } finally {
      scene.dispose();
    }
    const blob = await editor.saveProject(),
      before = JSON.stringify(doc.toJSON());
    await editor.openProject(new File([blob], "Float text.luma"));
    const layer = editor.document.layers.at(0);
    return {
      ink,
      interior,
      original: [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
      reopened: JSON.stringify(editor.document.toJSON()) === before,
      color:
        layer?.kind === "text"
          ? (layer as typeof doc.selectedLayer & { color: string }).color
          : undefined,
      fontFiles: editor.document.fonts.files.length,
    };
  });
  expect(result).toMatchObject({
    interior: [4, -0.25, 1.5, 0.5],
    reopened: true,
    color: "color(srgb-linear 4 -.25 1.5 / .5)",
    fontFiles: 1,
  });
  expect(result.ink).toBeGreaterThan(0);
  expect(result.original).toBe(
    createHash("sha256")
      .update(
        await readFile(
          "node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
        ),
      )
      .digest("hex"),
  );
  await writeFile(
    info.outputPath("float-text-tool.json"),
    JSON.stringify(result, null, 2),
  );
});

test("converting owned point text retains native glyph coverage with independent Float32 source-over", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))];
  await page.goto("/");
  const result = await page.evaluate(async (font) => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 128, height: 96 });
    const doc = editor.document,
      file = await doc.fonts.embed(new Blob([new Uint8Array(font)]));
    doc.layers.add(
      new TextLayer({
        text: "AV",
        fontFamily: file.family,
        fontSize: 40,
        color: "#ffffff",
        x: 16,
        y: 10,
      }),
    );
    const bitmap = await editor.renderer.render(
        doc._read(),
        editor.assetStore,
        { cache: false, readback: true },
      ),
      bytes = bitmap.getContext("2d")!.getImageData(0, 0, 128, 96).data;
    bitmap.width = bitmap.height = 0;
    const geometry = doc.toJSON().children[0];
    doc.convertToFloat();
    const scene = await editor.renderer.captureFloatScene(
      doc._read(),
      editor.assetStore,
    );
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
    const advance = c.measureText("AV").width - c.measureText("V").width;
    const masks: Uint8ClampedArray[] = [];
    for (const [value, x] of [
      ["A", 16],
      ["V", 16 + advance],
    ] as const) {
      c.clearRect(0, 0, 128, 96);
      c.fillText(value, x, baseline);
      masks.push(c.getImageData(0, 0, 128, 96).data);
    }
    try {
      const pixels = await scene.read({ x: 0, y: 0, width: 128, height: 96 });
      let errors = 0,
        maximum = 0,
        byteInk = 0,
        floatInk = 0,
        referenceError = 0,
        sameSupport = true;
      const differences: {
        x: number;
        y: number;
        byte: number;
        alpha: number;
      }[] = [];
      for (let i = 0; i < pixels.length; i += 4) {
        const a = Math.fround(masks[0][i + 3] / 255),
          b = Math.fround(masks[1][i + 3] / 255),
          expected = Math.fround(b + a * (1 - b));
        referenceError = Math.max(
          referenceError,
          Math.abs(pixels[i + 3] - expected),
        );
        sameSupport &&= bytes[i + 3] > 0 === pixels[i + 3] > 0;
        const error = Math.abs(Math.round(pixels[i + 3] * 255) - bytes[i + 3]);
        if (error) {
          errors++;
          differences.push({
            x: (i / 4) % 128,
            y: Math.floor(i / 4 / 128),
            byte: bytes[i + 3],
            alpha: pixels[i + 3],
          });
        }
        maximum = Math.max(maximum, error);
        if (bytes[i + 3]) byteInk++;
        if (pixels[i + 3]) floatInk++;
      }
      return {
        baseline,
        advance,
        errors,
        maximum,
        byteInk,
        floatInk,
        differences,
        referenceError,
        sameSupport,
        sameGeometry:
          JSON.stringify(geometry) === JSON.stringify(doc.toJSON().children[0]),
      };
    } finally {
      scene.dispose();
    }
  }, font);
  await writeFile(
    info.outputPath("float-text-alpha-parity.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    referenceError: 0,
    sameSupport: true,
    sameGeometry: true,
  });
  expect(result.byteInk).toBeGreaterThan(0);
});

test("float character selections retain independent HDR colors through the Inspector and one Undo", async ({
  page,
}, info) => {
  const font = [...(await readFile("tests/fixtures/shaping-font/Shaping.ttf"))];
  await page.goto("/");
  await page.evaluate(async (font) => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 128, height: 96 });
    await editor.convertDocumentToFloat();
    const file = await editor.document.fonts.embed(
      new Blob([new Uint8Array(font)]),
    );
    editor.document.selectedLayer = editor.document.layers.add(
      new TextLayer({
        text: "AV",
        fontFamily: file.family,
        fontSize: 40,
        x: 16,
        y: 10,
        color: "color(srgb-linear 4 -.25 1.5 / .5)",
      }),
    );
  }, font);
  await page.getByText("Character formatting", { exact: true }).click();
  const content = page.getByRole("textbox", {
    name: "Text content",
    exact: true,
  });
  await content.focus();
  await content.press("End");
  await content.press("Shift+ArrowLeft");
  const color = page.getByRole("textbox", {
    name: "Selected text color",
    exact: true,
  });
  await expect(color).toBeEnabled();
  const past = await page.evaluate(
    () => window.luma.editor.document.getSnapshot().past.length,
  );
  await color.fill("color(srgb-linear -.5 2 4 / .25)");
  await color.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.luma.editor.document.getSnapshot().past.length,
      ),
    )
    .toBe(past + 1);
  const result = await page.evaluate(async () => {
    const { editor } = window.luma,
      doc = editor.document,
      scene = await editor.renderer.captureFloatScene(
        doc._read(),
        editor.assetStore,
      );
    try {
      const pixels = await scene.read({ x: 0, y: 0, width: 128, height: 96 });
      let primary = false,
        range = false;
      for (let i = 0; i < pixels.length; i += 4) {
        primary ||=
          pixels[i] === 4 &&
          pixels[i + 1] === -0.25 &&
          pixels[i + 2] === 1.5 &&
          pixels[i + 3] === 0.5;
        range ||=
          pixels[i] === -0.5 &&
          pixels[i + 1] === 2 &&
          pixels[i + 2] === 4 &&
          pixels[i + 3] === 0.25;
      }
      const layer = doc.selectedLayer as import("../src/dom").TextLayer,
        ranges = layer.characterRanges;
      doc.undo();
      return {
        primary,
        range,
        ranges,
        undo: layer.characterRanges.length === 0,
        text: layer.text,
      };
    } finally {
      scene.dispose();
    }
  });
  await writeFile(
    info.outputPath("float-text-character-colors.json"),
    JSON.stringify(result, null, 2),
  );
  expect(result).toMatchObject({
    primary: true,
    range: true,
    undo: true,
    text: "AV",
    ranges: [
      {
        start: 1,
        end: 2,
        format: { color: "color(srgb-linear -.5 2 4 / .25)" },
      },
    ],
  });
});
