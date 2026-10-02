import { expect, it, vi } from "vitest";
import { EditorApplication } from "../src/editor";
import { RasterLayer, TextLayer } from "../src/dom";
if (typeof Worker === "undefined")
  globalThis.Worker = class {
    postMessage() {}
    addEventListener() {}
    removeEventListener() {}
    terminate() {}
  } as unknown as typeof Worker;

it("retains independent history, selection, assets and recovery when switching documents", async () => {
  const editor = new EditorApplication();
  const a = editor.newDocument({ name: "A" });
  const closed = vi.fn();
  const assets = editor.assetStore;
  assets.install(
    {
      id: "source",
      name: "source",
      width: 1,
      height: 1,
      blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
      thumbnail: "",
      bitmap: { width: 1, height: 1, close: closed } as unknown as ImageBitmap,
    },
    false,
  );
  const layer = a.layers.add(
    new RasterLayer({ assetId: "source", width: 1, height: 1 }),
  );
  a.selectedLayer = layer;
  const recoveryA = editor.recoverySessionId;
  const b = editor.newDocument({ name: "B" });
  b.layers.add(new TextLayer({ text: "Independent" }));
  expect(editor.openDocuments).toEqual([a, b]);
  expect(editor.recoverySessionId).not.toBe(recoveryA);
  expect(editor.assetStore.has("source")).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  editor.activateDocument(a);
  expect(editor.assetStore).toBe(assets);
  expect(a.selectedLayer).toBe(layer);
  a.undo();
  expect(a.layers.length).toBe(0);
  expect(b.layers.length).toBe(1);
  a.redo();
  expect(a.layers.length).toBe(1);
  expect(await editor.closeDocument(a)).toBe(false);
  expect(await editor.closeDocument(a, { discardChanges: true })).toBe(true);
  expect(editor.document).toBe(b);
  expect(closed).toHaveBeenCalledTimes(1);
  editor.dispose();
});

it("tracks saved revisions per session and never marks intervening edits saved", async () => {
  const editor = new EditorApplication();
  const a = editor.newDocument({ name: "A" });
  a.layers.add(new TextLayer({ text: "A" }));
  const saving = editor.saveProject();
  a.name = "Newer edit";
  await saving;
  expect(editor.hasUnsavedDocuments).toBe(true);
  await editor.saveProject();
  expect(editor.hasUnsavedDocuments).toBe(false);
  const b = editor.newDocument({ name: "B" });
  b.name = "Unsaved B";
  editor.activateDocument(a);
  expect(editor.hasUnsavedDocuments).toBe(true);
  expect(editor.documentSessions.find((s) => s.document === a)?.dirty).toBe(
    false,
  );
  expect(await editor.closeDocument(a)).toBe(true);
  expect(editor.document).toBe(b);
  editor.dispose();
});

it("opens detached smart-object contents and explicitly applies them with parent undo and conflict protection", async () => {
  const { Document, SmartObjectLayer } = await import("../src/dom");
  const editor = new EditorApplication();
  try {
    const owner = editor.newDocument({ name: "Composition" });
    const master = new Document({ name: "Master", width: 32, height: 32 });
    master.layers.add(new TextLayer({ text: "Before" }));
    const componentId = owner.defineComponent(master);
    const instance = owner.placeSmartObject(componentId);
    owner.placeSmartObject(componentId, { x: 32 });
    const before = owner.toJSON();
    const history = owner.getSnapshot().past.length;
    const contents = await editor.editSmartObject(instance);
    expect(contents).not.toBe(owner);
    expect(contents.assetStore).not.toBe(owner.assetStore);
    expect(await editor.editSmartObject(instance)).toBe(contents);
    (contents.layers.at(0) as TextLayer).text = "After";
    expect(owner.toJSON()).toEqual(before);
    await editor.applySmartObjectContents(contents);
    expect((instance.editContents().layers.at(0) as TextLayer).text).toBe(
      "After",
    );
    expect(owner.getSnapshot().past).toHaveLength(history + 1);
    expect(editor.getSnapshot().smartObjectEdit?.changed).toBe(false);
    owner.undo();
    expect(owner.toJSON()).toEqual(before);
    (contents.layers.at(0) as TextLayer).text = "Unapplied";
    await expect(editor.applySmartObjectContents(contents)).rejects.toThrow(
      "Source document changed",
    );
    expect(owner.toJSON()).toEqual(before);
    await editor.saveProject();
    expect(await editor.closeDocument(contents)).toBe(false); // Download is not application to the master.
    editor.detachSmartObjectContents(contents);
    expect(editor.getSnapshot().smartObjectEdit).toBeUndefined();
    expect((contents.layers.at(0) as TextLayer).text).toBe("Unapplied");
    editor.activateDocument(owner);
    const reopened = await editor.editSmartObject(
      owner.layers.at(0) as InstanceType<typeof SmartObjectLayer>,
    );
    expect(reopened).not.toBe(contents);
    expect((reopened.layers.at(0) as TextLayer).text).toBe("Before");
  } finally {
    editor.dispose();
  }
});

