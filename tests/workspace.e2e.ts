import { expect, test } from "@playwright/test";

test("document tabs preserve source pixels, selection, undo and recovery across switches", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("tablist", { name: "Open documents" }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const { editor } = window.luma;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!)),
    );
    await editor.importImage(
      new File([blob], "Red.png", { type: "image/png" }),
    );
    editor.document.selectedLayer!.x = 1;
    await editor.recovery.flush();
  });
  await page
    .getByRole("button", { name: "New document tab", exact: true })
    .click();
  await page.getByLabel("Document name", { exact: true }).fill("Second");
  await page.getByLabel("Document name", { exact: true }).press("Enter");
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Second artwork" }));
    await editor.recovery.flush();
  });
  await page.getByRole("tab", { name: /Red/ }).click();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.x),
  ).toBe(1);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.x),
  ).toBe(0);
  const recovered = await page.evaluate(async () => {
    const { editor } = window.luma;
    const bitmap = editor.assetStore.values()[0].bitmap;
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    return {
      pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data),
      names: (await editor.recovery.repository.list()).map(
        (item) => item.document.name,
      ),
    };
  });
  expect(recovered.pixel).toEqual([255, 0, 0, 255]);
  expect(recovered.names).toEqual(expect.arrayContaining(["Red", "Second"]));
  await page.getByRole("tab", { name: /Second/ }).click();
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Close Second", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Second/ })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Close Second", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Second/ })).not.toBeVisible();
  await expect(page.getByRole("tab", { name: /Red/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("each document tab restores its own zoom and pan", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "View A";
    editor.document.layers.add(new TextLayer({ text: "A" }));
    const first = editor.document;
    editor.newDocument();
    editor.document.name = "View B";
    editor.document.layers.add(new TextLayer({ text: "B" }));
    editor.activateDocument(first);
  });
  await page.getByRole("tab", { name: /View A/ }).click();
  await page.keyboard.press("Control+1");
  const box = await page.locator(".viewport").boundingBox();
  const x = box!.x + box!.width / 2,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + 60, y + 40);
  await page.mouse.up({ button: "middle" });
  const first = await page.locator(".canvas-wrap").getAttribute("style");
  await page.getByRole("tab", { name: /View B/ }).click();
  await page.keyboard.press("Control+1");
  await page.keyboard.press("-");
  const second = await page.locator(".canvas-wrap").getAttribute("style");
  expect(first).not.toBe(second);
  await page.getByRole("tab", { name: /View A/ }).click();
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("style", first!);
  await page.getByRole("tab", { name: /View B/ }).click();
  await expect(page.locator(".canvas-wrap")).toHaveAttribute("style", second!);
});

test("document tabs reorder with keyboard and dragging without editing documents", async ({
  page,
}) => {
  await page.goto("/");
  const revisions = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Order A";
    editor.document.layers.add(new TextLayer({ text: "A" }));
    const a = editor.document;
    editor.newDocument();
    editor.document.name = "Order B";
    editor.document.layers.add(new TextLayer({ text: "B" }));
    editor.activateDocument(a);
    return editor.openDocuments.map((doc) => ({
      id: doc.id,
      revision: doc.getSnapshot().revision,
    }));
  });
  const first = page.getByRole("tab", { name: /Order A/ });
  await first.focus();
  await first.press("Alt+ArrowRight");
  await expect(page.getByRole("tab").first()).toContainText("Order B");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await first.dragTo(page.getByRole("tab", { name: /Order B/ }));
  await expect(page.getByRole("tab").first()).toContainText("Order A");
  const after = await page.evaluate(() =>
    window.luma.editor.openDocuments.map((doc) => ({
      id: doc.id,
      revision: doc.getSnapshot().revision,
    })),
  );
  expect(after).toEqual(revisions);
});

test("copied raster artwork owns its assets after source closure and supports undo", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer, LayerGroup } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Destination" }));
    const target = editor.document;
    editor.newDocument();
    const source = editor.document;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    canvas.getContext("2d")!.fillStyle = "#ff0000";
    canvas.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const raster = await editor.importImage(
      new File([blob], "source.png", { type: "image/png" }),
    );
    const group = new LayerGroup({ name: "Offset", x: 20, y: 30 });
    source.layers.add(group);
    raster.moveTo(group);
    raster.x = 3;
    raster.y = 4;
    source.selectedLayer = raster;
    const before = target.getSnapshot().revision;
    const [copy] = await editor.copySelectedLayersTo(target);
    const copyId = copy.id;
    const assetId = (copy.toJSON() as any).assetId;
    const differentAsset = assetId !== raster.assetId;
    await editor.closeDocument(source, { discardChanges: true });
    editor.activateDocument(target);
    const bitmap = editor.assetStore.get(assetId).bitmap;
    const pixelCanvas = new OffscreenCanvas(1, 1);
    const ctx = pixelCanvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, 1, 1);
    const pixel = [...ctx.getImageData(0, 0, 1, 1).data];
    const position = { x: copy.x, y: copy.y };
    const oneRevision = target.getSnapshot().revision === before + 1;
    target.undo();
    const removed = !target.getLayer(copyId);
    target.redo();
    return {
      differentAsset,
      pixel,
      position,
      oneRevision,
      removed,
      restored: !!target.getLayer(copyId),
    };
  });
  expect(result).toEqual({
    differentAsset: true,
    pixel: [255, 0, 0, 255],
    position: { x: 23, y: 34 },
    oneRevision: true,
    removed: true,
    restored: true,
  });
});

