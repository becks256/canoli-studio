import { expect, test } from "@playwright/test";

test("scripted filter masks mix native pixels, preserve alpha, history and source bytes on reopen", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const editor = window.luma.editor;
    editor.newDocument({ width: 80, height: 40 });
    const image = new OffscreenCanvas(32, 16),
      c = image.getContext("2d")!;
    c.fillStyle = "#ff0000";
    c.fillRect(0, 0, 32, 16);
    const blob = await image.convertToBlob(),
      asset = await editor.assetStore.add(blob, "Original", undefined, false);
    await editor.runScript(`const master = new Document({ width:32, height:16 });
      master.layers.add(new RasterLayer({assetId:${JSON.stringify(asset.id)},width:32,height:16}));
      const key=document.defineComponent(master); document.placeSmartObject(key,{x:8,y:8,width:64,height:16});
      document.layers.at(0).setFilters([new SmartToneFilter({saturation:-100})]);`);
    async function pixels(cache = true) {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache, readback: true },
      );
      const values = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 80, 40).data,
      ];
      canvas.width = canvas.height = 0;
      return values;
    }
    const filtered = await pixels();
    const history = editor.document.getSnapshot().past.length;
    await editor.runScript(
      `document.layers.at(0).filterMask=new LayerMask({selection:new MarqueeSelection({shape:"rectangle",x:0,y:0,width:16,height:16})});`,
    );
    const mixed = await pixels();
    const uncached = await pixels(false);
    const { exportPng } = await import(
      /* @vite-ignore */ String("/src/engine/png.ts")
    );
    const png = await exportPng(
      editor.document.toJSON(),
      editor.assetStore,
      editor.renderer,
    );
    const bitmap = await createImageBitmap(png),
      exported = new OffscreenCanvas(80, 40),
      out = exported.getContext("2d")!;
    out.drawImage(bitmap, 0, 0);
    bitmap.close();
    const exportExact = [...out.getImageData(0, 0, 80, 40).data].every(
      (v, i) => v === mixed[i],
    );
    const undoEntry = editor.document.getSnapshot().past.length === history + 1;
    editor.document.undo();
    const undone = await pixels();
    editor.document.redo();
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "masked.luma"));
    const reopened = await pixels();
    const sourceBytes = [
      ...new Uint8Array(
        await editor.assetStore.get(asset.id).blob.arrayBuffer(),
      ),
    ];
    const at = (values: number[], x: number) =>
      values.slice((16 * 80 + x) * 4, (16 * 80 + x) * 4 + 4);
    await editor.runScript(
      "document.layers.at(0).filterMask = new LayerMask({base:0});",
    );
    const original = await pixels();
    await editor.runScript(
      "document.layers.at(0).filterMask = document.layers.at(0).filterMask.with({density:0});",
    );
    const zeroDensity = await pixels();
    return {
      exportExact,
      left: at(mixed, 20),
      right: at(mixed, 60),
      undoEntry,
      undoExact: JSON.stringify(undone) === JSON.stringify(filtered),
      cacheExact: JSON.stringify(mixed) === JSON.stringify(uncached),
      reopenExact: JSON.stringify(mixed) === JSON.stringify(reopened),
      sourceExact:
        JSON.stringify(sourceBytes) ===
        JSON.stringify([...new Uint8Array(await blob.arrayBuffer())]),
      original: at(original, 20),
      densityExact: JSON.stringify(zeroDensity) === JSON.stringify(filtered),
    };
  });
  expect(result).toMatchObject({
    exportExact: true,
    left: [54, 54, 54, 255],
    right: [255, 0, 0, 255],
    undoEntry: true,
    undoExact: true,
    cacheExact: true,
    reopenExact: true,
    sourceExact: true,
    original: [255, 0, 0, 255],
    densityExact: true,
  });
});

test("unlinked masks stay in their containing document when nested instances move and resize", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      Document,
      RasterLayer,
      LayerMask,
      MarqueeSelection,
      SmartToneFilter,
    } = window.luma;
    const editor = window.luma.editor;
    editor.newDocument({ width: 128, height: 32 });
    const image = new OffscreenCanvas(16, 16),
      c = image.getContext("2d")!;
    c.fillStyle = "#ff0000";
    c.fillRect(0, 0, 16, 16);
    const asset = await editor.assetStore.add(
      await image.convertToBlob(),
      "Red",
      undefined,
      false,
    );
    const leaf = new Document({ width: 16, height: 16 });
    leaf.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 16 }),
    );
    const parent = new Document({ width: 64, height: 16 });
    const key = parent.defineComponent(leaf);
    const child = parent.placeSmartObject(key, {
      x: 16,
      width: 32,
      height: 16,
    });
    child.addFilter(new SmartToneFilter({ saturation: -100 }));
    child.filterMask = new LayerMask({
      linked: false,
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 16,
        y: 0,
        width: 16,
        height: 16,
      }),
    });
    editor.document.defineComponent(leaf, { id: key });
    const rootKey = editor.document.defineComponent(parent);
    const root = editor.document.placeSmartObject(rootKey, {
      x: 16,
      width: 64,
      height: 16,
    });
    async function sample() {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { readback: true, cache: false },
      );
      const p = canvas.getContext("2d")!.getImageData(0, 0, 128, 32).data;
      const at = (x: number) => [
        ...p.slice((8 * 128 + x) * 4, (8 * 128 + x) * 4 + 4),
      ];
      const result = [at(36), at(52)];
      canvas.width = canvas.height = 0;
      return result;
    }
    const nested = await sample();
    root.addFilter(new SmartToneFilter({ exposure: 0 }));
    const preservedNested = await sample();
    // Root filter forces native-master rendering instead of resolver-only expansion.
    const direct = editor.document.placeSmartObject(
      editor.document.defineComponent(leaf),
      { x: 80, width: 32, height: 16 },
    );
    direct.addFilter(new SmartToneFilter({ saturation: -100 }));
    direct.filterMask = new LayerMask({
      linked: false,
      selection: new MarqueeSelection({
        shape: "rectangle",
        x: 80,
        y: 0,
        width: 16,
        height: 16,
      }),
    });
    direct.x = 88;
    const canvas = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { readback: true, cache: false },
    );
    const p = canvas.getContext("2d")!.getImageData(0, 0, 128, 32).data;
    const at = (x: number) => [
      ...p.slice((8 * 128 + x) * 4, (8 * 128 + x) * 4 + 4),
    ];
    const moved = [at(92), at(100)];
    canvas.width = canvas.height = 0;
    return { nested, preservedNested, moved };
  });
  expect(result).toEqual({
    nested: [
      [54, 54, 54, 255],
      [255, 0, 0, 255],
    ],
    preservedNested: [
      [54, 54, 54, 255],
      [255, 0, 0, 255],
    ],
    moved: [
      [54, 54, 54, 255],
      [255, 0, 0, 255],
    ],
  });
});