it("nested contents edits apply atomically and closed owners cannot receive contents", async () => {
  const { Document } = await import("../src/dom");
  const editor = new EditorApplication();
  try {
    const owner = editor.newDocument();
    const leaf = new Document();
    leaf.layers.add(new TextLayer({ text: "Leaf" }));
    const leafId = owner.defineComponent(leaf);
    const parent = new Document();
    parent.defineComponent(leaf, { id: leafId });
    parent.placeSmartObject(leafId);
    const parentId = owner.defineComponent(parent);
    const instance = owner.placeSmartObject(parentId);
    const contents = await editor.editSmartObject(instance);
    const changed = contents.getComponent(leafId);
    (changed.layers.at(0) as TextLayer).text = "Nested";
    contents.defineComponent(changed, { id: leafId });
    await editor.applySmartObjectContents(contents);
    expect((owner.getComponent(leafId).layers.at(0) as TextLayer).text).toBe(
      "Nested",
    );
    await editor.closeDocument(owner, { discardChanges: true });
    contents.name = "Retained";
    await expect(editor.applySmartObjectContents(contents)).rejects.toThrow();
    expect(editor.getSnapshot().smartObjectEdit?.ownerOpen).toBe(false);
    expect(contents.name).toBe("Retained");
    editor.detachSmartObjectContents(contents);
    expect(editor.openDocuments).toContain(contents);
  } finally {
    editor.dispose();
  }
});

it("opening contents rejects intervening owner edits without installing a new tab", async () => {
  const { Document } = await import("../src/dom");
  const editor = new EditorApplication();
  try {
    const owner = editor.newDocument();
    const instance = owner.placeSmartObject(
      owner.defineComponent(new Document()),
    );
    const opening = editor.editSmartObject(instance);
    owner.name = "Newer owner";
    await expect(opening).rejects.toThrow("Source document changed");
    expect(editor.openDocuments).toEqual([owner]);
    expect(editor.document).toBe(owner);
  } finally {
    editor.dispose();
  }
});

it("copies shared nested smart objects as one independent graph and preserves destination definitions", async () => {
  const { Document, SmartObjectLayer } = await import("../src/dom");
  const editor = new EditorApplication();
  try {
    const target = editor.document;
    target.name = "Target";
    target.defineComponent(new Document(), { id: "existing" });
    const before = target.toJSON();
    const source = editor.newDocument();
    const leaf = new Document();
    leaf.layers.add(new TextLayer({ text: "Original" }));
    const leafId = source.defineComponent(leaf);
    const parent = new Document();
    parent.defineComponent(leaf, { id: leafId });
    parent.placeSmartObject(leafId);
    const parentId = source.defineComponent(parent);
    source.defineComponent(new Document(), { id: "unused" });
    const first = source.placeSmartObject(parentId),
      second = source.placeSmartObject(parentId, { x: 20 });
    source.selectLayers([first, second]);
    const history = target.getSnapshot().past.length;
    const copies = (await editor.copySelectedLayersTo(target)) as InstanceType<
      typeof SmartObjectLayer
    >[];
    expect(copies[0].componentId).toBe(copies[1].componentId);
    expect(copies[0].componentId).not.toBe(parentId);
    expect(target.toJSON().components).toHaveLength(3); // Existing plus just parent and leaf.
    expect(target.getComponent("existing")).toBeInstanceOf(Document);
    const copiedLeaf = (
      copies[0].editContents().layers.at(0) as InstanceType<
        typeof SmartObjectLayer
      >
    ).componentId;
    expect(copiedLeaf).not.toBe(leafId);
    expect(target.getSnapshot().past).toHaveLength(history + 1);
    const after = target.toJSON();
    target.undo();
    expect(target.toJSON()).toEqual(before);
    target.redo();
    expect(target.toJSON()).toEqual(after);
    const changed = target.getComponent(copiedLeaf);
    (changed.layers.at(0) as TextLayer).text = "Copy only";
    target.defineComponent(changed, { id: copiedLeaf });
    expect((source.getComponent(leafId).layers.at(0) as TextLayer).text).toBe(
      "Original",
    );
    await editor.closeDocument(source, { discardChanges: true });
    expect(
      (target.getComponent(copiedLeaf).layers.at(0) as TextLayer).text,
    ).toBe("Copy only");
  } finally {
    editor.dispose();
  }
});

it("does not copy unrelated component definitions or request their images for ordinary artwork", async () => {
  const { Document } = await import("../src/dom");
  const editor = new EditorApplication();
  try {
    const target = editor.document;
    target.name = "Target";
    target.layers.add(new TextLayer({ text: "Existing" }));
    const source = editor.newDocument();
    const unused = new Document();
    unused.layers.add(
      new RasterLayer({ assetId: "not-loaded", width: 16, height: 16 }),
    );
    source.defineComponent(unused);
    source.selectedLayer = source.layers.add(new TextLayer({ text: "Copied" }));
    const copies = await editor.copySelectedLayersTo(target);
    expect((copies[0] as TextLayer).text).toBe("Copied");
    expect(target.toJSON().components).toBeUndefined();
    expect(target.assetStore!.values()).toHaveLength(0);
  } finally {
    editor.dispose();
  }
});
