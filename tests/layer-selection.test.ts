import { expect, it } from "vitest";
import { Document, LayerGroup, RasterLayer } from "../src/dom";
it("selects without history, excludes nested duplicates, and aligns in document space", () => {
  const doc = new Document();
  const group = new LayerGroup({ x: 100, y: 40 });
  const child = new RasterLayer({ assetId: "a", width: 10, height: 20, x: 5 });
  group.layers.add(child);
  doc.layers.add(group);
  const other = doc.layers.add(
    new RasterLayer({ assetId: "b", width: 20, height: 10, x: 200, y: 80 }),
  );
  const revision = doc.getSnapshot().revision;
  doc.selectLayers([group, child, other]);
  expect(doc.selectedLayer).toBe(other);
  expect(doc.getSnapshot().revision).toBe(revision);
  doc.layerSelection.translate(7, 3);
  expect([group.x, child.x, other.x]).toEqual([107, 5, 207]);
  expect(doc.getSnapshot().revision).toBe(revision + 1);
  doc.undo();
  expect(group.x).toBe(100);
  doc.selectLayers([child, other]);
  doc.layerSelection.align("left");
  expect(other.x).toBe(105);
  expect(child.x).toBe(5);
  doc.undo();
  expect(other.x).toBe(200);
  doc.redo();
  expect(other.x).toBe(105);
  doc.selectLayers([child], "remove");
  expect(doc.selectedLayers).toEqual([other]);
});
it("rejects foreign layers and rolls back multi-layer edits when any root is locked", () => {
  const doc = new Document();
  const otherDoc = new Document();
  const a = doc.layers.add(new LayerGroup({ x: 1 }));
  const b = doc.layers.add(new LayerGroup({ x: 20, locked: true }));
  doc.selectLayers([a, b]);
  const revision = doc.getSnapshot().revision;
  expect(() => doc.layerSelection.translate(10, 0)).toThrow("locked");
  expect(a.x).toBe(1);
  expect(doc.getSnapshot().revision).toBe(revision);
  const foreign = otherDoc.layers.add(new LayerGroup());
  expect(() => doc.selectLayers([foreign])).toThrow("belong");
  expect(doc.selectedLayers).toEqual([a, b]);
  b.locked = false;
  doc.layerSelection.remove();
  expect(doc.layers.length).toBe(0);
  expect(doc.selectedLayers).toEqual([]);
  doc.undo();
  expect(doc.layers.length).toBe(2);
  doc.selectedLayer = a;
  expect(doc.selectedLayers).toEqual([a]);
});

it("rotates selected roots around a shared center with one undo and no duplicate descendant transform", () => {
  const doc = new Document();
  const group = new LayerGroup();
  const child = new RasterLayer({ assetId: "a", width: 10, height: 10 });
  group.layers.add(child);
  doc.layers.add(group);
  const other = doc.layers.add(
    new RasterLayer({ assetId: "b", width: 10, height: 10, x: 20 }),
  );
  doc.selectLayers([group, child, other]);
  const before = doc.toJSON(),
    revision = doc.getSnapshot().revision;
  doc.layerSelection.rotate(90);
  expect(group.transform.point({ x: 5, y: 5 }).x).toBeCloseTo(15);
  expect(group.transform.point({ x: 5, y: 5 }).y).toBeCloseTo(-5);
  expect(other.transform.point({ x: 5, y: 5 }).y).toBeCloseTo(15);
  expect(child.transform.b).toBe(0);
  expect(doc.getSnapshot().revision).toBe(revision + 1);
  const after = doc.toJSON();
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  doc.redo();
  expect(doc.toJSON()).toEqual(after);
  other.locked = true;
  const locked = doc.toJSON();
  expect(() => doc.layerSelection.rotate(15)).toThrow("locked");
  expect(doc.toJSON()).toEqual(locked);
});

it("scales editable roots around the shared center without resizing source geometry", () => {
  const doc = new Document();
  const first = doc.layers.add(
    new RasterLayer({ assetId: "a", width: 10, height: 10 }),
  );
  const second = doc.layers.add(
    new RasterLayer({ assetId: "b", width: 10, height: 10, x: 20 }),
  );
  doc.selectLayers([first, second]);
  const before = doc.toJSON();
  doc.layerSelection.scale(2, 3);
  expect(first.transform.point({ x: 5, y: 5 })).toEqual({ x: -5, y: 5 });
  expect(second.transform.point({ x: 5, y: 5 })).toEqual({ x: 35, y: 5 });
  expect(first.width).toBe(10);
  expect(first.height).toBe(10);
  expect(first.transform.a).toBe(2);
  expect(first.transform.d).toBe(3);
  doc.undo();
  expect(doc.toJSON()).toEqual(before);
  for (const factor of [0, -1, NaN, Infinity])
    expect(() => doc.layerSelection.scale(factor)).toThrow("positive");
  expect(doc.toJSON()).toEqual(before);
});
