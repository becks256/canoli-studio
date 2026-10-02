import { expect, it } from "vitest";
import { createDocument, createGroup, createRaster } from "../src/core/model";
import {
  hitTest,
  layerBounds,
  layerOrigin,
  layerTransform,
  localBounds,
} from "../src/core/spatial";

it("shares nested layer coordinates between placement, bounds and hit testing", () => {
  const document = createDocument();
  const parent = createGroup(),
    child = createGroup();
  const raster = createRaster("Image", "asset", 40, 30);
  parent.x = 100;
  parent.y = 60;
  child.x = -20;
  child.y = 15;
  raster.x = 5;
  raster.y = -10;
  child.children.push(raster);
  parent.children.push(child);
  document.children.push(parent);
  expect(layerOrigin(document, raster.id)).toEqual({ x: 85, y: 65 });
  expect(layerBounds(document, parent.id)).toEqual({
    x: 85,
    y: 65,
    width: 40,
    height: 30,
  });
  expect(
    layerTransform(document, raster.id)!.inverse().point({ x: 100, y: 70 }),
  ).toEqual({ x: 15, y: 5 });
  expect(hitTest(document, 100, 70)).toBe(raster.id);
  expect(hitTest(document, 84, 70)).toBeNull();
  const top = createRaster("Top", "asset", 40, 30);
  top.x = 85;
  top.y = 65;
  document.children.push(top);
  expect(hitTest(document, 100, 70)).toBe(top.id);
  top.visible = false;
  expect(hitTest(document, 100, 70)).toBe(raster.id);
  parent.opacity = 0;
  expect(hitTest(document, 100, 70)).toBeNull();
  expect(layerTransform(document, "missing")).toBeUndefined();
});

it("preserves small layer extents when translated to large coordinates", () => {
  const document = createDocument();
  const raster = createRaster("Image", "asset", 3, 5);
  raster.x = Number.MAX_SAFE_INTEGER - 1;
  document.children.push(raster);
  expect(layerBounds(document, raster.id)).toEqual({
    x: raster.x,
    y: 0,
    width: 3,
    height: 5,
  });
  expect(localBounds(createGroup())).toBeUndefined();
});
