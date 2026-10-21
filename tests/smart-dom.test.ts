import { expect, it } from "vitest";
import {
  Document,
  TextLayer,
  SmartObjectLayer,
  LayerGroup,
  RasterLayer,
} from "../src/dom";
import { validateDocument, referencedAssets } from "../src/core/model";
import { parseCommands } from "../src/core/validation";

it("defines, places, edits and undoes an embedded master through constructor APIs", () => {
  const document = new Document({ width: 64, height: 32 });
  const master = new Document({ name: "Label", width: 32, height: 32 });
  master.layers.add(new TextLayer({ text: "Original" }));
  const componentId = document.defineComponent(master);
  const first = document.placeSmartObject(componentId);
  const detached = new SmartObjectLayer({ componentId, width: 16, height: 32 });
  detached.width = 32;
  detached.x = 32;
  const second = document.layers.add(detached);
  expect(first).toBeInstanceOf(SmartObjectLayer);
  const before = document.toJSON();
  const history = document.getSnapshot().past.length;
  const edited = first.editContents();
  (edited.layers.at(0) as TextLayer).text = "Changed";
  expect(document.toJSON()).toEqual(before);
  first.replaceContents(edited);
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  expect((second.editContents().layers.at(0) as TextLayer).text).toBe(
    "Changed",
  );
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect((first.editContents().layers.at(0) as TextLayer).text).toBe("Changed");
  expect(
    Document.fromJSON(document.toJSON()).getLayer(first.id),
  ).toBeInstanceOf(SmartObjectLayer);
  expect(() => document.removeComponent(componentId)).toThrow("still placed");
});

it("locks protect all affected instances and missing references or cycles never commit", () => {
  const document = new Document();
  const master = new Document();
  const componentId = document.defineComponent(master);
  const group = document.layers.add(new LayerGroup());
  group.layers.add(
    new SmartObjectLayer({ componentId, width: 16, height: 16 }),
  );
  group.locked = true;
  const before = document.toJSON();
  master.name = "Changed";
  expect(() => document.defineComponent(master, { id: componentId })).toThrow(
    "locked",
  );
  expect(() =>
    document.layers.add(
      new SmartObjectLayer({ componentId: "missing", width: 16, height: 16 }),
    ),
  ).toThrow();
  expect(document.toJSON()).toEqual(before);
  expect(() =>
    parseCommands([{ type: "component.set", definition: { id: componentId } }]),
  ).toThrow();
  const invalid = structuredClone(before);
  invalid.schemaVersion = 9;
  expect(() => validateDocument(invalid)).toThrow("schema version 10");
});

it("collects unplaced embedded source assets for project portability", () => {
  const document = new Document();
  const master = new Document();
  master.layers.add(
    new RasterLayer({
      assetId: "original-pixels",
      width: 50_000,
      height: 1000,
    }),
  );
  const componentId = document.defineComponent(master);
  expect(referencedAssets(document.toJSON())).toEqual(
    new Set(["original-pixels"]),
  );
  document.removeComponent(componentId);
  expect(referencedAssets(document.toJSON()).size).toBe(0);
  document.undo();
  expect(referencedAssets(document.toJSON())).toEqual(
    new Set(["original-pixels"]),
  );
});

it("propagates nested master edits and rejects cycles or locked dependent instances atomically", () => {
  const document = new Document();
  const leaf = new Document({ name: "Leaf", width: 16, height: 16 });
  leaf.layers.add(new TextLayer({ text: "Original" }));
  const leafId = document.defineComponent(leaf);
  const parent = Document.fromJSON({
    ...new Document().toJSON(),
    components: document.toJSON().components,
  });
  parent.placeSmartObject(leafId);
  const parentId = document.defineComponent(parent);
  const instance = document.placeSmartObject(parentId);
  instance.locked = true;
  const before = document.toJSON();
  const revision = document.getSnapshot().revision;
  leaf.name = "Changed";
  expect(() => document.defineComponent(leaf, { id: leafId })).toThrow(
    "locked",
  );
  expect(document.toJSON()).toEqual(before);
  expect(document.getSnapshot().revision).toBe(revision);
  instance.locked = false;
  document.defineComponent(leaf, { id: leafId });
  expect(instance.editContents().getComponent(leafId).name).toBe("Changed");
  const cyclic = instance.editContents();
  cyclic.placeSmartObject(parentId);
  const stable = document.toJSON();
  expect(() => instance.replaceContents(cyclic)).toThrow(/Circular/i);
  expect(document.toJSON()).toEqual(stable);
});

