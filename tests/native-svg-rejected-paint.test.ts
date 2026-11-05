import { expect, test } from "vitest";
import { AffineTransform } from "../src/core/affine";
import type { FloatGlyph } from "../src/engine/float-glyph";
import type { NativeGlyphFont } from "../src/engine/native-glyph-font";
import { NativeSvgRejectedPaints } from "../src/engine/native-svg-rejected-paint";

const font = {} as NativeGlyphFont;
const glyph = (changes: Partial<FloatGlyph> = {}): FloatGlyph => ({
  font,
  glyphId: 1,
  sourceCluster: 0,
  surface: "svg",
  origin: { x: 12, y: 20 },
  style: { fontSize: 40, fontWeight: "normal", fontStyle: "normal", fontStretch: "normal" },
  transform: new AffineTransform(),
  color: [4, -.25, 1.5, .5],
  ...changes,
});

test("only previously rejected ordered paint is reused; original owners, poses and authored colors stay distinct", async () => {
  const cache = new NativeSvgRejectedPaints(() => {}),
    first = glyph(), second = glyph({ glyphId: 2, sourceCluster: 1 }),
    key = await cache.key([first, second]);
  expect(cache.has(key)).toBe(false);
  cache.remember(key);
  expect(cache.has(await cache.key([{ ...first }, { ...second }]))).toBe(true);
  for (const changed of [
    glyph({ font: {} as NativeGlyphFont }),
    glyph({ glyphId: 2 }),
    glyph({ origin: { x: 12.001, y: 20 } }),
    glyph({ transform: AffineTransform.translation(.001, 0) }),
    glyph({ rotation: .001 }),
    glyph({ color: [4, -.25, 1.5, .50000001] }),
    glyph({ writing: { mode: "vertical-rl", orientation: "upright" } }),
    glyph({ style: { ...first.style, fontSize: 40.001 } }),
  ]) expect(cache.has(await cache.key([changed, second]))).toBe(false);
  expect(cache.has(await cache.key([second, first]))).toBe(false);
  expect(cache.has(await cache.key([first]))).toBe(false);
});

test("hits and key preparation enforce cancellation and captured-owner lifetime", async () => {
  let invalid = false;
  const cache = new NativeSvgRejectedPaints(() => {
    if (invalid) throw new Error("Retired native source");
  }), key = await cache.key([glyph()]);
  cache.remember(key);
  invalid = true;
  expect(() => cache.has(key)).toThrow("Retired native source");
  await expect(cache.key([glyph()])).rejects.toThrow("Retired native source");
  expect(() => cache.remember(key)).toThrow("Retired native source");
  cache.clear();
  invalid = false;
  expect(cache.has(key)).toBe(false);
});

test("the byte budget evicts older rejections and bypasses oversized keys without limiting source geometry", async () => {
  const cache = new NativeSvgRejectedPaints(() => {}),
    path = "M0 0" + "L1 1".repeat(50_000),
    make = (startOffset: number) => glyph({ path: { data: path, startOffset, baselineOffset: 0 } });
  const a = await cache.key([make(0)]), b = await cache.key([make(1)]), c = await cache.key([make(2)]);
  expect(a).toBeDefined();
  cache.remember(a); cache.remember(b);
  expect(cache.has(a)).toBe(true);
  cache.remember(c);
  expect(cache.has(a)).toBe(true);
  expect(cache.has(b)).toBe(false);
  expect(cache.has(c)).toBe(true);
  expect(await cache.key([glyph({ path: { data: path.repeat(4), startOffset: 0, baselineOffset: 0 } })])).toBeUndefined();
  expect(cache.has(undefined)).toBe(false);
  cache.remember(undefined);
  expect(cache.has(a)).toBe(true);
});
