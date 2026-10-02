import { expect, it } from "vitest";
import { adjustHsl } from "../src/engine/hsl";
import { Document, AdjustmentLayer, defaultHslAdjustment } from "../src/dom";
import { validateDocument } from "../src/core/model";

it("rotates primary hues and preserves alpha and neutral colors", () => {
  const input = new Uint8ClampedArray([
    255, 0, 0, 128, 0, 255, 0, 255, 0, 0, 255, 0, 128, 128, 128, 255,
  ]);
  expect([
    ...adjustHsl(input, { kind: "hsl", hue: 120, saturation: 0, lightness: 0 }),
  ]).toEqual([
    0, 255, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 128, 128, 128, 255,
  ]);
  expect(adjustHsl(input, defaultHslAdjustment())).toEqual(input);
  expect([
    ...adjustHsl(input, {
      kind: "hsl",
      hue: 0,
      saturation: -100,
      lightness: 0,
    }).slice(0, 4),
  ]).toEqual([128, 128, 128, 128]);
  expect([
    ...adjustHsl(input, {
      kind: "hsl",
      hue: 0,
      saturation: 0,
      lightness: 100,
    }).slice(0, 4),
  ]).toEqual([255, 255, 255, 128]);
  expect([
    ...adjustHsl(input, {
      kind: "hsl",
      hue: 0,
      saturation: 0,
      lightness: -100,
    }).slice(0, 4),
  ]).toEqual([0, 0, 0, 128]);
  expect(input[0]).toBe(255);
});

it("validates HSL through the shared model with undo and legacy schema rejection", () => {
  const doc = new Document();
  const layer = doc.layers.add(
    new AdjustmentLayer({ adjustment: defaultHslAdjustment() }),
  );
  layer.adjustment = { kind: "hsl", hue: 120, saturation: 50, lightness: -20 };
  doc.undo();
  expect(layer.adjustment).toEqual(defaultHslAdjustment());
  doc.redo();
  const before = doc.toJSON();
  expect(() => {
    layer.adjustment = { kind: "hsl", hue: 181, saturation: 0, lightness: 0 };
  }).toThrow();
  expect(doc.toJSON()).toEqual(before);
  expect(() => validateDocument({ ...before, schemaVersion: 14 })).toThrow(
    /schema version 15/,
  );
  expect(Document.fromJSON(before).toJSON()).toEqual(before);
});