it("converts a raster in place with tone edits, placement and original assets retained and one undo", () => {
  const document = new Document();
  const group = document.layers.add(new LayerGroup({ x: 50, y: 20 }));
  const first = group.layers.add(new TextLayer({ text: "Behind" }));
  const photo = group.layers.add(
    new RasterLayer({
      name: "Photo",
      assetId: "original",
      width: 15.5,
      height: 18.5,
      x: -2,
      opacity: 0.7,
    }),
  );
  document._dispatch({
    type: "effect.tone",
    id: photo.id,
    values: { contrast: 25 },
  });
  const last = group.layers.add(new TextLayer({ text: "Above" }));
  const before = document.toJSON();
  const history = document.getSnapshot().past.length;
  const smart = photo.convertToSmartObject();
  expect(smart).toBeInstanceOf(SmartObjectLayer);
  expect([...group.layers].map((layer) => layer.id)).toEqual([
    first.id,
    smart.id,
    last.id,
  ]);
  expect([smart.width, smart.height, smart.x, smart.opacity]).toEqual([
    15.5, 18.5, -2, 0.7,
  ]);
  expect(smart.editContents().toJSON().children[0]).toMatchObject({
    assetId: "original",
    effects: [{ contrast: 25 }],
  });
  expect(referencedAssets(document.toJSON())).toEqual(new Set(["original"]));
  expect(document.selectedLayer?.id).toBe(smart.id);
  expect(photo.isAttached).toBe(false);
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  const after = document.toJSON();
  document.undo();
  expect(document.toJSON()).toEqual(before);
  expect(photo.isAttached).toBe(true);
  document.redo();
  expect(document.toJSON()).toEqual(after);
  expect(smart.isAttached).toBe(true);
});

it("rejects raster conversion for locks, reused IDs and missing layers without adding masters", () => {
  const document = new Document();
  const group = document.layers.add(new LayerGroup());
  const photo = group.layers.add(
    new RasterLayer({ assetId: "source", width: 16, height: 16 }),
  );
  group.locked = true;
  const before = document.toJSON();
  expect(() => photo.convertToSmartObject()).toThrow("Unlock");
  expect(document.toJSON()).toEqual(before);
  group.locked = false;
  expect(() =>
    document._dispatch({
      type: "smartObject.convertRaster",
      id: photo.id,
      componentId: "master",
      instanceId: group.id,
    }),
  ).toThrow("already exists");
  expect(document.toJSON().components).toBeUndefined();
  const smart = photo.convertToSmartObject();
  expect(() => photo.convertToSmartObject()).toThrow();
  expect(() =>
    document._dispatch({
      type: "smartObject.convertRaster",
      id: smart.id,
      componentId: "another",
      instanceId: "other",
    }),
  ).toThrow("raster");
  expect(document.toJSON().components).toHaveLength(1);
});

it("copies nested masters independently, retaining internal sharing, source assets and one-step undo", () => {
  const document = new Document();
  const leaf = new Document({ name: "Leaf", width: 16, height: 16 });
  leaf.layers.add(
    new RasterLayer({ assetId: "original", width: 16, height: 16 }),
  );
  const leafId = document.defineComponent(leaf);
  document.defineComponent(new Document(), { id: "unrelated" });
  const parent = Document.fromJSON({
    ...new Document().toJSON(),
    components: document.toJSON().components,
  });
  parent.placeSmartObject(leafId);
  parent.placeSmartObject(leafId, { x: 16 });
  const parentId = document.defineComponent(parent);
  const original = document.placeSmartObject(parentId, { x: 10, y: 20 });
  const before = document.toJSON();
  const history = document.getSnapshot().past.length;
  const copy = original.duplicateIndependent();
  expect(copy.componentId).not.toBe(original.componentId);
  expect([copy.x, copy.y]).toEqual([34, 44]);
  expect(document.selectedLayer).toBe(copy);
  expect(document.toJSON().components).toHaveLength(5);
  const contents = copy.editContents();
  const children = [...contents.layers] as SmartObjectLayer[];
  expect(children[0].componentId).toBe(children[1].componentId);
  expect(children[0].componentId).not.toBe(leafId);
  expect(referencedAssets(document.toJSON())).toEqual(new Set(["original"]));
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  const copied = document.toJSON();
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect(document.toJSON()).toEqual(copied);
  const copiedLeaf = document.getComponent(children[0].componentId);
  copiedLeaf.layers.at(0)!.opacity = 0.5;
  document.defineComponent(copiedLeaf, { id: children[0].componentId });
  expect(document.getComponent(leafId).layers.at(0)!.opacity).toBe(1);
  expect(
    document.getComponent(children[0].componentId).layers.at(0)!.opacity,
  ).toBe(0.5);
  const shared = original.duplicate() as SmartObjectLayer;
  expect(shared.componentId).toBe(original.componentId);
});

