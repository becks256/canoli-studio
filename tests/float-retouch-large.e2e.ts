import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
test("native Patch on a genuine 50 MP original preserves complete sources and matches an independent bounded Dirichlet solve", async ({
  page,
}, info) => {
  test.setTimeout(600000);
  await page.goto("/");
  const result = await page.evaluate(
    async (bytes) => {
      const { editor, PaintLayer, PaintFill, MarqueeSelection } = window.luma;
      await editor.openTiff(
        new File([new Uint8Array(bytes)], "Native retouch 50MP.tif", {
          type: "image/tiff",
        }),
        { editingPrecision: "float32" },
      );
      const original = editor.assetStore.values()[0],
        paint = editor.document.layers.add(
          new PaintLayer({ name: "Repair target" }),
        );
      paint.strokes.add(
        new PaintFill({
          bounds: { x: 50, y: 30, width: 5, height: 5 },
          color: "#ff0000",
          opacity: 0.375,
        }),
      );
      editor.document.selectedLayer = paint;
      editor.document.selection = new MarqueeSelection({
        shape: "rectangle",
        x: 50,
        y: 30,
        width: 5,
        height: 5,
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
        before = JSON.stringify(editor.document.toJSON()),
        past = editor.document.getSnapshot().past.length,
        base = await read();
      await editor.applyPatch({ x: -40, y: -24 });
      const actual = await read(),
        edited = JSON.stringify(editor.document.toJSON()),
        one = editor.document.getSnapshot().past.length === past + 1;
      editor.document.undo();
      const undo = before === JSON.stringify(editor.document.toJSON());
      editor.document.redo();
      const redo = edited === JSON.stringify(editor.document.toJSON()),
        raw = new Uint8Array(await original.blob.arrayBuffer());
      return {
        scope,
        base: [...base],
        actual: [...actual],
        dimensions: [original.width, original.height],
        one,
        undo,
        redo,
        sourceExact:
          raw.length === bytes.length && raw.every((v, i) => v === bytes[i]),
        selection: { x: 50, y: 30, width: 5, height: 5 },
        offset: { x: -40, y: -24 },
      };
    },
    [...(await readFile("tests/fixtures/tiff-float/native-50mp.tif"))],
  );
  expect(result).toMatchObject({
    dimensions: [10000, 5000],
    one: true,
    undo: true,
    redo: true,
    sourceExact: true,
  });
  await writeFile(
    info.outputPath("native-retouch-50mp.json"),
    JSON.stringify(result),
  );
  const checked = spawnSync(
    "python3",
    [
      "scripts/check-float-retouch-large.py",
      info.outputPath("native-retouch-50mp.json"),
    ],
    { encoding: "utf8", timeout: 120000 },
  );
  expect(checked.status, checked.stderr || checked.stdout).toBe(0);
  await writeFile(
    info.outputPath("independent-retouch-50mp.json"),
    checked.stdout,
  );
});
