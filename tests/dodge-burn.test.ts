import { expect, it } from "vitest";
import {
  applyDodgeBurn,
  tonalRangeWeight,
} from "../src/core/retouch/dodgeBurn";
import type { DodgeBurnMode, DodgeBurnRange } from "../src/core/retouch/types";

it("preserves sources, alpha, fully transparent RGB and zero coverage exactly", () => {
  const source = new Uint8Array([
    100, 100, 100, 128, 100, 100, 100, 255, 10, 30, 50, 0,
  ]);
  const before = source.slice();
  const output = applyDodgeBurn(
    source,
    3,
    1,
    { mode: "dodge", range: "midtones", exposure: 1 },
    new Uint8Array([255, 0, 255]),
  );
  expect(source).toEqual(before);
  expect(output[0]).toBeGreaterThan(source[0]);
  expect(output[3]).toBe(128);
  expect([...output.slice(4)]).toEqual([...source.slice(4)]);
});

for (const mode of ["dodge", "burn"] as DodgeBurnMode[])
  for (const range of [
    "shadows",
    "midtones",
    "highlights",
  ] as DodgeBurnRange[]) {
    it(`${mode}/${range} keeps a neutral ramp neutral, monotonic, bounded and correctly directed`, () => {
      const source = Uint8Array.from({ length: 1024 }, (_, i) =>
        i % 4 === 3 ? 255 : Math.floor(i / 4),
      );
      const result = applyDodgeBurn(source, 256, 1, {
        mode,
        range,
        exposure: 1,
      });
      for (let value = 0; value < 256; value++) {
        const index = value * 4;
        expect(result[index]).toBe(result[index + 1]);
        expect(result[index]).toBe(result[index + 2]);
        if (value)
          expect(result[index]).toBeGreaterThanOrEqual(result[index - 4]);
        if (mode === "dodge")
          expect(result[index]).toBeGreaterThanOrEqual(value);
        else expect(result[index]).toBeLessThanOrEqual(value);
      }
      expect(result[0]).toBe(0);
      expect(result[1020]).toBe(255);
    });
  }

it("combines flow and coverage without changing alpha and leaves zero exposure exact", () => {
  const source = new Uint8Array([100, 120, 140, 97]);
  const options = {
    mode: "burn" as const,
    range: "midtones" as const,
    exposure: 0.8,
  };
  expect(applyDodgeBurn(source, 1, 1, { ...options, flow: 128 / 255 })).toEqual(
    applyDodgeBurn(source, 1, 1, options, new Uint8Array([128])),
  );
  expect([
    ...applyDodgeBurn(source, 1, 1, { ...options, exposure: 0 }),
  ]).toEqual([...source]);
  expect(tonalRangeWeight(0.1, "shadows")).toBeGreaterThan(
    tonalRangeWeight(0.1, "highlights"),
  );
  expect(tonalRangeWeight(0.5, "midtones")).toBe(1);
});

it("rejects invalid geometry, coverage and exposure before returning pixels", () => {
  const source = new Uint8Array(4);
  const options = {
    mode: "burn" as const,
    range: "shadows" as const,
    exposure: 0.5,
  };
  expect(() => applyDodgeBurn(source, 2, 1, options)).toThrow("dimensions");
  expect(() =>
    applyDodgeBurn(source, 1, 1, options, new Uint8Array(2)),
  ).toThrow("coverage");
  expect(() =>
    applyDodgeBurn(source, 1, 1, { ...options, exposure: NaN }),
  ).toThrow("Exposure");
});

it("stores detached tonal strokes with shared undo and rejects legacy documents containing them", async () => {
  const { Document, AdjustmentLayer, BrushStroke, TonalStroke } =
    await import("../src/dom");
  const doc = new Document();
  const layer = doc.layers.add(
    new AdjustmentLayer({ adjustment: { kind: "tonal", strokes: [] } }),
  );
  const stroke = new TonalStroke({
    brush: new BrushStroke({ points: [{ x: 8, y: 8, pressure: 1 }], size: 12 }),
    mode: "burn",
    range: "shadows",
    exposure: 0.5,
  });
  layer.addTonalStroke(stroke);
  const saved = doc.toJSON();
  expect((layer.adjustment as { strokes: unknown[] }).strokes).toHaveLength(1);
  const detached = stroke.toJSON();
  detached.exposure = 0;
  expect(stroke.toJSON().exposure).toBe(0.5);
  doc.undo();
  expect((layer.adjustment as { strokes: unknown[] }).strokes).toHaveLength(0);
  doc.redo();
  expect(doc.toJSON()).toEqual(saved);
  expect(() => Document.fromJSON({ ...saved, schemaVersion: 7 })).toThrow(
    "schema version 8",
  );
  expect(Document.fromJSON(saved).toJSON()).toEqual(saved);
});
