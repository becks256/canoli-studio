import { test, expect } from "@playwright/test";

test("isolated scripts capture and restore comps through project reopening and undo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor } = window.luma;
    editor.newDocument({ width: 64, height: 32 });
    await editor.runScript(`const layer = document.layers.add(new TextLayer({ text: 'Original', x: 4 }));
      document.layerComps.add(new LayerComp({ name: 'Layout' })); layer.x = 24; layer.text = 'Revised';`);
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "comps.luma"));
    const before = editor.document.toJSON(),
      history = editor.document.getSnapshot().past.length;
    await editor.runScript("document.layerComps.at(0).apply();");
    const after = editor.document.toJSON();
    const oneUndo = editor.document.getSnapshot().past.length === history + 1;
    editor.document.undo();
    const undone =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    editor.document.redo();
    return {
      before,
      after,
      oneUndo,
      undone,
      redo: editor.document.layers.at(0)!.x,
    };
  });
  expect(result.before.layerComps).toHaveLength(1);
  expect(result.after.children[0]).toMatchObject({ x: 4, text: "Revised" });
  expect(result).toMatchObject({ oneUndo: true, undone: true, redo: 4 });
});

test("panel captures selected categories, restores with undo, updates, renames and removes", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.newDocument({ width: 64, height: 32 });
    editor.document.layers.add(new TextLayer({ text: "Artwork", x: 4 }));
  });
  const panel = page.getByRole("region", { name: "Layer comps", exact: true });
  await panel.locator(".inspector-section-toggle").click();
  await panel
    .getByLabel("New comp name", { exact: true })
    .fill("Visible layout");
  await panel.getByLabel("Position", { exact: true }).uncheck();
  await panel.getByLabel("Appearance", { exact: true }).uncheck();
  await panel
    .getByRole("button", { name: "Capture layer comp", exact: true })
    .click();
  let entry = panel.getByRole("group", {
    name: "Visible layout layer comp",
    exact: true,
  });
  await expect(entry).toBeVisible();
  await page.evaluate(() => {
    const layer = window.luma.editor.document.layers.at(0)!;
    layer.x = 24;
    layer.opacity = 0.3;
    layer.visible = false;
  });
  await entry.getByRole("button", { name: "Apply", exact: true }).click();
  expect(
    await page.evaluate(() => {
      const layer = window.luma.editor.document.layers.at(0)!;
      return { x: layer.x, opacity: layer.opacity, visible: layer.visible };
    }),
  ).toEqual({ x: 24, opacity: 0.3, visible: true });
  await page.evaluate(() => window.luma.editor.document.undo());
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layers.at(0)!.visible,
    ),
  ).toBe(false);
  await entry.getByLabel("Comp name", { exact: true }).fill("Hidden layout");
  await entry.getByLabel("Comp name", { exact: true }).press("Enter");
  entry = panel.getByRole("group", {
    name: "Hidden layout layer comp",
    exact: true,
  });
  await entry.getByRole("button", { name: "Update", exact: true }).click();
  await page.evaluate(() => {
    window.luma.editor.document.layers.at(0)!.visible = true;
  });
  await entry.getByRole("button", { name: "Apply", exact: true }).click();
  expect(
    await page.evaluate(
      () => window.luma.editor.document.layers.at(0)!.visible,
    ),
  ).toBe(false);
  await page.evaluate(() => {
    const doc = window.luma.editor.document;
    doc._dispatch({ type: "layer.remove", id: doc.layers.at(0)!.id });
  });
  await expect(
    entry.getByText("1 removed layer will be skipped."),
  ).toBeVisible();
  await entry.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "Skipped 1 removed layers",
  );
  await entry.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(panel.getByText("No saved comps yet.")).toBeVisible();
  await page.evaluate(() => window.luma.editor.document.undo());
  await expect(entry).toBeVisible();
});

test("cropped comp restoration matches original crop pixels after project reopening", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer, LayerGroup, LayerComp } = window.luma;
    const doc = editor.newDocument({ width: 96, height: 64 });
    const group = doc.layers.add(new LayerGroup({ x: 20, y: 16 }));
    const child = group.layers.add(
      new TextLayer({ text: "A", fontSize: 24, color: "#ff0000", x: 2, y: 3 }),
    );
    doc.layerComps.add(new LayerComp({ name: "Original" }));
    const canvas = await editor.renderer.render(
      doc.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const expected = [
      ...canvas.getContext("2d")!.getImageData(8, 8, 64, 48).data,
    ];
    canvas.width = canvas.height = 0;
    group.x = 40;
    child.x = 12;
    doc.crop({ x: 8, y: 8, width: 64, height: 48 });
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "cropped-comp.luma"));
    editor.document.layerComps.at(0)!.apply();
    const restored = await editor.renderer.render(
      editor.document.toJSON(),
      editor.assetStore,
      { cache: false, readback: true },
    );
    const actual = [
      ...restored.getContext("2d")!.getImageData(0, 0, 64, 48).data,
    ];
    restored.width = restored.height = 0;
    return {
      exact: JSON.stringify(actual) === JSON.stringify(expected),
      visible: expected.some((value, index) => index % 4 === 3 && value > 0),
    };
  });
  expect(result).toEqual({ exact: true, visible: true });
});

