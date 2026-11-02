import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { captureVerticalMetricTables } from "../src/engine/native-vertical-metrics";
it("native vertical origins use original vmtx bearings and independent native bounds", async () => {
  const bytes = new Uint8Array(
      await readFile("tests/fixtures/vertical-font/Vertical.ttf"),
    ),
    before = bytes.slice(),
    source = captureVerticalMetricTables(bytes),
    metrics = {
      width: 24,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 16,
      actualBoundingBoxAscent: 24,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: 32,
      fontBoundingBoxDescent: 8,
    } as TextMetrics;
  expect(source.metric(2, 40, metrics)).toEqual({
    glyphId: 2,
    hAdvance: 24,
    vAdvance: -48,
    vOriginX: 12,
    vOriginY: 32,
    extents: { xBearing: -0, yBearing: 24, width: 16, height: -24 },
  });
  expect(
    source.metric(2, 40, { ...metrics, actualBoundingBoxAscent: 25 }),
  ).toMatchObject({ vOriginY: 33 });
  expect(bytes).toEqual(before);
  expect(() => source.metric(8, 40, metrics)).toThrow("source");
  const v = new DataView(bytes.buffer),
    bad = bytes.slice();
  for (let i = 0; i < v.getUint16(4); i++) {
    const p = 12 + i * 16;
    if (String.fromCharCode(...bytes.slice(p, p + 4)) === "vhea")
      new DataView(bad.buffer).setUint16(v.getUint32(p + 8) + 34, 0);
  }
  expect(() => captureVerticalMetricTables(bad)).toThrow("vertical");
  expect(() => captureVerticalMetricTables(bytes.slice(0, 20))).toThrow(
    "directory",
  );
});
it("VORG glyph overrides and default origins take precedence over vmtx and native outline bounds", async () => {
  const bytes = new Uint8Array(
      await readFile("tests/fixtures/vertical-font/Vertical.ttf"),
    ),
    view = new DataView(bytes.buffer);
  let offset = 0;
  for (let i = 0; i < view.getUint16(4); i++) {
    const p = 12 + i * 16;
    if (String.fromCharCode(...bytes.slice(p, p + 4)) === "post") {
      bytes.set(new TextEncoder().encode("VORG"), p);
      offset = view.getUint32(p + 8);
    }
  }
  // A semantic table-reader fixture, not a native font admission/interop proof.
  expect(offset).toBeGreaterThan(0);
  view.setUint16(offset, 1);
  view.setUint16(offset + 2, 0);
  view.setInt16(offset + 4, 500);
  view.setUint16(offset + 6, 1);
  view.setUint16(offset + 8, 2);
  view.setInt16(offset + 10, 700);
  const tables = captureVerticalMetricTables(bytes),
    m = {
      width: 24,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 16,
      actualBoundingBoxAscent: 999,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: 32,
      fontBoundingBoxDescent: 8,
    } as TextMetrics;
  expect(tables.metric(2, 40, m).vOriginY).toBe(28);
  expect(tables.metric(7, 40, m).vOriginY).toBe(20);
  view.setUint16(offset + 8, 8);
  expect(() => captureVerticalMetricTables(bytes)).toThrow("VORG glyph");
});

it("native callback coordinates truncate signed Float32 fractions and reject overflow", async () => {
  const { nativeMetricPosition } = await import("../src/fonts/native-metrics");
  expect(nativeMetricPosition(1.75 / 65536)).toBe(1);
  expect(nativeMetricPosition(-1.75 / 65536)).toBe(-1);
  expect(nativeMetricPosition(0.75 / 65536)).toBe(0);
  expect(nativeMetricPosition(-0.75 / 65536)).toBe(-0);
  expect(() => nativeMetricPosition(32768)).toThrow("representation");
  expect(() => nativeMetricPosition(NaN)).toThrow("representation");
});
