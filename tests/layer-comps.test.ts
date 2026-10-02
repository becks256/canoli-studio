import { expect, it } from "vitest";
import { Document, TextLayer, LayerGroup } from "../src/dom";
import {
  captureLayerComp,
  planLayerComp,
  layerCompSchema,
} from "../src/core/layer-comps";

it("restores presentation in one transaction while preserving edited contents and undo", () => {
  const doc = new Document();
  const layer = doc.layers.add(new TextLayer({ text: "Original", x: 4 }));
  const comp = captureLayerComp(doc.toJSON(), "Layout");
  layer.x = 40;
  layer.visible = false;
  layer.opacity = 0.3;
  layer.text = "Revised";
  const before = doc.toJSON(),
    history = doc.getSnapshot().past.length;
  const restored = planLayerComp(
    doc.toJSON(),
    JSON.parse(JSON.stringify(comp)),
  );
  doc._dispatch(restored.command);
  expect(layer.x).toBe(4);
  expect(layer.visible).toBe(true);
  expect(layer.opacity).toBe(1);
  expect(layer.text).toBe("Revised");
  expect(restored.missingLayerIds).toEqual([]);
  expect(doc.getSnapshot().past.length).toBe(history + 1);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  expect(layer.x).toBe(4);
});

it("captures selected categories and rejects locked changes atomically", () => {
  const doc = new Document();
  const first = doc.layers.add(new TextLayer({ text: "A" }));
  const second = doc.layers.add(new TextLayer({ text: "B" }));
  const comp = captureLayerComp(doc.toJSON(), "Visibility", {
    visibility: true,
    position: false,
    appearance: false,
  });
  first.visible = false;
  first.x = 90;
  second.visible = false;
  second.locked = true;
  const before = doc.toJSON();
  expect(() => planLayerComp(doc.toJSON(), comp)).toThrow(/Unlock/);
  expect(doc.toJSON()).toEqual(before);
  second.locked = false;
  doc._dispatch(planLayerComp(doc.toJSON(), comp).command);
  expect(first.visible).toBe(true);
  expect(first.x).toBe(90);
  second.locked = true;
  expect(planLayerComp(doc.toJSON(), comp).command).toMatchObject({
    commands: [],
  });
});

it("reports removed targets, preserves new layers and rejects changed coordinate parents", () => {
  const doc = new Document();
  const child = doc.layers.add(new TextLayer({ text: "A" }));
  const comp = captureLayerComp(doc.toJSON(), "Layout");
  const group = doc.layers.add(new LayerGroup());
  const moved = doc.toJSON();
  const savedChild = moved.children.shift()!;
  (moved.children[0] as { children: typeof moved.children }).children.push(
    savedChild,
  );
  expect(() => planLayerComp(moved, comp)).toThrow(/changed parent/);
  const removed = doc.toJSON();
  removed.children = removed.children.filter((layer) => layer.id !== child.id);
  const result = planLayerComp(removed, comp);
  expect(result.missingLayerIds).toEqual([child.id]);
  expect(result.command).toMatchObject({ commands: [] });
  expect(removed.children[0].id).toBe(group.id);
  expect(() => planLayerComp(new Document().toJSON(), comp)).toThrow(
    /another document/,
  );
  expect(
    layerCompSchema.safeParse({
      ...comp,
      layers: [...comp.layers, ...comp.layers],
    }).success,
  ).toBe(false);
});

it("persists attached comps, supports recapture and rejects legacy or corrupt ownership", async () => {
  const { LayerComp } = await import("../src/dom");
  const { readProject, serializeProject } = await import("../src/core/project");
  const doc = new Document();
  const layer = doc.layers.add(new TextLayer({ text: "Keep", x: 5 }));
  const comp = doc.layerComps.add(new LayerComp({ name: "First" }));
  layer.x = 50;
  comp.recapture();
  comp.name = "Updated";
  layer.x = 80;
  const saved = await readProject(
    await serializeProject(doc.toJSON(), {
      get: () => {
        throw new Error("No assets");
      },
    }),
  );
  const reopened = Document.fromJSON(saved.document);
  expect(reopened.toJSON().schemaVersion).toBe(15);
  const restored = reopened.layerComps.at(0)!;
  expect(restored.name).toBe("Updated");
  restored.apply();
  expect(reopened.layers.at(0)!.x).toBe(50);
  reopened.undo();
  expect(reopened.layers.at(0)!.x).toBe(80);
  restored.remove();
  expect(reopened.layerComps.length).toBe(0);
  expect(() => restored.apply()).toThrow(/not attached/);
  reopened.undo();
  expect(restored.toJSON().id).toBe(comp.id);
  const legacy = { ...doc.toJSON(), schemaVersion: 13 };
  expect(() => Document.fromJSON(legacy)).toThrow(/schema version 14/);
  const corrupt = doc.toJSON();
  corrupt.layerComps![0].documentId = "foreign";
  expect(() => Document.fromJSON(corrupt)).toThrow(/ownership/);
});

it("rebases saved root positions through crop while retaining nested coordinates and undo", async () => {
  const { LayerComp } = await import("../src/dom");
  const doc = new Document({ width: 100, height: 100 });
  const group = doc.layers.add(new LayerGroup({ x: 20, y: 30 }));
  const child = group.layers.add(new TextLayer({ text: "A", x: 5, y: 6 }));
  const comp = doc.layerComps.add(new LayerComp({ name: "Original" }));
  group.x = 40;
  child.x = 15;
  const before = doc.toJSON();
  doc.crop({ x: 10, y: -5, width: 80, height: 90 });
  const cropped = doc.toJSON();
  expect(
    comp.toJSON().layers.map((layer) => [layer.position!.x, layer.position!.y]),
  ).toEqual([
    [10, 35],
    [5, 6],
  ]);
  comp.apply();
  expect(group.x).toBe(10);
  expect(group.y).toBe(35);
  expect(child.x).toBe(5);
  doc.undo();
  expect(doc.toJSON()).toEqual(cropped);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  comp.apply();
  expect(group.x).toBe(10);
});

it("rejects crop overflow in a saved comp without changing document or history", async () => {
  const { LayerComp } = await import("../src/dom");
  const doc = new Document();
  const layer = doc.layers.add(
    new TextLayer({ text: "A", x: Number.MAX_SAFE_INTEGER }),
  );
  doc.layerComps.add(new LayerComp({ name: "Far away" }));
  layer.x = 0;
  const before = doc.toJSON(),
    revision = doc.getSnapshot().revision;
  expect(() => doc.crop({ x: -2, y: 0, width: 100, height: 100 })).toThrow();
  expect(doc.toJSON()).toEqual(before);
  expect(doc.getSnapshot().revision).toBe(revision);
});

it("preserves saved comps when creating independent smart-object masters", async () => {
  const { LayerComp } = await import("../src/dom");
  const source = new Document();
  const text = source.layers.add(new TextLayer({ text: "A", x: 3 }));
  source.layerComps.add(new LayerComp({ name: "Original" }));
  text.x = 40;
  const doc = new Document();
  const instance = doc.placeSmartObject(doc.defineComponent(source));
  const independent = instance.duplicateIndependent();
  const master = doc.getComponent(independent.componentId);
  expect(master.layerComps.at(0)!.apply().missingLayerIds).toEqual([]);
  expect(master.layers.at(0)!.x).toBe(3);
  expect(doc.getComponent(instance.componentId).layers.at(0)!.x).toBe(40);
});