it("rejects incomplete, colliding or locked independent copies without changing the document", () => {
  const document = new Document();
  const componentId = document.defineComponent(new Document());
  const instance = document.placeSmartObject(componentId);
  for (const componentIds of [
    {},
    { [componentId]: componentId },
    { [componentId]: "new", extra: "other" },
  ]) {
    const before = document.toJSON();
    expect(() =>
      document._dispatch({
        type: "smartObject.duplicateIndependent",
        id: instance.id,
        instanceId: "copy",
        componentIds,
      }),
    ).toThrow();
    expect(document.toJSON()).toEqual(before);
  }
  instance.locked = true;
  const before = document.toJSON();
  expect(() => instance.duplicateIndependent()).toThrow("Unlock");
  expect(document.toJSON()).toEqual(before);
});

it("registry replacement validates the complete graph and preserves locked placed masters", () => {
  const document = new Document();
  const master = new Document();
  const componentId = document.defineComponent(master);
  const instance = document.placeSmartObject(componentId);
  const before = document.toJSON();
  expect(() =>
    document._dispatch({ type: "component.replaceAll", definitions: [] }),
  ).toThrow();
  expect(document.toJSON()).toEqual(before);
  instance.locked = true;
  const definitions = document.toJSON().components!;
  definitions[0].name = "Changed";
  const locked = document.toJSON();
  expect(() =>
    document._dispatch({ type: "component.replaceAll", definitions }),
  ).toThrow("locked");
  expect(document.toJSON()).toEqual(locked);
  expect(
    parseCommands([
      { type: "component.replaceAll", definitions: locked.components! },
    ]),
  ).toHaveLength(1);
});

it("stores independent constructor filter stacks with atomic undo, strict validation and schema migration", async () => {
  const { GaussianBlurFilter, UnsharpMaskFilter, SmartToneFilter } =
    await import("../src/dom");
  const document = new Document();
  const componentId = document.defineComponent(new Document());
  const first = document.placeSmartObject(componentId),
    second = document.placeSmartObject(componentId);
  const master = document.getComponent(componentId).toJSON();
  const blur = new GaussianBlurFilter({ sigma: 2 }),
    sharpen = new UnsharpMaskFilter({ amount: 1.5 }),
    tone = new SmartToneFilter({ exposure: 1 });
  const before = document.toJSON(),
    history = document.getSnapshot().past.length;
  first.setFilters([blur, sharpen, tone]);
  expect(first.smartFilters.map((filter) => filter.kind)).toEqual([
    "gaussian-blur",
    "unsharp-mask",
    "tone",
  ]);
  expect(second.smartFilters).toEqual([]);
  expect(document.getComponent(componentId).toJSON()).toEqual(master);
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  const detached = first.smartFilters;
  detached.splice(0);
  expect(first.smartFilters).toHaveLength(3);
  const stable = document.toJSON();
  expect(() => first.addFilter(blur)).toThrow(/unique/);
  expect(() => new GaussianBlurFilter({ sigma: -1 })).toThrow();
  expect(() =>
    parseCommands([
      {
        type: "smartObject.filters",
        id: first.id,
        filters: [{ ...blur.toJSON(), extra: true }],
      },
    ]),
  ).toThrow();
  expect(document.toJSON()).toEqual(stable);
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect(document.toJSON()).toEqual(stable);
  const legacy = structuredClone(stable);
  legacy.schemaVersion = 10;
  expect(() => validateDocument(legacy)).toThrow(/schema version 11/);
  delete (legacy.children[0] as any).smartFilters;
  expect(Document.fromJSON(legacy).toJSON().schemaVersion).toBe(39);
  const restored = Document.fromJSON(stable).getLayer(
    first.id,
  ) as SmartObjectLayer;
  expect(restored.smartFilters).toEqual(first.smartFilters);
  first.locked = true;
  expect(() => first.setFilters([])).toThrow(/Unlock/);
});

