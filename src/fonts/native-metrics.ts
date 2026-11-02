import { z } from "zod";
const number = z.number().finite();
export const nativeFontMetricSchema = z
  .object({
    glyphId: z.number().int().min(0).max(65534),
    hAdvance: number,
    vAdvance: number,
    vOriginX: number,
    vOriginY: number,
    extents: z
      .object({
        xBearing: number,
        yBearing: number,
        width: number,
        height: number,
      })
      .strict(),
  })
  .strict();
export const nativeFontMetricsSchema = z
  .object({
    em: number.positive(),
    glyphs: z.array(nativeFontMetricSchema).max(65535),
  })
  .strict();
export type NativeFontMetric = z.infer<typeof nativeFontMetricSchema>;
export type NativeFontMetrics = z.infer<typeof nativeFontMetricsSchema>;
/** Native callback coordinates use Float32 pixels converted to signed 16.16
 * by truncation, matching the native integer cast. Never saturate bad input. */
export function nativeMetricPosition(value: number) {
  const n = Math.trunc(Math.fround(value) * 65536);
  if (!Number.isSafeInteger(n) || n < -0x80000000 || n > 0x7fffffff)
    throw new Error(
      "Native font metrics exceed the shaping coordinate representation.",
    );
  return n;
}
export function captureNativeFontMetrics(input: NativeFontMetrics) {
  const value = nativeFontMetricsSchema.parse(input),
    ids = new Set<number>();
  if (!nativeMetricPosition(value.em))
    throw new Error("Native font metrics require a representable positive em.");
  for (const row of value.glyphs) {
    if (ids.has(row.glyphId))
      throw new Error("Native font metric glyph IDs must be unique.");
    ids.add(row.glyphId);
    for (const n of [
      row.hAdvance,
      row.vAdvance,
      row.vOriginX,
      row.vOriginY,
      ...Object.values(row.extents),
    ])
      nativeMetricPosition(n);
  }
  return Object.freeze({
    em: value.em,
    glyphs: Object.freeze(
      value.glyphs.map((g) =>
        Object.freeze({ ...g, extents: Object.freeze(g.extents) }),
      ),
    ),
  });
}