test("Layers panel copies selected artwork to a chosen document", async ({
  page,
}) => {
  await page.goto("/");
  const targetId = await page.evaluate(() => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Destination";
    editor.document.layers.add(new TextLayer({ text: "Existing" }));
    const targetId = editor.documentSessions[0].id;
    editor.newDocument();
    editor.document.name = "Source";
    const text = new TextLayer({
      name: "Copied title",
      text: "Artwork",
      x: 25,
      y: 35,
    });
    editor.document.layers.add(text);
    editor.document.selectedLayer = text;
    return targetId;
  });
  const picker = page.getByRole("combobox", {
    name: "Copy selected layers to document",
  });
  await expect(picker).toBeEnabled();
  await picker.selectOption(targetId);
  await expect(page.getByRole("tab", { name: /Source/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(picker).toBeEnabled();
  await page.getByRole("tab", { name: /Destination/ }).click();
  expect(
    await page.evaluate(() => window.luma.editor.document.selectedLayer?.name),
  ).toBe("Copied title");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(2);
  await page.keyboard.press("Control+z");
  expect(
    await page.evaluate(() => window.luma.editor.document.layers.length),
  ).toBe(1);
});

test("copying a selected group deduplicates descendants and transfers bitmap masks", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer, LayerGroup, LayerMask } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Destination" }));
    const target = editor.document;
    editor.newDocument();
    const source = editor.document;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const raster = await editor.importImage(
      new File([blob], "image.png", { type: "image/png" }),
    );
    const group = new LayerGroup({ name: "Group" });
    source.layers.add(group);
    raster.moveTo(group);
    group.mask = LayerMask.fromBitmap(raster.assetId);
    source.selectLayers([group, raster]);
    const [copy] = await editor.copySelectedLayersTo(target);
    const data = copy.toJSON();
    if (
      data.kind !== "group" ||
      data.mask?.kind !== "bitmap" ||
      data.children[0].kind !== "raster"
    )
      throw new Error("Missing group content");
    await editor.closeDocument(source, { discardChanges: true });
    editor.activateDocument(target);
    const portable = await editor.saveProject();
    await editor.openProject(new File([portable], "copied.luma"));
    return {
      roots: target.layers.length,
      freshGroup: data.id !== group.id,
      freshChild: data.children[0].id !== raster.id,
      sharedCopiedAsset: data.mask.assetId === data.children[0].assetId,
      freshAsset: data.mask.assetId !== raster.assetId,
      assetCount: editor.assetStore.values().length,
      reopened: editor.document.layers.length,
    };
  });
  expect(result).toEqual({
    roots: 2,
    freshGroup: true,
    freshChild: true,
    sharedCopiedAsset: true,
    freshAsset: true,
    assetCount: 1,
    reopened: 2,
  });
});

test("destination edits during async copying reject and release newly decoded assets", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Destination" }));
    const target = editor.document;
    editor.newDocument();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    await editor.importImage(
      new File([blob], "image.png", { type: "image/png" }),
    );
    const assets = editor.documentSessions.find(
      (session) => session.document === target,
    )!.assets;
    const original = window.createImageBitmap;
    let closed = 0;
    window.createImageBitmap = (async (
      ...args: Parameters<typeof original>
    ) => {
      const bitmap = await Reflect.apply(original, window, args);
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => {
        closed++;
        close();
      };
      target.name = "Changed during copy";
      return bitmap;
    }) as typeof original;
    let error = "";
    try {
      await editor.copySelectedLayersTo(target);
    } catch (failure) {
      error = String(failure);
    } finally {
      window.createImageBitmap = original;
    }
    return {
      error,
      closed,
      assets: assets.values().length,
      layers: target.layers.length,
      name: target.name,
    };
  });
  expect(result.error).toContain("Destination changed");
  expect(result.assets).toBe(0);
  expect(result.layers).toBe(1);
  expect(result.name).toBe("Changed during copy");
  expect(result.closed).toBe(1);
});