it("retains nested master filters and rejects invalid filters inside component definitions", async () => {
  const { GaussianBlurFilter } = await import("../src/dom");
  const document = new Document(),
    componentId = document.defineComponent(new Document());
  const parent = Document.fromJSON(document.toJSON());
  parent
    .placeSmartObject(componentId)
    .addFilter(new GaussianBlurFilter({ sigma: 3 }));
  const parentId = document.defineComponent(parent);
  const instance = document.placeSmartObject(parentId);
  expect(
    (instance.editContents().layers.at(0) as SmartObjectLayer).smartFilters[0],
  ).toMatchObject({ kind: "gaussian-blur", sigma: 3 });
  const invalid = document.toJSON();
  const source = invalid.components!.find(
    (component) => component.id === parentId,
  )!.source;
  if (source.kind !== "document") throw new Error("Expected document master");
  (source.document.children[0] as any).smartFilters[0].sigma = -1;
  expect(() => Document.fromJSON(invalid)).toThrow();
});

it("filtered instances retain component expansion budgets instead of hiding nested work", async () => {
  const { GaussianBlurFilter } = await import("../src/dom");
  const { resolveSmartDocument } = await import("../src/core/smart/resolve");
  const { ComponentRegistry } = await import("../src/core/smart/manager");
  const document = new Document(),
    master = new Document();
  master.layers.add(new TextLayer({ text: "First" }));
  master.layers.add(new TextLayer({ text: "Second" }));
  document
    .placeSmartObject(document.defineComponent(master))
    .addFilter(new GaussianBlurFilter());
  const data = document.toJSON(),
    registry = new ComponentRegistry(data.components);
  expect(() => resolveSmartDocument(data, registry)).toThrow(/native-plane/);
  expect(() =>
    resolveSmartDocument(data, registry, {
      preserveFiltered: true,
      maxNodes: 2,
    }),
  ).toThrow(/budget/);
  expect(
    resolveSmartDocument(data, registry, { preserveFiltered: true }).children[0]
      .kind,
  ).toBe("smart-object");
});

it("smart-filter masks share constructor validation, locks, undo, asset tracking and schema migration", async () => {
  const { LayerMask } = await import("../src/dom");
  const document = new Document(),
    key = document.defineComponent(new Document());
  const layer = document.placeSmartObject(key);
  const before = document.toJSON();
  layer.filterMask = LayerMask.fromBitmap("filter-bitmap", { density: 0.4 });
  expect(referencedAssets(document.toJSON()).has("filter-bitmap")).toBe(true);
  expect(layer.filterMask!.density).toBe(0.4);
  const saved = document.toJSON();
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  expect(document.toJSON()).toEqual(saved);
  expect(
    (
      Document.fromJSON(saved).getLayer(layer.id) as SmartObjectLayer
    ).filterMask!.toJSON(),
  ).toEqual(layer.filterMask!.toJSON());
  const legacy = structuredClone(saved);
  legacy.schemaVersion = 11;
  expect(() => validateDocument(legacy)).toThrow("schema version 12");
  delete (legacy.children[0] as any).filterMask;
  expect(Document.fromJSON(legacy).toJSON().schemaVersion).toBe(39);
  const command = parseCommands([
    {
      type: "smartObject.filterMask",
      id: layer.id,
      mask: new LayerMask({ base: 0 }).toJSON(),
    },
  ])[0];
  document._dispatch(command);
  expect(layer.filterMask!.toJSON()).toMatchObject({ kind: "paint", base: 0 });
  expect(() =>
    parseCommands([
      {
        type: "smartObject.filterMask",
        id: layer.id,
        mask: { ...layer.filterMask!.toJSON(), density: 2 },
      },
    ]),
  ).toThrow();
  layer.locked = true;
  expect(() => {
    layer.filterMask = null;
  }).toThrow("Unlock");
});

