import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BrushStroke,
  Document,
  LayerGroup,
  LayerMask,
  PaintLayer,
  VectorPath,
} from "../src/dom";
import { ToolController } from "../src/tools";
import type { EditorApplication } from "../src/editor";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 0),
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const modifiers = { alt: false, shift: false, pressure: 1 };
function setup() {
  const document = new Document(),
    group = document.layers.add(new LayerGroup({ x: 10, y: 20 }));
  const layer = group.layers.add(new PaintLayer({ x: 5, y: 7 }));
  layer.mask = new LayerMask({
    x: 3,
    y: 4,
    paths: [
      new VectorPath({
        closed: true,
        points: [
          { x: 30, y: 40, in: { x: 15, y: 35 }, out: { x: 50, y: 45 } },
          { x: 130, y: 40 },
          { x: 130, y: 120 },
        ],
      }),
    ],
  }).paint(new BrushStroke({ points: [{ x: 90, y: 80 }], size: 10 }), "hide");
  document.selectedLayer = layer;
  const tools = new ToolController({
    document,
    assetStore: { remove: vi.fn() },
  } as unknown as EditorApplication);
  tools.configure({ penEditTarget: "mask" });
  return { document, group, layer, tools };
}

it("mask pen previews stay detached and commit one undoable path edit", async () => {
  const { document, layer, tools } = setup(),
    before = document.getSnapshot(),
    original = layer.mask!.toJSON();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  tools.move({ x: 58, y: 76 }, modifiers);
  vi.runAllTimers();
  expect(tools.getSnapshot().preview?.type).toBe("layer.update");
  expect(document.getSnapshot()).toBe(before);
  expect(layer.mask!.toJSON()).toEqual(original);
  await tools.end();
  expect(document.getSnapshot().past).toHaveLength(before.past.length + 1);
  expect(layer.mask!.paths[0].points[0]).toEqual({
    x: 40,
    y: 45,
    in: { x: 25, y: 40 },
    out: { x: 60, y: 50 },
  });
  expect(layer.mask!.strokes).toHaveLength(1);
  document.undo();
  expect(layer.mask!.toJSON()).toEqual(original);
  document.redo();
  expect(layer.mask!.paths[0].points[0].x).toBe(40);
});

it("clicking an asymmetric handle or empty canvas does not change curves or delete a layer", async () => {
  const { document, layer, tools } = setup(),
    before = document.getSnapshot();
  tools.begin("pen", { x: 68, y: 76 }, modifiers, 1);
  tools.move({ x: 68, y: 76 }, modifiers);
  await tools.end();
  expect(document.getSnapshot()).toBe(before);
  tools.begin("pen", { x: 220, y: 220 }, modifiers, 1);
  await tools.end();
  expect(tools.removeLastAnchor()).toBe(true);
  expect(document.getSnapshot()).toBe(before);
  expect(document.getLayer(layer.id)).not.toBeNull();
});

it("mask pen cancellation, revision conflicts and parent locks cannot overwrite edits", async () => {
  const { document, group, layer, tools } = setup(),
    original = layer.mask!.toJSON();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  tools.move({ x: 58, y: 76 }, modifiers);
  tools.cancel();
  vi.runAllTimers();
  await tools.end();
  expect(layer.mask!.toJSON()).toEqual(original);
  expect(tools.getSnapshot().preview).toBeNull();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  tools.move({ x: 58, y: 76 }, modifiers);
  layer.opacity = 0.4;
  await expect(tools.end()).rejects.toThrow(/document changed/);
  expect(layer.mask!.toJSON()).toEqual(original);
  expect(layer.opacity).toBe(0.4);
  group.locked = true;
  const before = document.getSnapshot();
  expect(() => tools.begin("pen", { x: 48, y: 71 }, modifiers, 1)).toThrow(
    /Unlock/,
  );
  expect(() => tools.nudgeMaskPoint(1, 0)).toThrow(/Unlock/);
  expect(document.getSnapshot()).toBe(before);
});

it("deleting a mask contour's last anchor retains the layer and paint refinements", async () => {
  const { document, layer, tools } = setup();
  layer.mask = layer.mask!.with({
    paths: [new VectorPath({ closed: true, points: [{ x: 30, y: 40 }] })],
  });
  const original = layer.mask!.toJSON();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  expect(tools.removeLastAnchor()).toBe(true);
  expect(layer.mask!.paths).toHaveLength(0);
  expect(layer.mask!.strokes).toHaveLength(1);
  expect(document.getLayer(layer.id)).not.toBeNull();
  document.undo();
  expect(layer.mask!.toJSON()).toEqual(original);
});