test("copied clone-stamp tiles render identically after source closure and project reopen", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer, PaintLayer, CloneStroke } = window.luma;
    editor.document.resize(16, 16);
    editor.document.layers.add(
      new TextLayer({ text: "Keep destination", visible: false }),
    );
    const target = editor.document;
    editor.newDocument();
    editor.document.resize(16, 16);
    const source = editor.document;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!)),
    );
    const asset = await editor.assetStore.add(blob, "Clone source");
    const paint = new PaintLayer({ name: "Cloned artwork" });
    source.layers.add(paint);
    const stroke = new CloneStroke({
      points: [{ x: 8, y: 8 }],
      size: 16,
      hardness: 1,
      opacity: 1,
      tiles: [{ assetId: asset.id, x: 0, y: 0, width: 16, height: 16 }],
    });
    paint.strokes.add(stroke);
    source.selectedLayer = paint;
    const renderPixels = async () => {
      const rendered = await editor.renderer.render(
        editor.document.toJSON(),
        editor.assetStore,
        { cache: false, readback: true, maxPixels: 256, maxDimension: 16 },
      );
      return [...rendered.getContext("2d")!.getImageData(0, 0, 16, 16).data];
    };
    const before = await renderPixels();
    const [copy] = await editor.copySelectedLayersTo(target);
    const data = copy.toJSON();
    if (data.kind !== "paint" || data.strokes[0].kind !== "clone")
      throw new Error("Clone stroke missing");
    const freshStroke = data.strokes[0].id !== stroke.id;
    const freshAsset = data.strokes[0].tiles[0].assetId !== asset.id;
    await editor.closeDocument(source, { discardChanges: true });
    editor.activateDocument(target);
    const after = await renderPixels();
    const portable = await editor.saveProject();
    await editor.openProject(new File([portable], "clone-copy.luma"));
    const reopened = await renderPixels();
    return {
      freshStroke,
      freshAsset,
      same: JSON.stringify(before) === JSON.stringify(after),
      roundTrip: JSON.stringify(after) === JSON.stringify(reopened),
      center: reopened.slice((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 4),
    };
  });
  expect(result).toEqual({
    freshStroke: true,
    freshAsset: true,
    same: true,
    roundTrip: true,
    center: [255, 0, 0, 255],
  });
});

test("workspace checkpoint restores order, active tab, selection and views after reload", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Saved A";
    const layer = new TextLayer({ text: "Selected artwork" });
    editor.document.layers.add(layer);
    editor.document.selectedLayer = layer;
    const a = editor.document;
    editor.newDocument();
    editor.document.name = "Saved B";
    editor.document.layers.add(new TextLayer({ text: "Second" }));
    editor.moveDocument(editor.document, 0);
    editor.activateDocument(a);
    editor.documentSessions.find((session) => session.document === a)!.view = {
      zoom: 1.25,
      pan: { x: 80, y: -20 },
      initialized: true,
    };
    await editor.saveWorkspace();
    return {
      names: editor.openDocuments.map((doc) => doc.name),
      selected: layer.id,
    };
  });
  await page.reload();
  const after = await page.evaluate(async () => {
    const editor = window.luma.editor;
    await editor.restoreWorkspace();
    const session = editor.documentSessions.find(
      (entry) => entry.document === editor.document,
    )!;
    return {
      names: editor.openDocuments.map((doc) => doc.name),
      active: editor.document.name,
      selected: editor.document.selectedLayer?.id,
      view: session.view,
    };
  });
  expect(after).toEqual({
    names: before.names,
    active: "Saved A",
    selected: before.selected,
    view: { zoom: 1.25, pan: { x: 80, y: -20 }, initialized: true },
  });
  await expect(page.getByRole("tab", { name: /Saved A/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("workspace restores per-document proof settings and rejects damaged snapshots atomically", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Proof A";
    editor.document.layers.add(new TextLayer({ text: "A" }));
    editor.setColorProfile("display-p3");
    editor.setSoftProof({
      proofSpace: "adobe-rgb",
      intent: "relative-colorimetric",
      gamutWarning: true,
      warningColor: [255, 0, 255, 255],
    });
    editor.newDocument();
    editor.document.name = "Proof B";
    editor.document.layers.add(new TextLayer({ text: "B" }));
    editor.setColorProfile("linear-srgb");
    await editor.saveWorkspace();
    const restored = await editor.restoreWorkspace();
    editor.activateDocument(restored[0]);
    const first = { profile: editor.colorProfile, proof: editor.softProof };
    editor.activateDocument(restored[1]);
    const second = { profile: editor.colorProfile, proof: editor.softProof };
    const saved = (await editor.workspaceRepository.load())!;
    saved.documents[1].project = new Blob(["damaged project"]);
    await editor.workspaceRepository.save(saved);
    const before = [...editor.openDocuments];
    const active = editor.document;
    let rejected = false;
    try {
      await editor.restoreWorkspace();
    } catch {
      rejected = true;
    }
    return {
      first,
      second,
      rejected,
      sameTabs:
        before.every((doc, index) => editor.openDocuments[index] === doc) &&
        before.length === editor.openDocuments.length,
      sameActive: editor.document === active,
    };
  });
  expect(result).toEqual({
    first: {
      profile: "display-p3",
      proof: {
        proofSpace: "adobe-rgb",
        intent: "relative-colorimetric",
        gamutWarning: true,
        warningColor: [255, 0, 255, 255],
      },
    },
    second: { profile: "linear-srgb", proof: null },
    rejected: true,
    sameTabs: true,
    sameActive: true,
  });
});

