import { expect, test } from "@playwright/test";

test("selection conversion preserves nested masked pixels, source bytes, scripts and project reopening", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    const {
      LayerGroup,
      RasterLayer,
      LayerMask,
      MarqueeSelection,
      AffineTransform,
    } = window.luma;
    editor.newDocument({ width: 96, height: 64 });
    const canvas = new OffscreenCanvas(16, 16),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e42a60";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const asset = await editor.assetStore.add(
      blob,
      "Original",
      undefined,
      false,
    );
    const group = editor.document.layers.add(
      new LayerGroup({ name: "Parent" }),
    );
    group.transform = new AffineTransform(1, 0.1, 0.2, 1, 12, 4);
    const first = group.layers.add(
      new RasterLayer({
        name: "First",
        assetId: asset.id,
        width: 16,
        height: 16,
        x: 2,
        y: 8,
      }),
    );
    first.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 16,
        y: 12,
        width: 10,
        height: 16,
      }),
      linked: false,
    });
    const second = group.layers.add(
      new RasterLayer({
        name: "Second",
        assetId: asset.id,
        width: 16,
        height: 16,
        x: 32,
        y: 8,
      }),
    );
    editor.document.selectLayers([second, first]);
    async function pixels() {
      const surface = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const bytes = [
        ...surface.getContext("2d")!.getImageData(0, 0, 96, 64).data,
      ];
      surface.width = surface.height = 0;
      return bytes;
    }
    const before = await pixels(),
      history = editor.document.getSnapshot().past.length;
    await editor.runScript(
      "document.createSmartObject(document.selectedLayers);",
    );
    const after = await pixels();
    const smart = editor.document.selectedLayer!;
    const names = (smart as InstanceType<typeof window.luma.SmartObjectLayer>)
      .editContents()
      .toJSON()
      .children.map((layer) => layer.name);
    const oneUndo = editor.document.getSnapshot().past.length === history + 1;
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "converted.luma"));
    const reopened = await pixels();
    return {
      maxDifference: Math.max(...before.map((v, i) => Math.abs(v - after[i]))),
      names,
      oneUndo,
      undo: JSON.stringify(before) === JSON.stringify(undone),
      reopen: JSON.stringify(after) === JSON.stringify(reopened),
      original:
        [
          ...new Uint8Array(
            await editor.assetStore.get(asset.id).blob.arrayBuffer(),
          ),
        ].join() === [...new Uint8Array(await blob.arrayBuffer())].join(),
      painted: before.some((v, i) => i % 4 === 3 && v > 0),
    };
  });
  expect(result).toMatchObject({
    names: ["First", "Second"],
    oneUndo: true,
    undo: true,
    reopen: true,
    original: true,
    painted: true,
  });
  expect(result.maxDifference).toBeLessThanOrEqual(1);
});

test("Layers converts a multi-selection into editable text contents", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 160, height: 100 });
    const first = editor.document.layers.add(
      new TextLayer({ name: "Title", text: "Title" }),
    );
    const second = editor.document.layers.add(
      new TextLayer({ name: "Caption", text: "Caption", y: 40 }),
    );
    editor.document.selectLayers([first, second]);
  });
  await page
    .getByRole("button", { name: "Convert to smart object", exact: true })
    .click();
  expect(
    await page.evaluate(() => {
      const doc = window.luma.editor.document;
      const smart = doc.selectedLayer as InstanceType<
        typeof window.luma.SmartObjectLayer
      >;
      return {
        count: doc.layers.length,
        kind: smart.kind,
        contents: smart
          .editContents()
          .toJSON()
          .children.map((layer) => layer.kind),
      };
    }),
  ).toEqual({ count: 1, kind: "smart-object", contents: ["text", "text"] });
});
