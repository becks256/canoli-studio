import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Document, PaintLayer, MarqueeSelection } from "../src/dom";
import { CropController, adjustCrop } from "../src/crop-controller";
import type { CropHandle } from "../src/crop-controller";

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

it("draws a frame with frame-paced updates and applies one crop to locked artwork", () => {
  const document = new Document({ width: 200, height: 150 });
  const layer = document.layers.add(
    new PaintLayer({ x: 10, y: 20, locked: true }),
  );
  document.selectedLayer = layer;
  const changed = vi.fn(),
    crop = new CropController(() => document, changed),
    before = document.getSnapshot();
  crop.start();
  expect(crop.bounds).toBeNull();
  crop.begin({ x: 20, y: 30 }, 1);
  const calls = changed.mock.calls.length;
  for (let i = 0; i < 10; i++) crop.move({ x: 111 + i, y: 110 });
  expect(changed).toHaveBeenCalledTimes(calls);
  vi.runAllTimers();
  expect(changed).toHaveBeenCalledTimes(calls + 1);
  expect(crop.bounds).toEqual({ x: 20, y: 30, width: 100, height: 80 });
  crop.end();
  crop.nudge(10, -5);
  crop.begin({ x: 130, y: 105 }, 1, "se");
  crop.move({ x: 150, y: 125 });
  crop.end();
  expect(crop.bounds).toEqual({ x: 30, y: 25, width: 120, height: 100 });
  expect(document.getSnapshot()).toBe(before);
  crop.apply();
  expect(crop.active).toBe(false);
  vi.runAllTimers();
  expect([
    document.width,
    document.height,
    layer.x,
    layer.y,
    layer.locked,
  ]).toEqual([120, 100, -20, -5, true]);
  expect(document.getSnapshot().past).toHaveLength(before.past.length + 1);
  document.undo();
  expect(document.toJSON()).toEqual(before.document);
});

it("resizes all handles, clamps opposing edges and constrains corners without moving their opposite anchors", () => {
  const bounds = { x: 20, y: 30, width: 100, height: 80 };
  const expected: Record<CropHandle, number[]> = {
    nw: [30, 40, 90, 70],
    n: [20, 40, 100, 70],
    ne: [20, 40, 110, 70],
    e: [20, 30, 110, 80],
    se: [20, 30, 110, 90],
    s: [20, 30, 100, 90],
    sw: [30, 30, 90, 90],
    w: [30, 30, 90, 80],
  };
  for (const [handle, values] of Object.entries(expected))
    expect(
      Object.values(adjustCrop(bounds, handle as CropHandle, 10, 10)),
    ).toEqual(values);
  expect(adjustCrop(bounds, "w", 1000, 0)).toEqual({
    x: 119,
    y: 30,
    width: 1,
    height: 80,
  });
  expect(
    adjustCrop({ x: 20, y: 30, width: 100, height: 50 }, "se", 20, 5, true),
  ).toEqual({ x: 20, y: 30, width: 120, height: 60 });
  expect(
    adjustCrop({ x: 20, y: 30, width: 100, height: 50 }, "nw", 10, 10, true),
  ).toEqual({ x: 40, y: 40, width: 80, height: 40 });
});

it("moves frames, draws reversed squares, uses screen-sized edge hits and retains bounds outside the canvas", () => {
  const document = new Document({ width: 200, height: 150 }),
    crop = new CropController(
      () => document,
      () => {},
    );
  crop.start({ x: 20, y: 30, width: 100, height: 80 });
  crop.begin({ x: 60, y: 60 }, 1);
  crop.move({ x: 50, y: 45 });
  crop.end();
  expect(crop.bounds).toEqual({ x: 10, y: 15, width: 100, height: 80 });
  crop.start({ x: 20, y: 30, width: 100, height: 80 });
  crop.begin({ x: 130, y: 70 }, 0.5);
  crop.move({ x: 140, y: 70 });
  crop.end();
  expect(crop.bounds).toEqual({ x: 20, y: 30, width: 110, height: 80 });
  crop.start(null);
  crop.begin({ x: 10, y: 10 }, 1);
  crop.move({ x: -30, y: -10 }, true);
  crop.end();
  expect(crop.bounds).toEqual({ x: -30, y: -30, width: 40, height: 40 });
  crop.nudge(-10, 0, "w");
  expect(crop.bounds).toEqual({ x: -40, y: -30, width: 50, height: 40 });
});

it("cancels pending frames and rejects stale documents without history changes", () => {
  let document = new Document({ width: 200, height: 150 });
  document.selection = new MarqueeSelection({
    shape: "rectangle",
    x: 10.2,
    y: 20.2,
    width: 50.2,
    height: 60.2,
  });
  const crop = new CropController(
      () => document,
      () => {},
    ),
    before = document.getSnapshot();
  crop.start();
  expect(crop.bounds).toEqual({ x: 10, y: 20, width: 51, height: 61 });
  crop.begin({ x: 61, y: 81 }, 1, "se");
  crop.move({ x: 90, y: 90 });
  crop.cancel();
  vi.runAllTimers();
  expect(crop.bounds).toBeNull();
  expect(document.getSnapshot()).toBe(before);
  crop.start();
  document.name = "External edit";
  expect(() => crop.apply()).toThrow(/document changed/);
  expect(crop.active).toBe(false);
  expect(document.width).toBe(200);
  crop.start({ x: 0, y: 0, width: 20, height: 20 });
  document = new Document();
  expect(() => crop.apply()).toThrow(/document changed/);
});