test("opt-in startup restoration opens the saved workspace exactly once", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.name = "Startup artwork";
    editor.document.layers.add(new TextLayer({ text: "Persistent" }));
    await editor.saveWorkspace();
    editor.workspaceRepository.restoreOnStartup = true;
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: /Startup artwork/ })).toHaveCount(
    1,
  );
  expect(
    await page.evaluate(() => window.luma.editor.openDocuments.length),
  ).toBe(1);
  await page.evaluate(() => {
    window.luma.editor.workspaceRepository.restoreOnStartup = false;
  });
  await page.reload();
  await expect(page.getByRole("tab", { name: /Startup artwork/ })).toHaveCount(
    0,
  );
});

test("workspace saves publish in request order and aborted writes preserve the previous checkpoint", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Artwork" }));
    editor.document.name = "Older snapshot";
    const repository = editor.workspaceRepository;
    const save = repository.save.bind(repository);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    repository.save = async (value) => {
      if (++calls === 1) {
        entered();
        await gate;
      }
      await save(value);
    };
    const older = editor.saveWorkspace();
    await started;
    editor.document.name = "Newer snapshot";
    const newer = editor.saveWorkspace();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const overlappingWrites = calls > 1;
    release();
    await Promise.all([older, newer]);
    repository.save = save;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const request = put.apply(this, args);
      if (this.name === "workspaces") this.transaction.abort();
      return request;
    };
    editor.document.name = "Failed snapshot";
    let rejected = false;
    try {
      await editor.saveWorkspace();
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const restored = await editor.restoreWorkspace();
    const previous = restored[0].name;
    editor.document.name = "Retry succeeded";
    await editor.saveWorkspace();
    return {
      overlappingWrites,
      rejected,
      previous,
      savedAgain: !!(await repository.load()),
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.previous).toBe("Newer snapshot");
  expect(result.overlappingWrites).toBe(false);
  expect(result.savedAgain).toBe(true);
});

test("named workspace versions retain independent content across reload", async ({
  page,
}) => {
  await page.goto("/");
  const ids = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Artwork" }));
    editor.document.name = "First milestone";
    const first = await editor.saveWorkspaceVersion("Milestone");
    editor.document.name = "Second milestone";
    const second = await editor.saveWorkspaceVersion("Milestone");
    await editor.saveWorkspace();
    return { first, second };
  });
  expect(ids.first).not.toBe(ids.second);
  await page.reload();
  const result = await page.evaluate(async (ids) => {
    const editor = window.luma.editor;
    const versions = await editor.workspaceRepository.listVersions();
    const first = await editor.restoreWorkspace(ids.first);
    const second = await editor.restoreWorkspace(ids.second);
    return {
      count: versions.length,
      names: versions.map((version) => version.name),
      first: first[0].name,
      second: second[0].name,
    };
  }, ids);
  expect(result).toEqual({
    count: 2,
    names: ["Milestone", "Milestone"],
    first: "First milestone",
    second: "Second milestone",
  });
});

test("removing a named version preserves other versions and the startup checkpoint", async ({
  page,
}) => {
  await page.goto("/");
  const ids = await page.evaluate(async () => {
    const { editor, TextLayer } = window.luma;
    editor.document.layers.add(new TextLayer({ text: "Artwork" }));
    const first = await editor.saveWorkspaceVersion("Remove this");
    const second = await editor.saveWorkspaceVersion("Keep this");
    await editor.saveWorkspace();
    let rejected = false;
    try {
      await editor.workspaceRepository.removeVersion("current");
    } catch {
      rejected = true;
    }
    await editor.workspaceRepository.removeVersion(first);
    return { first, second, rejected };
  });
  expect(ids.rejected).toBe(true);
  await page.reload();
  const result = await page.evaluate(async (ids) => {
    const repository = window.luma.editor.workspaceRepository;
    return {
      versions: (await repository.listVersions()).map((version) => version.id),
      removed: await repository.load(ids.first),
      current: !!(await repository.load()),
    };
  }, ids);
  expect(result).toEqual({
    versions: [ids.second],
    removed: null,
    current: true,
  });
});
