import { expect, it } from "vitest";
import {
  Document,
  LayerGroup,
  LayerMask,
  MarqueeSelection,
  PaintLayer,
  RasterLayer,
  VectorPath,
} from "../src/dom";
import { parseCommands } from "../src/core/validation";

it("rebases nested artwork, selections and unlinked masks while preserving locked content", () => {
  const doc = new Document({ width: 10000, height: 5000 });
  const group = doc.layers.add(new LayerGroup({ x: 20, y: 30 }));
  const raster = group.layers.add(
    new RasterLayer({
      assetId: "original",
      width: 10000,
      height: 5000,
      x: 5,
      y: 7,
    }),
  );
  group.mask = new LayerMask({
    selection: new MarqueeSelection({
      shape: "rectangle",
      x: 0,
      y: 0,
      width: 500,
      height: 400,
    }),
    linked: false,
    x: 100,
    y: 200,
  });
  raster.mask = new LayerMask({
    paths: [
      new VectorPath({
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 0, y: 100 },
        ],
      }),
    ],
    x: 3,
    y: 4,
  });
  const paint = group.layers.add(new PaintLayer({ x: 13, y: 17 }));
  paint.mask = new LayerMask({ base: 1, linked: false, x: 70, y: 80 });
  doc.layers.add(new PaintLayer({ name: "Off canvas", x: 12000, y: 6000 }));
  doc.selection = new MarqueeSelection({
    shape: "rectangle",
    x: 40,
    y: 50,
    width: 200,
    height: 100,
  });
  group.locked = true;
  doc.selectedLayer = raster;
  const original = doc.toJSON(),
    before = doc.getSnapshot();
  doc.crop({ x: 40, y: 50, width: 200, height: 100 });
  expect([doc.width, doc.height, group.x, group.y]).toEqual([
    200, 100, -20, -20,
  ]);
  expect([
    raster.x,
    raster.y,
    raster.width,
    raster.height,
    raster.assetId,
  ]).toEqual([5, 7, 10000, 5000, "original"]);
  expect([group.mask!.x, group.mask!.y, paint.mask!.x, paint.mask!.y]).toEqual([
    60, 150, 30, 30,
  ]);
  expect([raster.mask!.x, raster.mask!.y]).toEqual([3, 4]);
  expect(doc.selection!.regions[0]).toMatchObject({
    x: 0,
    y: 0,
    width: 200,
    height: 100,
  });
  expect(group.locked).toBe(true);
  expect(doc.selectedLayer?.id).toBe(raster.id);
  expect(doc.layers.at(1)!.x).toBe(11960);
  expect(doc.getSnapshot().past).toHaveLength(before.past.length + 1);
  expect(doc.getSnapshot().canvasRevision).toBe(before.canvasRevision + 1);
  const cropped = doc.toJSON();
  doc.undo();
  expect(doc.toJSON()).toEqual(original);
  doc.redo();
  expect(doc.toJSON()).toEqual(cropped);
  expect(doc.getSnapshot().canvasRevision).toBe(before.canvasRevision + 3);
  doc.crop({ x: -40, y: -50, width: 10000, height: 5000 });
  expect(doc.toJSON()).toEqual(original);
});

it("rejects unsafe crop rectangles and translated coordinates without changing history", () => {
  const doc = new Document({ width: 100, height: 80 });
  const layer = doc.layers.add(new PaintLayer({ x: -Number.MAX_SAFE_INTEGER }));
  layer.mask = new LayerMask({ base: 1, linked: false });
  const before = doc.getSnapshot();
  for (const bounds of [
    { x: 0.5, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: Infinity, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 10, height: NaN },
    { x: Number.MAX_SAFE_INTEGER, y: 0, width: 10, height: 10 },
  ]) {
    expect(() => doc.crop(bounds)).toThrow();
    expect(() => parseCommands([{ type: "document.crop", bounds }])).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  }
  expect(() => doc.crop({ x: 1, y: 0, width: 10, height: 10 })).toThrow();
  expect(doc.getSnapshot()).toBe(before);
  doc.crop({ x: 0, y: 0, width: 100, height: 80 });
  expect(doc.getSnapshot()).toBe(before);
});

it("tracks canvas coordinate changes through mixed transactions, rollback and undo/redo", () => {
  const doc = new Document({ width: 100, height: 80 }),
    before = doc.getSnapshot();
  expect(() =>
    doc.transaction("Invalid crop", () => {
      doc.crop({ x: 5, y: 5, width: 50, height: 40 });
      throw Error("cancel");
    }),
  ).toThrow(/cancel/);
  expect(doc.getSnapshot()).toBe(before);
  doc.transaction("Crop recipe", () => {
    doc.name = "Cropped";
    doc.crop({ x: 5, y: 5, width: 100, height: 80 });
  });
  // Even a crop keeping the same dimensions changes the coordinate space.
  // Empty-document geometry alone would be a no-op, so include a meaningful rename.
  expect(doc.getSnapshot().canvasRevision).toBe(1);
  doc.undo();
  expect(doc.getSnapshot().canvasRevision).toBe(2);
  doc.redo();
  expect(doc.getSnapshot().canvasRevision).toBe(3);
  doc.name = "Renamed";
  expect(doc.getSnapshot().canvasRevision).toBe(3);
  doc.undo();
  expect(doc.getSnapshot().canvasRevision).toBe(3);
});
