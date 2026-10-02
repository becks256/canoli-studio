import { expect, it } from "vitest";
import { snapToCanvas } from "../src/core/snapping";
it("chooses the nearest canvas guide independently per axis and preserves unsnapped deltas", () => {
  expect(
    snapToCanvas(
      { x: 50, y: 50, width: 20, height: 20 },
      { x: 47, y: 0 },
      200,
      200,
      6,
    ),
  ).toEqual({ x: 50, y: 0, guides: { x: 100, y: undefined } });
  expect(
    snapToCanvas(
      { x: 50, y: 50, width: 20, height: 20 },
      { x: 38, y: 127 },
      200,
      200,
      6,
    ),
  ).toEqual({ x: 40, y: 130, guides: { x: 100, y: 200 } });
  expect(
    snapToCanvas(
      { x: 50, y: 50, width: 20, height: 20 },
      { x: 47, y: 0 },
      200,
      200,
      2,
    ).x,
  ).toBe(47);
});

it("snaps to artwork bounds and excludes moving subtrees, their ancestors and hidden artwork", async () => {
  const { Document, LayerGroup, RasterLayer } = await import("../src/dom");
  const { artworkSnapBounds } = await import("../src/core/snapping");
  const doc = new Document();
  const group = new LayerGroup();
  doc.layers.add(group);
  const moving = new RasterLayer({
    assetId: "a",
    width: 20,
    height: 20,
    x: 50,
    y: 50,
  });
  group.layers.add(moving);
  const target = new RasterLayer({
    assetId: "b",
    width: 20,
    height: 20,
    x: 123,
    y: 50,
  });
  group.layers.add(target);
  doc.layers.add(
    new RasterLayer({
      assetId: "c",
      width: 10,
      height: 10,
      x: 99,
      visible: false,
    }),
  );
  const targets = artworkSnapBounds(doc.toJSON(), [moving.id]);
  expect(targets).toHaveLength(1);
  expect(
    snapToCanvas(
      { x: 50, y: 50, width: 20, height: 20 },
      { x: 70, y: 0 },
      400,
      400,
      6,
      targets,
    ).x,
  ).toBe(73);
  expect(artworkSnapBounds(doc.toJSON(), [group.id])).toEqual([]);
});

it("snaps to authored guide coordinates only on their own axis", () => {
  const bounds = { x: 50, y: 50, width: 20, height: 20 };
  const result = snapToCanvas(
    bounds,
    { x: 70, y: 20 },
    400,
    300,
    6,
    [],
    [
      { id: "x", orientation: "vertical", position: 123.5 },
      { id: "y", orientation: "horizontal", position: 73 },
    ],
  );
  expect(result).toEqual({ x: 73.5, y: 23, guides: { x: 123.5, y: 73 } });
});
