import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("isolated scripts create shared masters, edit all instances atomically, and preserve pixels through project reopen", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 40, height: 16 });
    const canvas = new OffscreenCanvas(16, 16),
      context = canvas.getContext("2d")!;
    context.fillStyle = "#f02040";
    context.fillRect(0, 0, 16, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const asset = await editor.assetStore.add(blob, "Source", undefined, false);
    const script = `
      const master = new Document({ name: 'Shared artwork', width: 16, height: 16 });
      master.layers.add(new RasterLayer({ assetId: ${JSON.stringify(asset.id)}, width: 16, height: 16 }));
      const id = document.defineComponent(master);
      document.placeSmartObject(id, { name: 'First' });
      document.layers.add(new SmartObjectLayer({ name: 'Second', componentId: id, width: 16, height: 16, x: 20 }));
    `;
    await editor.runScript(script);
    const created = editor.document.toJSON();
    async function sample(data = editor.document.toJSON()) {
      const canvas = await editor.renderer.render(data, editor.assetStore, {
        cache: true,
        readback: true,
      });
      const context = canvas.getContext("2d")!;
      const pixels = [4, 24].map((x) => [
        ...context.getImageData(x, 8, 1, 1).data,
      ]);
      canvas.width = canvas.height = 0;
      return pixels;
    }
    const before = await sample();
    const history = editor.document.getSnapshot().past.length;
    await editor.runScript(`
      const instance = document.layers.at(0);
      const contents = instance.editContents(); contents.layers.at(0).opacity = 0.5;
      instance.replaceContents(contents);
    `);
    const after = await sample();
    const reference = {
      ...created,
      components: undefined,
      children: [0, 20].map((x) =>
        new window.luma.RasterLayer({
          assetId: asset.id,
          width: 16,
          height: 16,
          opacity: 0.5,
          x,
        }).toJSON(),
      ),
    };
    const referenceAfter = await sample(reference);
    const frame = await editor.renderer.prepareViewport(
      editor.document.toJSON(),
      editor.assetStore,
      { maxPixels: 640, maxDimension: 40 },
    );
    const backend = frame.backend;
    frame.dispose();
    const oneUndo = editor.document.getSnapshot().past.length === history + 1;
    editor.document.undo();
    const undo = await sample();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "components.luma"));
    const reopened = await sample();
    const { SmartObjectLayer } = window.luma;
    return {
      before,
      after,
      referenceAfter,
      backend,
      undo,
      reopened,
      oneUndo,
      schema: editor.document.toJSON().schemaVersion,
      componentCount: editor.document.toJSON().components?.length,
      handles: [...editor.document.layers].every(
        (layer) => layer instanceof SmartObjectLayer,
      ),
      assets: editor.assetStore.values().length,
      createdHistory: created.children.length,
      sourceBytesIntact:
        new Uint8Array(
          await editor.assetStore.get(asset.id).blob.arrayBuffer(),
        ).join() === new Uint8Array(await blob.arrayBuffer()).join(),
    };
  });
  expect(result.before).toEqual([
    [240, 32, 64, 255],
    [240, 32, 64, 255],
  ]);
  // Compare to ordinary raster composition to account for browser premultiplied-alpha rounding.
  expect(result.after).toEqual(result.referenceAfter);
  expect(result.after.map((pixel) => pixel[3])).toEqual([128, 128]);
  expect(result.backend).toBe("canvas2d");
  expect(result.undo).toEqual(result.before);
  expect(result.reopened).toEqual(result.after);
  expect(result).toMatchObject({
    oneUndo: true,
    schema: 14,
    componentCount: 1,
    handles: true,
    assets: 1,
    createdHistory: 2,
    sourceBytesIntact: true,
  });
});

