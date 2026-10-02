import { expect, test } from "@playwright/test";

for (const scripted of [false, true])
  test(`rasterizes transformed filtered contents with editable outer mask (script ${scripted})`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (scripted) => {
      const {
        editor,
        Document,
        RasterLayer,
        LayerGroup,
        LayerMask,
        MarqueeSelection,
        AffineTransform,
        GaussianBlurFilter,
      } = window.luma;
      editor.newDocument({ width: 96, height: 80 });
      const image = new OffscreenCanvas(32, 32),
        ctx = image.getContext("2d")!;
      ctx.fillStyle = "#ee3244";
      ctx.fillRect(6, 6, 20, 20);
      const blob = await image.convertToBlob({ type: "image/png" });
      const asset = await editor.assetStore.add(
        blob,
        "Original",
        undefined,
        false,
      );
      const master = new Document({ width: 32, height: 32 });
      master.layers.add(
        new RasterLayer({ assetId: asset.id, width: 32, height: 32 }),
      );
      const key = editor.document.defineComponent(master);
      const group = editor.document.layers.add(new LayerGroup());
      group.transform = new AffineTransform(1, 0.1, 0.2, 1, 8, 4);
      const instance = group.layers.add(
        new window.luma.SmartObjectLayer({
          componentId: key,
          width: 32,
          height: 32,
          x: 12,
          y: 8,
          opacity: 0.8,
        }),
      );
      instance.addFilter(new GaussianBlurFilter({ sigma: 1 }));
      instance.mask = new LayerMask({
        selection: new MarqueeSelection({
          shape: "rectangle",
          x: 0,
          y: 0,
          width: 26,
          height: 32,
        }),
      });
      editor.document.selectedLayer = instance;
      const beforeData = editor.document.toJSON(),
        history = editor.document.getSnapshot().past.length;
      const pixels = async () => {
        const canvas = await editor.renderer.render(
          editor.document.toJSON(),
          editor.assetStore,
          { cache: false, readback: true },
        );
        const bytes = [
          ...canvas.getContext("2d")!.getImageData(0, 0, 96, 80).data,
        ];
        canvas.width = canvas.height = 0;
        return bytes;
      };
      const before = await pixels();
      if (scripted)
        await editor.runScript("await document.selectedLayer.rasterize();");
      else await instance.rasterize();
      const after = await pixels(),
        raster = editor.document.selectedLayer!;
      const sameSlot =
        editor.document.toJSON().children[0].kind === "group" &&
        (editor.document.toJSON().children[0] as any).children[0].id ===
          raster.id;
      let color = 0,
        alpha = 0;
      for (let i = 0; i < before.length; i += 4) {
        alpha = Math.max(alpha, Math.abs(before[i + 3] - after[i + 3]));
        for (let c = 0; c < 3; c++)
          color = Math.max(
            color,
            Math.abs(
              (before[i + c] * before[i + 3]) / 255 -
                (after[i + c] * after[i + 3]) / 255,
            ),
          );
      }
      const oneUndo = editor.document.getSnapshot().past.length === history + 1;
      editor.document.undo();
      const undo =
        JSON.stringify(editor.document.toJSON()) === JSON.stringify(beforeData);
      editor.document.redo();
      const redo = JSON.stringify(await pixels()) === JSON.stringify(after);
      const file = await editor.saveProject();
      await editor.openProject(new File([file], "rasterized.luma"));
      return {
        color,
        alpha,
        sameSlot,
        oneUndo,
        undo,
        redo,
        kind: raster.kind,
        opacity: raster.opacity,
        mask: !!raster.mask,
        reopened: JSON.stringify(await pixels()) === JSON.stringify(after),
        source:
          [
            ...new Uint8Array(
              await editor.assetStore.get(asset.id).blob.arrayBuffer(),
            ),
          ].join() === [...new Uint8Array(await blob.arrayBuffer())].join(),
      };
    }, scripted);
    expect(result).toMatchObject({
      sameSlot: true,
      oneUndo: true,
      undo: true,
      redo: true,
      kind: "raster",
      opacity: 0.8,
      mask: true,
      reopened: true,
      source: true,
    });
    expect(result.alpha).toBeLessThanOrEqual(1);
    expect(result.color).toBeLessThanOrEqual(2);
  });

for (const change of ["edit", "close", "cancel"])
  test(`rasterization rejects ${change} during decoding without publishing an asset`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (change) => {
      const { editor, Document, TextLayer } = window.luma;
      editor.newDocument({ width: 32, height: 32 });
      const master = new Document({ width: 32, height: 32 });
      master.layers.add(new TextLayer({ text: "X" }));
      const instance = editor.document.placeSmartObject(
        editor.document.defineComponent(master),
      );
      const doc = editor.document,
        assets = editor.assetStore;
      const original = window.createImageBitmap.bind(window);
      let enter!: () => void,
        release!: () => void,
        closed = 0;
      const entered = new Promise<void>((resolve) => (enter = resolve)),
        gate = new Promise<void>((resolve) => (release = resolve));
      window.createImageBitmap = (async (...args: any[]) => {
        const bitmap = await (original as any)(...args),
          close = bitmap.close.bind(bitmap);
        bitmap.close = () => {
          closed++;
          close();
        };
        enter();
        await gate;
        return bitmap;
      }) as typeof createImageBitmap;
      const controller = new AbortController();
      let error = "";
      const pending = editor
        .rasterizeSmartObject(instance, controller.signal)
        .catch((e) => {
          error = String(e);
        });
      await entered;
      if (change === "close")
        await editor.closeDocument(doc, { discardChanges: true });
      else if (change === "edit") doc.name = "Changed";
      else controller.abort();
      release();
      await pending;
      window.createImageBitmap = original;
      return {
        error,
        assets: assets.values().length,
        kind: doc.layers.at(0)!.kind,
        closed,
      };
    }, change);
    expect(result.error).toMatch(/changed|disposed|abort/i);
    expect(result).toMatchObject({
      assets: 0,
      kind: "smart-object",
      closed: 1,
    });
  });

test("failed scripts discard raster assets and the Layers action remains undoable", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, Document, TextLayer } = window.luma;
    editor.newDocument({ width: 64, height: 64 });
    const master = new Document({ width: 64, height: 64 });
    master.layers.add(new TextLayer({ text: "X" }));
    editor.document.selectedLayer = editor.document.placeSmartObject(
      editor.document.defineComponent(master),
    );
  });
  const failed = await page.evaluate(async () => {
    const editor = window.luma.editor,
      before = JSON.stringify(editor.document.toJSON());
    const count = editor.assetStore.values().length;
    let error = "";
    try {
      await editor.runScript(
        'document.name = "Temporary"; await document.selectedLayer.rasterize(); throw new Error("After rasterization");',
      );
    } catch (failure) {
      error = String(failure);
    }
    return {
      error,
      unchanged: JSON.stringify(editor.document.toJSON()) === before,
      assets: editor.assetStore.values().length === count,
    };
  });
  expect(failed.error).toContain("After rasterization");
  expect(failed).toMatchObject({ unchanged: true, assets: true });
  await page
    .getByRole("button", { name: "Rasterize smart object", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.luma.editor.document.selectedLayer?.kind),
    )
    .toBe("raster");
  expect(
    await page.evaluate(() => {
      window.luma.editor.document.undo();
      return window.luma.editor.document.layers.at(0)!.kind;
    }),
  ).toBe("smart-object");
});