it("inserts a mask midpoint atomically, selects it, and respects parent locks", async () => {
  const { document, group, layer, tools } = setup(),
    original = layer.mask!.toJSON();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  const past = document.getSnapshot().past.length;
  tools.insertMaskAnchor();
  expect(layer.mask!.paths[0].points).toHaveLength(4);
  expect(layer.mask!.strokes).toHaveLength(1);
  expect(tools.selectedMaskAnchor?.index).toBe(1);
  expect(document.getSnapshot().past).toHaveLength(past + 1);
  document.undo();
  expect(layer.mask!.toJSON()).toEqual(original);
  document.redo();
  const inserted = layer.mask!.toJSON();
  group.locked = true;
  const locked = document.getSnapshot();
  expect(() => tools.insertMaskAnchor()).toThrow(/Unlock/);
  expect(document.getSnapshot()).toBe(locked);
  expect(layer.mask!.toJSON()).toEqual(inserted);
});

it("drafts curved mask contours without history and commits once on closure", async () => {
  const { document, layer, tools } = setup(),
    before = document.getSnapshot(),
    original = layer.mask!.toJSON();
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  tools.move({ x: 63, y: 71 }, modifiers);
  vi.runAllTimers();
  await tools.end();
  expect(document.getSnapshot()).toBe(before);
  expect(tools.getSnapshot().preview?.type).toBe("layer.update");
  tools.begin("pen", { x: 128, y: 131 }, modifiers, 1);
  await tools.end();
  expect(tools.maskContourPointCount).toBe(2);
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  expect(tools.drawingMaskContour).toBe(false);
  expect(tools.getSnapshot().preview).toBeNull();
  expect(layer.mask!.paths).toHaveLength(2);
  expect(layer.mask!.paths[1].points[0]).toEqual({
    x: 30,
    y: 40,
    in: { x: 15, y: 40 },
    out: { x: 45, y: 40 },
  });
  expect(layer.mask!.strokes).toHaveLength(1);
  expect(document.getSnapshot().past).toHaveLength(before.past.length + 1);
  document.undo();
  expect(layer.mask!.toJSON()).toEqual(original);
  document.redo();
  expect(layer.mask!.paths).toHaveLength(2);
});

it("draft deletion, cancellation and stale/locked targets never overwrite mask content", async () => {
  const { document, group, layer, tools } = setup(),
    original = layer.mask!.toJSON();
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  expect(tools.removeLastAnchor()).toBe(true);
  expect(tools.maskContourPointCount).toBe(0);
  tools.finishPath();
  expect(layer.mask!.toJSON()).toEqual(original);
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  tools.cancel();
  tools.finishPath();
  expect(layer.mask!.toJSON()).toEqual(original);
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  layer.opacity = 0.5;
  expect(() => tools.finishPath()).toThrow(/document changed/);
  expect(tools.drawingMaskContour).toBe(false);
  expect(layer.mask!.toJSON()).toEqual(original);
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  document.selectedLayer = group;
  expect(() => tools.finishPath()).toThrow(/selected layer changed/);
  document.selectedLayer = layer;
  group.locked = true;
  expect(() => tools.startMaskContour()).toThrow(/Unlock/);
  expect(layer.mask!.toJSON()).toEqual(original);
});

it("finishes an unlinked contour in document coordinates and enforces contour limits", async () => {
  const { document, layer, tools } = setup();
  layer.mask = layer.mask!.with({ linked: false, x: 8, y: 9 });
  tools.startMaskContour();
  tools.begin("pen", { x: 48, y: 71 }, modifiers, 1);
  await tools.end();
  tools.finishPath();
  expect(layer.mask!.paths[1].points[0].x).toBe(40);
  expect(layer.mask!.paths[1].points[0].y).toBe(62);
  const path = new VectorPath({ closed: true, points: [{ x: 0, y: 0 }] });
  layer.mask = new LayerMask({
    paths: Array.from({ length: 128 }, () => path),
  });
  const before = document.getSnapshot();
  expect(() => tools.startMaskContour()).toThrow(/128-contour/);
  expect(document.getSnapshot()).toBe(before);
});

it("clicking a mask curve inserts on release, preserves the mask, and cancels without a stale anchor", async () => {
  const { document, layer, tools } = setup();
  const original = layer.mask!.toJSON(),
    before = document.getSnapshot();
  // Straight second segment, local (130,80), translated by the full mask origin (18,31).
  tools.begin("pen", { x: 148, y: 111 }, modifiers, 1);
  expect(tools.getSnapshot().drawing).toBe(true);
  expect(tools.selectedMaskAnchor?.index).toBe(2);
  expect(document.getSnapshot()).toBe(before);
  tools.cancel();
  await tools.end();
  expect(tools.selectedMaskAnchor).toBeNull();
  expect(document.getSnapshot()).toBe(before);
  tools.begin("pen", { x: 148, y: 111 }, modifiers, 1);
  await tools.end();
  const mask = layer.mask!;
  expect(mask.paths[0].points).toHaveLength(4);
  expect(mask.paths[0].points[2]).toMatchObject({ x: 130, y: 80 });
  expect(mask.strokes).toHaveLength(1);
  expect(mask.x).toBe(3);
  expect(mask.y).toBe(4);
  expect(tools.selectedMaskAnchor?.index).toBe(2);
  expect(document.getSnapshot().past).toHaveLength(before.past.length + 1);
  document.undo();
  expect(layer.mask!.toJSON()).toEqual(original);
});