test("copied smart masters retain comp target bindings and editable contents ownership", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const {
      editor,
      Document,
      TextLayer,
      LayerGroup,
      LayerComp,
      SmartObjectLayer,
    } = window.luma;
    const source = editor.newDocument();
    const master = new Document();
    const group = master.layers.add(new LayerGroup({ x: 10 }));
    const child = group.layers.add(new TextLayer({ text: "A", x: 3 }));
    master.layerComps.add(new LayerComp({ name: "Layout" }));
    group.x = 20;
    child.x = 30;
    const original = source.placeSmartObject(source.defineComponent(master));
    source.selectedLayer = original;
    const target = editor.newDocument();
    editor.activateDocument(source);
    const [copy] = await editor.copySelectedLayersTo(target);
    const copied = target.getComponent(
      (copy as InstanceType<typeof SmartObjectLayer>).componentId,
    );
    const saved = copied.layerComps.at(0)!.toJSON();
    const newGroup = copied.layers.at(0) as InstanceType<typeof LayerGroup>;
    const bindings =
      saved.layers[0].id === newGroup.id &&
      saved.layers[1].id === newGroup.layers.at(0)!.id &&
      saved.layers[1].parentId === newGroup.id;
    const contents = await editor.editSmartObject(
      copy as InstanceType<typeof SmartObjectLayer>,
    );
    const missing = contents.layerComps.at(0)!.apply().missingLayerIds;
    await editor.applySmartObjectContents(contents);
    const restored = target.getComponent(
      (copy as InstanceType<typeof SmartObjectLayer>).componentId,
    );
    const restoredGroup = restored.layers.at(0) as InstanceType<
      typeof LayerGroup
    >;
    return {
      bindings,
      missing,
      groupX: restoredGroup.x,
      childX: restoredGroup.layers.at(0)!.x,
      originalX: source.getComponent(original.componentId).layers.at(0)!.x,
    };
  });
  expect(result).toEqual({
    bindings: true,
    missing: [],
    groupX: 10,
    childX: 3,
    originalX: 20,
  });
});

test("appearance and affine geometry restore exact pixels with styles, masks and preserved source bytes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, RasterLayer, LayerGroup, LayerComp, LayerMask } =
      window.luma;
    const { defaultStyle } = await import(
      /* @vite-ignore */ String("/src/core/drawing.ts")
    );
    const doc = editor.newDocument({ width: 128, height: 128 });
    const source = new OffscreenCanvas(24, 24),
      ctx = source.getContext("2d")!;
    ctx.fillStyle = "#ee4488";
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = "#2277cc";
    ctx.fillRect(0, 0, 12, 12);
    ctx.clearRect(16, 16, 8, 8);
    const blob = await source.convertToBlob({ type: "image/png" });
    const originalBytes = [...new Uint8Array(await blob.arrayBuffer())];
    const asset = await editor.assetStore.add(
      blob,
      "original.png",
      undefined,
      false,
    );
    const group = doc.layers.add(
      new LayerGroup({ x: 24, y: 24, opacity: 0.8 }),
    );
    const raster = group.layers.add(
      new RasterLayer({ assetId: asset.id, width: 48, height: 48, x: 8, y: 4 }),
    );
    raster.mask = new LayerMask({ base: 1, density: 0.75 });
    const styles = defaultStyle();
    styles.colorOverlay = { enabled: true, color: "#ffaa22", opacity: 0.4 };
    styles.dropShadow = {
      enabled: true,
      color: "#111133",
      opacity: 0.7,
      x: 5,
      y: 7,
      blur: 3,
    };
    doc._dispatch({
      type: "layer.update",
      id: raster.id,
      patch: {
        styles,
        opacity: 0.85,
        fillOpacity: 0.65,
        blendMode: "multiply",
        transform: { a: 0.9, b: 0.2, c: -0.15, d: 1.1, e: 0, f: 0 },
      },
    });
    const pixels = async () => {
      const canvas = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true },
      );
      const data = [
        ...canvas.getContext("2d")!.getImageData(0, 0, 128, 128).data,
      ];
      canvas.width = canvas.height = 0;
      return data;
    };
    const expected = await pixels();
    doc.layerComps.add(new LayerComp({ name: "Styled layout" }));
    group.x = 4;
    group.opacity = 1;
    doc._dispatch({
      type: "layer.update",
      id: raster.id,
      patch: {
        x: 40,
        y: 20,
        width: 24,
        height: 32,
        styles: defaultStyle(),
        opacity: 1,
        fillOpacity: 1,
        blendMode: "normal",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    });
    const different =
      JSON.stringify(await pixels()) !== JSON.stringify(expected);
    const file = await editor.saveProject();
    await editor.openProject(new File([file], "styled-comp.luma"));
    const before = editor.document.toJSON();
    editor.document.layerComps.at(0)!.apply();
    const exact = JSON.stringify(await pixels()) === JSON.stringify(expected);
    const retainedBytes = [
      ...new Uint8Array(
        await editor.assetStore.get(asset.id).blob.arrayBuffer(),
      ),
    ];
    editor.document.undo();
    const undo =
      JSON.stringify(editor.document.toJSON()) === JSON.stringify(before);
    editor.document.redo();
    const redoExact =
      JSON.stringify(await pixels()) === JSON.stringify(expected);
    return {
      different,
      exact,
      undo,
      redoExact,
      sourceIntact:
        JSON.stringify(originalBytes) === JSON.stringify(retainedBytes),
    };
  });
  expect(result).toEqual({
    different: true,
    exact: true,
    undo: true,
    redoExact: true,
    sourceIntact: true,
  });
});
