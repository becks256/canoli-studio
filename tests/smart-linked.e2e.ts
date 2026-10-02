import { expect, test } from "@playwright/test";

test("relinking updates shared placements, supports undo and opens offline from verified snapshots", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, RasterLayer } = window.luma;
    editor.newDocument({ width: 48, height: 24 });
    const image = async (color: string, size: number) => {
      const canvas = new OffscreenCanvas(size, size),
        ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, size, size);
      return canvas.convertToBlob({ type: "image/png" });
    };
    const original = await image("#ff0000", 16),
      asset = await editor.assetStore.add(
        original,
        "Original",
        undefined,
        false,
      );
    const master = new Document({ width: 16, height: 16 });
    master.layers.add(
      new RasterLayer({ assetId: asset.id, width: 16, height: 16 }),
    );
    const componentId = editor.document.defineComponent(master);
    const first = editor.document.placeSmartObject(componentId, { x: 4, y: 4 });
    const second = editor.document.placeSmartObject(componentId, {
      x: 28,
      y: 4,
    });
    const before = editor.document.toJSON(),
      history = editor.document.getSnapshot().past.length;
    const file = new File([await image("#0000ff", 8)], "linked-blue.png", {
      type: "image/png",
      lastModified: 123,
    });
    await editor.relinkSmartObject(first, file);
    const placement =
      JSON.stringify(editor.document.toJSON().children) ===
      JSON.stringify(before.children);
    const oneUndo = editor.document.getSnapshot().past.length === history + 1;
    const link = first.linkedSource!;
    const shared = JSON.stringify(second.linkedSource) === JSON.stringify(link);
    const pixels = async () => {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const ctx = canvas.getContext("2d")!;
      const result = [8, 32].map((x) => [...ctx.getImageData(x, 8, 1, 1).data]);
      canvas.width = canvas.height = 0;
      return result;
    };
    const blue = await pixels();
    editor.document.undo();
    const red = await pixels();
    editor.document.redo();
    const sourceUnchanged =
      [
        ...new Uint8Array(
          await editor.assetStore.get(asset.id).blob.arrayBuffer(),
        ),
      ].join() === [...new Uint8Array(await original.arrayBuffer())].join();
    second.locked = true;
    const assetCount = editor.assetStore.values().length;
    let lockedError = "";
    try {
      await editor.relinkSmartObject(first, file);
    } catch (error) {
      lockedError = String(error);
    }
    const noPublishedAsset = assetCount === editor.assetStore.values().length;
    second.locked = false;
    const project = await editor.saveProject();
    await editor.openProject(new File([project], "linked.luma"));
    const reopened = editor.document.layers.at(0) as InstanceType<
      typeof window.luma.SmartObjectLayer
    >;
    const offline = await pixels(),
      restoredLink = reopened.linkedSource;
    let editError = "";
    try {
      await editor.editSmartObject(reopened);
    } catch (error) {
      editError = String(error);
    }
    await editor.runScript("document.layers.at(0).embedSource();");
    const embedded = !reopened.linkedSource;
    editor.document.undo();
    return {
      placement,
      oneUndo,
      shared,
      blue,
      red,
      sourceUnchanged,
      noPublishedAsset,
      lockedError,
      offline,
      restoredLink,
      link,
      embedded,
      linkUndo: !!reopened.linkedSource,
      editError,
    };
  });
  expect(result).toMatchObject({
    placement: true,
    oneUndo: true,
    shared: true,
    sourceUnchanged: true,
    noPublishedAsset: true,
    embedded: true,
    linkUndo: true,
  });
  expect(result.blue).toEqual([
    [0, 0, 255, 255],
    [0, 0, 255, 255],
  ]);
  expect(result.red).toEqual([
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ]);
  expect(result.offline).toEqual(result.blue);
  expect(result.restoredLink).toEqual(result.link);
  expect(result.lockedError).toContain("locked");
  expect(result.editError).toContain("Embed");
});