test("documented smart-object example runs through script isolation as one undoable edit", async ({
  page,
}) => {
  const guide = readFileSync(
    new URL("../docs/SCRIPTING_API.md", import.meta.url),
    "utf8",
  );
  const source = guide.match(
    /<!-- example: shared-smart-objects -->\s*```js\n([\s\S]*?)```/,
  )![1];
  await page.goto("/");
  const result = await page.evaluate(async (source) => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 400, height: 120 });
    const before = editor.document.toJSON();
    const history = editor.document.getSnapshot().past.length;
    await editor.runScript(source);
    const document = editor.document;
    const { SmartObjectLayer, TextLayer } = window.luma;
    const layers = [...document.layers];
    const text = layers.map((layer) =>
      layer instanceof SmartObjectLayer
        ? (layer.editContents().layers.at(0) as InstanceType<typeof TextLayer>)
            .text
        : null,
    );
    const oneUndo = document.getSnapshot().past.length === history + 1;
    const after = document.toJSON();
    document.undo();
    const restored =
      JSON.stringify(document.toJSON()) === JSON.stringify(before);
    document.redo();
    const redone = JSON.stringify(document.toJSON()) === JSON.stringify(after);
    return { text, oneUndo, restored, redone };
  }, source);
  expect(result).toEqual({
    text: ["Updated edition", "Updated edition"],
    oneUndo: true,
    restored: true,
    redone: true,
  });
});

test("raster conversion from Layers preserves rendered artwork, sources and undo", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const { editor, LayerGroup, LayerMask, MarqueeSelection, AffineTransform } =
      window.luma;
    editor.newDocument({ width: 64, height: 64 });
    const canvas = new OffscreenCanvas(16, 16);
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#e03060";
    context.fillRect(0, 0, 8, 16);
    context.fillStyle = "#40a060";
    context.fillRect(8, 0, 8, 16);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    await editor.importImage(
      new File([blob], "Photo.png", { type: "image/png" }),
    );
    const photo = editor.document.selectedLayer!;
    const group = editor.document.layers.add(new LayerGroup({ x: 12, y: 10 }));
    photo.moveTo(group);
    photo.x = 3;
    photo.y = 4;
    photo.transform = new AffineTransform(1, 0.2, 0.1, 1, 3, 4);
    photo.mask = new LayerMask({
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 0,
        y: 0,
        width: 12,
        height: 16,
      }),
    });
    editor.document._dispatch({
      type: "effect.tone",
      id: photo.id,
      values: { contrast: 25, saturation: 10 },
    });
    editor.document.selectedLayer = photo;
    const rendered = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { readback: true, cache: false },
    );
    const pixels = [
      ...rendered.getContext("2d")!.getImageData(0, 0, 64, 64).data,
    ];
    rendered.width = rendered.height = 0;
    return {
      pixels,
      photoId: photo.id,
      document: editor.document.toJSON(),
      history: editor.document.getSnapshot().past.length,
      bytes: [...new Uint8Array(await blob.arrayBuffer())],
    };
  });
  await page
    .getByRole("button", { name: "Convert to smart object", exact: true })
    .click();
  const result = await page.evaluate(async (before) => {
    const { editor, SmartObjectLayer } = window.luma;
    const smart = editor.document.selectedLayer!;
    const converted = smart instanceof SmartObjectLayer;
    const rendered = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { readback: true, cache: false },
    );
    const pixels = [
      ...rendered.getContext("2d")!.getImageData(0, 0, 64, 64).data,
    ];
    rendered.width = rendered.height = 0;
    const history = editor.document.getSnapshot().past.length;
    const data = editor.document.toJSON();
    editor.document.undo();
    const undone =
      JSON.stringify(editor.document.toJSON()) ===
      JSON.stringify(before.document);
    editor.document.redo();
    const redone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(data);
    editor.document.undo();
    await editor.runScript(
      `document.getLayer(${JSON.stringify(before.photoId)}).convertToSmartObject();`,
    );
    const scripted = editor.document.selectedLayer instanceof SmartObjectLayer;
    const asset = editor.assetStore.values()[0];
    return {
      converted,
      scripted,
      pixels,
      history,
      undone,
      redone,
      bytes: [...new Uint8Array(await asset.blob.arrayBuffer())],
    };
  }, before);
  expect(result.converted && result.scripted).toBe(true);
  expect(result.pixels).toEqual(before.pixels);
  expect(result.history).toBe(before.history + 1);
  expect(result.undone && result.redone).toBe(true);
  expect(result.bytes).toEqual(before.bytes);
});

