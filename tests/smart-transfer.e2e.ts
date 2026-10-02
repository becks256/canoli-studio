import { expect, test } from "@playwright/test";

test("cross-document smart-object copies preserve nested masks, sharing, pixels and original bytes after source closure", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      RasterLayer,
      LayerGroup,
      LayerMask,
      SmartObjectLayer,
      SmartToneFilter,
    } = window.luma;
    const target = editor.newDocument({
      name: "Target",
      width: 64,
      height: 64,
    });
    target.defineComponent(new Document(), { id: "existing" });
    const before = target.toJSON();
    const history = target.getSnapshot().past.length;
    const source = editor.newDocument({
      name: "Source",
      width: 64,
      height: 64,
    });
    const assets: string[] = [];
    for (const [name, color, width] of [
      ["Red", "#ff0000", 16],
      ["Mask", "#ffffff", 8],
      ["Unused", "#00ff00", 16],
    ] as const) {
      const canvas = new OffscreenCanvas(16, 16),
        context = canvas.getContext("2d")!;
      context.fillStyle = color;
      context.fillRect(0, 0, width, 16);
      const asset = await editor.assetStore.add(
        await canvas.convertToBlob({ type: "image/png" }),
        name,
        undefined,
        false,
      );
      assets.push(asset.id);
    }
    const leaf = new Document({ width: 16, height: 16 });
    const image = leaf.layers.add(
      new RasterLayer({ assetId: assets[0], width: 16, height: 16 }),
    );
    image.mask = LayerMask.fromBitmap(assets[1]);
    const leafId = source.defineComponent(leaf);
    const parent = new Document({ width: 32, height: 16 });
    parent.defineComponent(leaf, { id: leafId });
    parent.placeSmartObject(leafId);
    parent.placeSmartObject(leafId, { x: 16 });
    const nested = parent.layers.at(0) as InstanceType<typeof SmartObjectLayer>;
    nested.addFilter(new SmartToneFilter({ saturation: -100 }));
    nested.filterMask = LayerMask.fromBitmap(assets[1]);
    const parentId = source.defineComponent(parent);
    const unused = new Document();
    unused.layers.add(
      new RasterLayer({ assetId: assets[2], width: 16, height: 16 }),
    );
    source.defineComponent(unused);
    const group = source.layers.add(new LayerGroup({ x: 4, y: 6 }));
    const first = group.layers.add(
      new SmartObjectLayer({
        componentId: parentId,
        width: 32,
        height: 16,
        x: 2,
        y: 3,
      }),
    );
    const second = group.layers.add(
      new SmartObjectLayer({
        componentId: parentId,
        width: 32,
        height: 16,
        x: 2,
        y: 27,
      }),
    );
    first.addFilter(new SmartToneFilter({ exposure: 0.5 }));
    first.filterMask = LayerMask.fromBitmap(assets[1]);
    source.selectLayers([first, second]);
    async function pixels(document: typeof source) {
      const canvas = await editor.renderer.render(
        document.toJSON(),
        document.assetStore!,
        { readback: true, cache: true },
      );
      const data = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 64, 64).data,
      ];
      canvas.width = canvas.height = 0;
      return data;
    }
    const originalPixels = await pixels(source);
    const originals = await Promise.all(
      editor.assetStore
        .values()
        .filter((asset) => asset.name !== "Unused")
        .map(async (asset) => [
          asset.name,
          [...new Uint8Array(await asset.blob.arrayBuffer())],
        ]),
    );
    const copies = (await editor.copySelectedLayersTo(target)) as InstanceType<
      typeof SmartObjectLayer
    >[];
    const copied = target.toJSON();
    const exact =
      JSON.stringify(await pixels(target)) === JSON.stringify(originalPixels);
    const oneUndo = target.getSnapshot().past.length === history + 1;
    target.undo();
    const undone = JSON.stringify(target.toJSON()) === JSON.stringify(before);
    target.redo();
    const redone = JSON.stringify(target.toJSON()) === JSON.stringify(copied);
    const copiedLeafId = (
      copies[0].editContents().layers.at(0) as InstanceType<
        typeof SmartObjectLayer
      >
    ).componentId;
    const edited = target.getComponent(copiedLeafId);
    edited.layers.at(0)!.opacity = 0.5;
    target.defineComponent(edited, { id: copiedLeafId });
    const sourceUnchanged =
      JSON.stringify(await pixels(source)) === JSON.stringify(originalPixels);
    await editor.closeDocument(source, { discardChanges: true });
    editor.activateDocument(target);
    const beforeSave = await pixels(target);
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "copied.luma"));
    const reopened = await pixels(editor.document);
    const copiedBytes = await Promise.all(
      editor.assetStore
        .values()
        .map(async (asset) => [
          asset.name,
          [...new Uint8Array(await asset.blob.arrayBuffer())],
        ]),
    );
    return {
      exact,
      oneUndo,
      undone,
      redone,
      sourceUnchanged,
      shared:
        copies[0].componentId === copies[1].componentId &&
        copies[0].componentId !== parentId,
      definitions: copied.components!.length,
      assets: editor.assetStore.values().length,
      byteIdentity:
        JSON.stringify(originals.sort()) === JSON.stringify(copiedBytes.sort()),
      reopened: JSON.stringify(beforeSave) === JSON.stringify(reopened),
      visibleAlpha: reopened[(12 * 64 + 8) * 4 + 3],
      maskedAlpha: reopened[(12 * 64 + 18) * 4 + 3],
    };
  });
  expect(result).toEqual({
    exact: true,
    oneUndo: true,
    undone: true,
    redone: true,
    sourceUnchanged: true,
    shared: true,
    definitions: 3,
    assets: 2,
    byteIdentity: true,
    reopened: true,
    visibleAlpha: 128,
    maskedAlpha: 0,
  });
});

test("destination edits during smart-object decoding reject without publishing assets or definitions", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, RasterLayer, TextLayer } = window.luma;
    const target = editor.document;
    target.layers.add(new TextLayer({ text: "Keep" }));
    const source = editor.newDocument();
    const master = new Document({ width: 16, height: 16 });
    for (const name of ["One", "Two"]) {
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
      const asset = await editor.assetStore.add(
        await canvas.convertToBlob({ type: "image/png" }),
        name,
        undefined,
        false,
      );
      master.layers.add(
        new RasterLayer({ assetId: asset.id, width: 16, height: 16 }),
      );
    }
    source.selectedLayer = source.placeSmartObject(
      source.defineComponent(master),
    );
    const native = window.createImageBitmap;
    let release!: () => void,
      entered!: () => void,
      count = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    window.createImageBitmap = (async (...args: Parameters<typeof native>) => {
      if (++count === 2) {
        entered();
        await gate;
      }
      return Reflect.apply(native, window, args);
    }) as typeof native;
    const copying = editor.copySelectedLayersTo(target).then(
      () => "",
      (error) => String(error),
    );
    await waiting;
    const duringAssets = target.assetStore!.values().length;
    target.name = "Newer target";
    const expected = target.toJSON();
    release();
    const error = await copying;
    window.createImageBitmap = native;
    return {
      error,
      duringAssets,
      afterAssets: target.assetStore!.values().length,
      unchanged: JSON.stringify(target.toJSON()) === JSON.stringify(expected),
      definitions: target.toJSON().components?.length ?? 0,
    };
  });
  expect(result.error).toContain("Destination changed");
  expect(result).toMatchObject({
    duringAssets: 0,
    afterAssets: 0,
    unchanged: true,
    definitions: 0,
  });
});