test("Layers captures the intended target and exposes relink and embed actions", async ({
  page,
}) => {
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const { editor, Document, TextLayer } = window.luma;
    editor.newDocument({ width: 32, height: 32 });
    const master = new Document({ width: 32, height: 32 });
    master.layers.add(new TextLayer({ text: "Before" }));
    const intended = editor.document.placeSmartObject(
      editor.document.defineComponent(master),
    );
    editor.document.placeSmartObject(editor.document.defineComponent(master));
    editor.document.selectedLayer = intended;
    const canvas = new OffscreenCanvas(8, 8),
      ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#22cc55";
    ctx.fillRect(0, 0, 8, 8);
    return [
      ...new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      ),
    ];
  });
  const choosing = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Link image file", exact: true })
    .click();
  const chooser = await choosing;
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer =
      window.luma.editor.document.layers.at(1);
  });
  const filename = "a".repeat(245) + ".png";
  await chooser.setFiles({
    name: filename,
    mimeType: "image/png",
    buffer: Buffer.from(bytes),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window.luma.editor.document.layers.at(0) as InstanceType<
              typeof window.luma.SmartObjectLayer
            >
          ).linkedSource?.name,
      ),
    )
    .toBe(filename);
  expect(
    await page.evaluate(
      () =>
        (
          window.luma.editor.document.layers.at(1) as InstanceType<
            typeof window.luma.SmartObjectLayer
          >
        ).linkedSource,
    ),
  ).toBeNull();
  await page.evaluate(() => {
    window.luma.editor.document.selectedLayer =
      window.luma.editor.document.layers.at(0);
  });
  await expect(
    page.getByRole("button", { name: "Relink image file", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".linked-source-name")).toHaveAttribute(
    "title",
    filename,
  );
  expect(
    await page
      .locator(".linked-source-name")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Edit contents", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Embed source snapshot", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Link image file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit contents", exact: true }),
  ).toBeEnabled();
});

for (const change of ["edit", "close"])
  test(`late relinking rejects owner ${change} and frees private pixels`, async ({
    page,
  }) => {
    await page.goto("/");
    const result = await page.evaluate(async (change) => {
      const { editor, Document, TextLayer } = window.luma;
      const owner = editor.newDocument({ width: 32, height: 32 });
      const master = new Document({ width: 32, height: 32 });
      master.layers.add(new TextLayer({ text: "Original" }));
      const instance = owner.placeSmartObject(owner.defineComponent(master));
      const assets = editor.assetStore;
      const canvas = new OffscreenCanvas(8, 8);
      canvas.getContext("2d");
      const file = new File(
        [await canvas.convertToBlob({ type: "image/png" })],
        "linked.png",
        { type: "image/png" },
      );
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
      let error = "";
      const pending = editor.relinkSmartObject(instance, file).catch((e) => {
        error = String(e);
      });
      await entered;
      if (change === "close")
        await editor.closeDocument(owner, { discardChanges: true });
      else owner.name = "Changed";
      release();
      await pending;
      window.createImageBitmap = original;
      return {
        error,
        assets: assets.values().length,
        closed,
        linked: instance.linkedSource,
      };
    }, change);
    expect(result.error).toMatch(/changed|disposed/i);
    expect(result).toMatchObject({ assets: 0, closed: 1, linked: null });
  });

