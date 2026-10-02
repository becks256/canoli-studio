import { expect, it } from "vitest";
import { Document, LayerGroup, RasterLayer, AffineTransform } from "../src/dom";
import { layerTransform } from "../src/core/spatial";

it("reflects selected roots around their canvas-space center across parent transforms", () => {
  for (const axis of ["horizontal", "vertical"] as const) {
    const doc = new Document();
    const parent = doc.layers.add(new LayerGroup());
    parent.transform = new AffineTransform(0, 2, -2, 0, 100, 20);
    const child = parent.layers.add(
      new RasterLayer({ assetId: "a", width: 10, height: 20, x: 5, y: 6 }),
    );
    const other = doc.layers.add(
      new RasterLayer({ assetId: "b", width: 20, height: 10, x: 160, y: 60 }),
    );
    doc.selectLayers([other, child]);
    const before = doc.toJSON(),
      bounds = doc.layerSelection.bounds!;
    const center = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    const points = [child, other].map((layer) =>
      layerTransform(before, layer.id)!.point({ x: 3, y: 4 }),
    );
    const history = doc.getSnapshot().past.length;
    doc.layerSelection.flip(axis);
    [child, other].forEach((layer, index) => {
      const point = layerTransform(doc.toJSON(), layer.id)!.point({
        x: 3,
        y: 4,
      });
      expect(point.x).toBeCloseTo(
        axis === "horizontal"
          ? 2 * center.x - points[index].x
          : points[index].x,
      );
      expect(point.y).toBeCloseTo(
        axis === "vertical" ? 2 * center.y - points[index].y : points[index].y,
      );
    });
    expect(doc.getSnapshot().past.length).toBe(history + 1);
    expect(child.width).toBe(10);
    expect(child.assetId).toBe("a");
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    doc.redo();
    doc.layerSelection.flip(axis);
    const point = layerTransform(doc.toJSON(), child.id)!.point({ x: 3, y: 4 });
    expect(point.x).toBeCloseTo(points[0].x);
    expect(point.y).toBeCloseTo(points[0].y);
  }
});
it("does not double-flip group descendants and atomically rejects locked or empty selections", () => {
  const doc = new Document();
  const group = doc.layers.add(new LayerGroup());
  const child = group.layers.add(
    new RasterLayer({ assetId: "a", width: 10, height: 10, x: 4 }),
  );
  doc.selectLayers([group, child]);
  const local = child.toJSON();
  doc.layerSelection.flip("horizontal");
  expect(child.toJSON()).toEqual(local);
  group.locked = true;
  const before = doc.toJSON();
  expect(() => doc.layerSelection.flip("vertical")).toThrow(/locked/);
  expect(doc.toJSON()).toEqual(before);
  doc.layerSelection.clear();
  expect(() => doc.layerSelection.flip("horizontal")).toThrow(/Select/);
});
