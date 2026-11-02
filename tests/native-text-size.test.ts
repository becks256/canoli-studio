import { it, expect } from "vitest";
import { create } from "fontkit";
import { nativeSizeFontBytes } from "../src/engine/native-size-font";
import { captureNativeTextSize } from "../src/engine/native-text-size";
it("the independent calibration font has exactly one em advance and no variation or layout dependency", () => {
  const bytes = nativeSizeFontBytes(),
    font = create(bytes) as unknown as {
      unitsPerEm: number;
      numGlyphs: number;
      glyphForCodePoint(code: number): { id: number; advanceWidth: number };
      variationAxes: Record<string, unknown>;
    };
  expect(font.unitsPerEm).toBe(2048);
  expect(font.numGlyphs).toBe(2);
  expect(font.glyphForCodePoint(65)).toMatchObject({
    id: 1,
    advanceWidth: 2048,
  });
  expect(font.variationAxes).toEqual({});
  const v = new DataView(bytes.buffer),
    tags = Array.from({ length: v.getUint16(4) }, (_, i) =>
      String.fromCharCode(...bytes.subarray(12 + i * 16, 16 + i * 16)),
    );
  for (const tag of ["GSUB", "GPOS", "kern", "fvar", "HVAR"])
    expect(tags).not.toContain(tag);
  bytes.fill(0);
  expect(nativeSizeFontBytes().slice(0, 4)).toEqual(
    new Uint8Array([0, 1, 0, 0]),
  );
});
it("invalid native sizes and deadlines reject before creating native resources", async () => {
  for (const size of [0, -1, NaN, Infinity])
    await expect(captureNativeTextSize(size)).rejects.toThrow(
      "Invalid native text size",
    );
  for (const timeoutMs of [0, -1, 1.5, Infinity, 0x80000000])
    await expect(captureNativeTextSize(13.5, { timeoutMs })).rejects.toThrow(
      "Invalid native text size",
    );
});