test("opening a project rejects a linked fingerprint that disagrees with real embedded pixels", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, TextLayer } = window.luma;
    const owner = editor.newDocument({ width: 16, height: 16 });
    const master = new Document({ width: 16, height: 16 });
    master.layers.add(new TextLayer({ text: "X" }));
    const instance = owner.placeSmartObject(owner.defineComponent(master));
    const canvas = new OffscreenCanvas(8, 8);
    canvas.getContext("2d");
    await editor.relinkSmartObject(
      instance,
      new File(
        [await canvas.convertToBlob({ type: "image/png" })],
        "source.png",
        { type: "image/png" },
      ),
    );
    const data = owner.toJSON(),
      source = data.components![0].source;
    if (source.kind !== "asset") throw new Error("Expected asset");
    source.link!.sha256 = "0".repeat(64);
    const assets = await Promise.all(
      editor.assetStore
        .values()
        .map(async (asset) => ({
          id: asset.id,
          name: asset.name,
          width: asset.width,
          height: asset.height,
          dataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(await asset.blob.arrayBuffer())))}`,
        })),
    );
    const before = JSON.stringify(owner.toJSON()),
      count = editor.openDocuments.length;
    let error = "";
    try {
      await editor.openProject(
        new File(
          [
            JSON.stringify({
              format: "luma",
              version: 1,
              document: data,
              assets,
            }),
          ],
          "broken.luma",
        ),
      );
    } catch (failure) {
      error = String(failure);
    }
    return {
      error,
      unchanged:
        editor.document === owner && JSON.stringify(owner.toJSON()) === before,
      count: editor.openDocuments.length === count,
    };
  });
  expect(result.error).toContain("fingerprint");
  expect(result).toMatchObject({ unchanged: true, count: true });
});

test("long linked filenames survive independent copies, cross-document transfer and offline reopening", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, Document, TextLayer, SmartObjectLayer } = window.luma;
    const source = editor.newDocument({
      name: "Source",
      width: 64,
      height: 32,
    });
    const master = new Document({ width: 16, height: 16 });
    master.layers.add(new TextLayer({ text: "Before" }));
    const instance = source.placeSmartObject(source.defineComponent(master));
    const image = async (color: string) => {
      const canvas = new OffscreenCanvas(16, 16),
        ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 16, 16);
      return canvas.convertToBlob({ type: "image/png" });
    };
    const name = "a".repeat(245) + ".png";
    await editor.relinkSmartObject(
      instance,
      new File([await image("#ff0000")], name, {
        type: "image/png",
        lastModified: 42,
      }),
    );
    const independent = instance.duplicateIndependent();
    independent.x = 24;
    independent.y = 0;
    const originalLink = instance.linkedSource;
    await editor.relinkSmartObject(
      independent,
      new File([await image("#0000ff")], "blue.png", { type: "image/png" }),
    );
    const originalStillLinked =
      JSON.stringify(instance.linkedSource) === JSON.stringify(originalLink);
    const destination = editor.newDocument({
      name: "Destination",
      width: 64,
      height: 32,
    });
    editor.activateDocument(source);
    source.selectLayers([instance, independent]);
    const history = destination.getSnapshot().past.length;
    const copied = await editor.copySelectedLayersTo(destination);
    const oneUndo = destination.getSnapshot().past.length === history + 1;
    const remapped = copied.every(
      (layer) =>
        layer instanceof SmartObjectLayer &&
        layer.componentId !== instance.componentId &&
        layer.componentId !== independent.componentId,
    );
    await editor.closeDocument(source, { discardChanges: true });
    editor.activateDocument(destination);
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "copied-links.luma"));
    const canvas = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const ctx = canvas.getContext("2d")!,
      pixels = [8, 32].map((x) => [...ctx.getImageData(x, 8, 1, 1).data]);
    canvas.width = canvas.height = 0;
    const linkedNames = [...editor.document.layers].map(
      (layer) =>
        (layer as InstanceType<typeof SmartObjectLayer>).linkedSource!.name,
    );
    const assetNames = editor.assetStore.values().map((asset) => asset.name);
    return {
      name,
      oneUndo,
      remapped,
      originalStillLinked,
      pixels,
      linkedNames,
      longAssetName: assetNames.includes(name),
    };
  });
  expect(result).toMatchObject({
    oneUndo: true,
    remapped: true,
    originalStillLinked: true,
    longAssetName: true,
  });
  expect(result.linkedNames).toEqual([result.name, "blue.png"]);
  expect(result.pixels).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
});