test("independent copy isolates nested master edits and survives undo and project reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.newDocument({ width: 64, height: 48 });
    const assets: string[] = [];
    for (const color of ["#ff0000", "#0000ff"]) {
      const canvas = new OffscreenCanvas(16, 16);
      const context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, 16, 16);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const asset = await editor.assetStore.add(blob, color, undefined, false);
      assets.push(asset.id);
    }
    await editor.runScript(`
      const leaf = new Document({ width: 16, height: 16 });
      leaf.layers.add(new RasterLayer({ assetId: ${JSON.stringify(assets[0])}, width: 16, height: 16 }));
      const leafId = document.defineComponent(leaf);
      const parent = new Document({ width: 32, height: 16 });
      parent.defineComponent(leaf, { id: leafId });
      parent.placeSmartObject(leafId); parent.placeSmartObject(leafId, { x: 16 });
      const parentId = document.defineComponent(parent);
      document.selectedLayer = document.placeSmartObject(parentId, { name: 'Original' });
    `);
  });
  await page
    .getByRole("button", { name: "New smart object via copy", exact: true })
    .click();
  const result = await page.evaluate(async () => {
    const { editor, SmartObjectLayer } = window.luma;
    const copy = editor.document.selectedLayer as InstanceType<
      typeof SmartObjectLayer
    >;
    const copyRootId = copy.componentId;
    const leafId = (
      copy.editContents().layers.at(0) as InstanceType<typeof SmartObjectLayer>
    ).componentId;
    const originalRootId = (
      editor.document.layers.at(0) as InstanceType<typeof SmartObjectLayer>
    ).componentId;
    const originalLeafId = (
      editor.document.getComponent(originalRootId).layers.at(0) as InstanceType<
        typeof SmartObjectLayer
      >
    ).componentId;
    const blue = editor.assetStore
      .values()
      .find((asset) => asset.name === "#0000ff")!;
    const beforeAssets = await Promise.all(
      editor.assetStore
        .values()
        .map(async (asset) => [
          asset.id,
          [...new Uint8Array(await asset.blob.arrayBuffer())],
        ]),
    );
    async function pixels() {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { readback: true, cache: true },
      );
      const context = canvas.getContext("2d")!;
      const result = [
        [8, 8],
        [24, 8],
        [32, 32],
        [48, 32],
      ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
      canvas.width = canvas.height = 0;
      return result;
    }
    const initial = await pixels();
    await editor.runScript(`
      const replacement = new Document({ width: 16, height: 16 });
      replacement.layers.add(new RasterLayer({ assetId: ${JSON.stringify(blue.id)}, width: 16, height: 16 }));
      document.defineComponent(replacement, { id: ${JSON.stringify(leafId)} });
    `);
    const changed = await pixels();
    editor.document.undo();
    const undoEdit = await pixels();
    editor.document.undo();
    const undoCopy = {
      layers: editor.document.layers.length,
      components: editor.document.toJSON().components!.length,
    };
    editor.document.redo();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "independent.luma"));
    const reopened = await pixels();
    const afterAssets = await Promise.all(
      editor.assetStore
        .values()
        .map(async (asset) => [
          asset.id,
          [...new Uint8Array(await asset.blob.arrayBuffer())],
        ]),
    );
    // Exercise constructor copying through isolation too; the UI and script share commands.
    await editor.runScript("document.layers.at(0).duplicateIndependent();");
    const scriptedCount = editor.document.toJSON().components!.length;
    return {
      initial,
      changed,
      undoEdit,
      undoCopy,
      reopened,
      independent: leafId !== originalLeafId && copyRootId !== originalRootId,
      intact:
        JSON.stringify(beforeAssets.sort()) ===
        JSON.stringify(afterAssets.sort()),
      scriptedCount,
    };
  });
  const red = [255, 0, 0, 255],
    blue = [0, 0, 255, 255];
  expect(result.initial).toEqual([red, red, red, red]);
  expect(result.changed).toEqual([red, red, blue, blue]);
  expect(result.undoEdit).toEqual(result.initial);
  expect(result.undoCopy).toEqual({ layers: 1, components: 2 });
  expect(result.reopened).toEqual(result.changed);
  expect(result).toMatchObject({
    independent: true,
    intact: true,
    scriptedCount: 6,
  });
});
