import { expect, it } from "vitest";
import { Document, RasterLayer, LayerGroup, AffineTransform } from "../src/dom";
import { hitTest, layerBounds, layerTransform } from "../src/core/spatial";

it("persists an invertible layer matrix with translation aliases and undo", () => {
  const doc = new Document();
  const layer = doc.layers.add(
    new RasterLayer({ assetId: "source", width: 4, height: 2 }),
  );
  layer.transform = new AffineTransform(0, 1, -1, 0, 8, 0);
  expect(layer.x).toBe(8);
  expect(layerBounds(doc.toJSON(), layer.id)).toEqual({
    x: 6,
    y: 0,
    width: 2,
    height: 4,
  });
  expect(hitTest(doc.toJSON(), 7, 1)).toBe(layer.id);
  expect(hitTest(doc.toJSON(), 1, 1)).toBeNull();
  expect(
    Document.fromJSON(doc.toJSON()).getLayer(layer.id)!.transform.toJSON(),
  ).toEqual(layer.transform.toJSON());
  expect(() => {
    layer.transform = new AffineTransform(0, 0, 0, 0);
  }).toThrow();
  doc.undo();
  expect(layer.transform.toJSON()).toEqual(new AffineTransform().toJSON());
  doc.redo();
  expect(layer.x).toBe(8);
  const legacy = doc.toJSON();
  legacy.schemaVersion = 5;
  expect(() => Document.fromJSON(legacy)).toThrow(/schema version 6/);
});

it("preserves world matrices when placing artwork between transformed groups", () => {
  const doc = new Document();
  const a = doc.layers.add(new LayerGroup({ name: "A" }));
  const b = doc.layers.add(new LayerGroup({ name: "B" }));
  a.transform = new AffineTransform(0, 2, -3, 0, 100, 200);
  b.transform = new AffineTransform(1, 0.5, 0.25, 1, -40, 20);
  const layer = a.layers.add(
    new RasterLayer({ assetId: "pixels", width: 20, height: 10 }),
  );
  layer.transform = new AffineTransform(2, 0, 0, -1, 4, 6);
  const expected = layerTransform(doc.toJSON(), layer.id)!;
  layer.moveTo(b, { preservePosition: true });
  const check = () => {
    const actual = layerTransform(doc.toJSON(), layer.id)!;
    for (const point of [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 2, y: 7 },
    ]) {
      expect(actual.point(point).x).toBeCloseTo(expected.point(point).x, 10);
      expect(actual.point(point).y).toBeCloseTo(expected.point(point).y, 10);
    }
  };
  check();
  doc.undo();
  check();
  doc.redo();
  check();
  layer.moveTo(doc, { preservePosition: true });
  check();
});

it("translates and aligns selected layers in canvas coordinates under transformed parents", () => {
  const doc = new Document();
  const group = doc.layers.add(new LayerGroup());
  group.transform = new AffineTransform(0, 2, -2, 0, 100, 50);
  const child = group.layers.add(
    new RasterLayer({ assetId: "a", width: 10, height: 5 }),
  );
  const root = doc.layers.add(
    new RasterLayer({ assetId: "b", width: 10, height: 10, x: 150, y: 100 }),
  );
  doc.selectLayers([child, root]);
  const before = [child, root].map((layer) =>
    layerBounds(doc.toJSON(), layer.id)!,
  );
  doc.layerSelection.translate(12, -8);
  for (const [index, layer] of [child, root].entries()) {
    const after = layerBounds(doc.toJSON(), layer.id)!;
    expect(after.x).toBeCloseTo(before[index].x + 12);
    expect(after.y).toBeCloseTo(before[index].y - 8);
  }
  doc.layerSelection.align("left");
  expect(layerBounds(doc.toJSON(), child.id)!.x).toBeCloseTo(
    layerBounds(doc.toJSON(), root.id)!.x,
  );
  doc.undo();
  doc.undo();
  expect(layerBounds(doc.toJSON(), child.id)).toEqual(before[0]);
});

it("validates mask bases and preserves them across immutable edits and document round trips", async () => {
  const { LayerMask } = await import("../src/dom");
  const doc = new Document();
  const layer = doc.layers.add(
    new RasterLayer({ assetId: "pixels", width: 10, height: 10 }),
  );
  const basis = new AffineTransform(1, 0.5, -0.25, 2, 0, 0);
  layer.mask = new LayerMask({ base: 1, basis }).with({ density: 0.5 });
  expect(layer.mask!.basis.toJSON()).toEqual(basis.toJSON());
  expect(
    Document.fromJSON(doc.toJSON()).getLayer(layer.id)!.mask!.basis.toJSON(),
  ).toEqual(basis.toJSON());
  expect(
    () =>
      new LayerMask({ base: 1, basis: new AffineTransform(0, 0, 0, 0, 0, 0) }),
  ).toThrow();
  expect(
    () => new LayerMask({ base: 1, basis: AffineTransform.translation(1, 2) }),
  ).toThrow(/translation/);
  const legacy = doc.toJSON();
  legacy.schemaVersion = 5;
  expect(() => Document.fromJSON(legacy)).toThrow(
    /Mask bases require schema version 6/,
  );
});