it("collects and validates bitmap filter masks inside nested document masters", async () => {
  const { LayerMask } = await import("../src/dom");
  const document = new Document();
  const key = document.defineComponent(new Document());
  const master = Document.fromJSON(document.toJSON());
  const child = master.placeSmartObject(key);
  child.filterMask = LayerMask.fromBitmap("nested-filter");
  document.defineComponent(master, { id: "parent-mask" });
  expect(referencedAssets(document.toJSON()).has("nested-filter")).toBe(true);
  const bad = document.toJSON();
  const source = bad.components!.find(
    (item) => item.id === "parent-mask",
  )!.source;
  if (source.kind !== "document") throw new Error("Expected document");
  (source.document.children[0] as any).filterMask.density = 9;
  expect(() => validateDocument(bad)).toThrow();
});

it("filter-mask linking preserves affine world geometry and uses native master scale", async () => {
  const { LayerMask, AffineTransform } = await import("../src/dom");
  const { layerTransform } = await import("../src/core/spatial");
  const { maskTransform } = await import("../src/core/masks");
  const document = new Document(),
    key = document.defineComponent(new Document({ width: 40, height: 20 }));
  const group = document.layers.add(new LayerGroup({ x: 30, y: 12 }));
  group.transform = new AffineTransform(1, 0.2, 0.1, 1, 0, 0);
  const layer = group.layers.add(
    new SmartObjectLayer({
      componentId: key,
      width: 80,
      height: 60,
      x: 7,
      y: 9,
    }),
  );
  layer.transform = AffineTransform.rotation(0.4);
  layer.filterMask = new LayerMask({
    base: 0.5,
    x: 3,
    y: 4,
    feather: 2.5,
    basis: AffineTransform.scale(0.8, 1.2),
  });
  const world = () =>
    maskTransform(
      layer.filterMask!.toJSON(),
      layerTransform(document.toJSON(), layer.id)!.multiply(
        AffineTransform.scale(2, 3),
      ),
    );
  const original = world(),
    before = document.toJSON(),
    history = document.getSnapshot().past.length;
  layer.setFilterMaskLinked(false);
  for (const [key, value] of Object.entries(original.toJSON()))
    expect(
      world().toJSON()[key as keyof ReturnType<typeof original.toJSON>],
    ).toBeCloseTo(value, 10);
  expect(layer.filterMask!.linked).toBe(false);
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  layer.setFilterMaskLinked(false);
  expect(document.getSnapshot().past).toHaveLength(history + 1);
  document.undo();
  expect(document.toJSON()).toEqual(before);
  document.redo();
  layer.setFilterMaskLinked(true);
  for (const [key, value] of Object.entries(original.toJSON()))
    expect(
      world().toJSON()[key as keyof ReturnType<typeof original.toJSON>],
    ).toBeCloseTo(value, 10);
  expect(layer.filterMask!.feather).toBe(2.5);
  group.locked = true;
  expect(() => layer.setFilterMaskLinked(false)).toThrow("Unlock");
  expect(() => layer.setFilterMaskLinked("yes" as unknown as boolean)).toThrow(
    "boolean",
  );
  const empty = new SmartObjectLayer({
    componentId: key,
    width: 40,
    height: 20,
  });
  expect(() => empty.setFilterMaskLinked(false)).toThrow();
});

it("converts contiguous siblings in stack order with editable contents and one undo", () => {
  const doc = new Document({ width: 100, height: 80 });
  const group = doc.layers.add(new LayerGroup({ name: "Parent", x: 10, y: 5 }));
  const a = group.layers.add(new TextLayer({ name: "A", text: "A", x: -30 }));
  const b = group.layers.add(new TextLayer({ name: "B", text: "B", x: 50 }));
  const before = doc.toJSON(),
    history = doc.getSnapshot().past.length;
  const smart = doc.createSmartObject([b, a]);
  expect(group.layers.length).toBe(1);
  expect(
    smart
      .editContents()
      .toJSON()
      .children.map((layer) => layer.name),
  ).toEqual(["A", "B"]);
  expect(doc.getSnapshot().past.length).toBe(history + 1);
  expect(smart.x).toBeLessThan(-30);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  expect(doc.getLayer(smart.id)).toBeInstanceOf(SmartObjectLayer);
  const command = {
    type: "smartObject.convertLayers",
    ids: [smart.id],
    componentId: "nested",
    instanceId: "instance",
  };
  expect(parseCommands([command])).toEqual([command]);
});

