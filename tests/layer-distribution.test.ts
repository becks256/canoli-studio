import { expect, it } from "vitest";
import { Document, RasterLayer, LayerGroup, AffineTransform } from "../src/dom";
import { layerBounds } from "../src/core/spatial";
import { parseCommands } from "../src/core/validation";

function fixture() {
  const doc = new Document();
  const layers = [0, 30, 100].map((x, i) =>
    doc.layers.add(
      new RasterLayer({
        assetId: `image${i}`,
        x,
        y: x,
        width: 10 + i * 10,
        height: 10 + i * 10,
      }),
    ),
  );
  doc.selectLayers([...layers].reverse());
  return { doc, layers };
}
it("distributes unequal extents by gaps or centers without changing anchors or stacking", () => {
  for (const axis of ["horizontal", "vertical"] as const)
    for (const mode of ["gaps", "centers"] as const) {
      const { doc, layers } = fixture();
      const before = doc.toJSON(),
        history = doc.getSnapshot().past.length;
      doc.layerSelection.distribute(axis, mode);
      expect(
        layers.map((layer) => (axis === "horizontal" ? layer.x : layer.y)),
      ).toEqual([0, mode === "gaps" ? 45 : 50, 100]);
      expect(doc.toJSON().children.map((layer) => layer.id)).toEqual(
        before.children.map((layer) => layer.id),
      );
      expect(doc.getSnapshot().past.length).toBe(history + 1);
      doc.undo();
      expect(doc.toJSON()).toEqual(before);
      doc.redo();
      const revision = doc.getSnapshot().revision;
      doc.layerSelection.distribute(axis, mode);
      expect(doc.getSnapshot().revision).toBe(revision);
    }
});
it("moves in document space across transformed parents and rejects locked selections atomically", () => {
  const { doc, layers } = fixture();
  const parent = doc.layers.add(new LayerGroup());
  parent.transform = new AffineTransform(0, 2, -2, 0, 60, 10);
  const child = parent.layers.add(
    new RasterLayer({ assetId: "nested", x: 10, y: 5, width: 12, height: 18 }),
  );
  doc.selectLayers([layers[0], child, layers[2]]);
  const y = layerBounds(doc.toJSON(), child.id)!.y;
  doc.layerSelection.distribute("horizontal");
  const bounds = [layers[0], child, layers[2]].map((layer) =>
    layerBounds(doc.toJSON(), layer.id)!,
  );
  expect(bounds[1].x - bounds[0].x - bounds[0].width).toBeCloseTo(
    bounds[2].x - bounds[1].x - bounds[1].width,
  );
  expect(bounds[1].y).toBeCloseTo(y);
  parent.locked = true;
  const before = doc.toJSON();
  expect(() => doc.layerSelection.distribute("vertical")).toThrow(/locked/);
  expect(doc.toJSON()).toEqual(before);
});
it("validates counts and modes and does not move group descendants twice", () => {
  const { doc, layers } = fixture();
  const group = doc.layers.add(new LayerGroup({ x: 40 }));
  const child = group.layers.add(
    new RasterLayer({ assetId: "child", width: 10, height: 10, x: 5 }),
  );
  doc.selectLayers([layers[0], group, child, layers[2]]);
  doc.layerSelection.distribute("horizontal");
  expect(child.x).toBe(5);
  doc.selectLayers([group, child]);
  expect(() => doc.layerSelection.distribute("horizontal")).toThrow(/three/);
  expect(() =>
    parseCommands([
      {
        type: "layer.distribute",
        ids: layers.map((layer) => layer.id),
        axis: "diagonal",
        mode: "gaps",
      },
    ]),
  ).toThrow();
});