it("rejects ambiguous conversion placement and invalid ownership without partial mutation", () => {
  const doc = new Document();
  const a = doc.layers.add(new TextLayer({ text: "A" }));
  const b = doc.layers.add(new TextLayer({ text: "B" }));
  const c = doc.layers.add(new TextLayer({ text: "C" }));
  const group = doc.layers.add(new LayerGroup());
  const child = group.layers.add(new TextLayer({ text: "Child" }));
  for (const selection of [
    [],
    [a, a],
    [a, c],
    [a, child],
    [new TextLayer({ text: "Detached" })],
  ]) {
    const before = doc.toJSON(),
      revision = doc.getSnapshot().revision;
    expect(() => doc.createSmartObject(selection)).toThrow();
    expect(doc.toJSON()).toEqual(before);
    expect(doc.getSnapshot().revision).toBe(revision);
  }
  b.locked = true;
  const before = doc.toJSON();
  expect(() => doc.createSmartObject([a, b])).toThrow(/Unlock/);
  expect(doc.toJSON()).toEqual(before);
});

it("raster replacement preserves its sibling slot and rejects incompatible or reused identities", () => {
  const doc = new Document(),
    master = new Document({ width: 16, height: 16 });
  master.layers.add(new TextLayer({ text: "Master" }));
  const smart = doc.placeSmartObject(doc.defineComponent(master));
  const after = doc.layers.add(new TextLayer({ text: "After" }));
  const raster = new RasterLayer({
    assetId: "prepared",
    width: 16,
    height: 16,
  }).toJSON();
  if (raster.kind !== "raster") throw new Error("Expected raster data.");
  const command = {
    type: "smartObject.convertToRaster" as const,
    id: smart.id,
    layer: raster,
  };
  expect(parseCommands([command])).toEqual([command]);
  const before = doc.toJSON();
  doc._dispatch(command);
  expect(doc.toJSON().children.map((layer) => layer.id)).toEqual([
    raster.id,
    after.id,
  ]);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  expect(() =>
    doc._dispatch({ ...command, layer: { ...raster, id: after.id } }),
  ).toThrow(/already exists/);
  expect(() =>
    parseCommands([{ ...command, layer: after.toJSON() }]),
  ).toThrow();
  smart.locked = true;
  expect(() => doc._dispatch(command)).toThrow(/Unlock/);
});

it("persists linked source fingerprints, embeds with undo, and rejects legacy or malformed links", () => {
  const doc = new Document();
  const source = {
    kind: "asset" as const,
    assetId: "snapshot",
    width: 16,
    height: 16,
    link: {
      kind: "local-file" as const,
      name: "art.png",
      sha256: "a".repeat(64),
      byteLength: 123,
      lastModified: 42,
    },
  };
  const command = {
    type: "component.set" as const,
    definition: { id: "linked", name: "Linked", source },
  };
  doc._dispatch(command);
  const instance = doc.placeSmartObject("linked");
  expect(instance.linkedSource).toEqual(source.link);
  const copy = instance.linkedSource!;
  copy.name = "mutated";
  expect(instance.linkedSource!.name).toBe("art.png");
  const before = doc.toJSON();
  instance.embedSource();
  expect(instance.linkedSource).toBeNull();
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  expect(Document.fromJSON(before).toJSON()).toEqual(before);
  expect(() => Document.fromJSON({ ...before, schemaVersion: 12 })).toThrow(
    /schema version 13/,
  );
  expect(() =>
    parseCommands([
      {
        ...command,
        definition: {
          ...command.definition,
          source: { ...source, link: { ...source.link, sha256: "invalid" } },
        },
      },
    ]),
  ).toThrow();
  instance.locked = true;
  expect(() => instance.embedSource()).toThrow(/locked/);
});
