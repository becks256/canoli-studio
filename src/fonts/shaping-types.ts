import {
  nativeFontMetricsSchema,
  captureNativeFontMetrics,
  type NativeFontMetrics,
} from "./native-metrics";
import { yieldTask } from "../core/task-yield";
import { z } from "zod";
import { fontRunCssSchema, type FontRunCss } from "./css-instance";
export const fontRunInputSchema = z
  .object({
    text: z.string().max(10000),
    css: fontRunCssSchema.optional(),
    nominal: z.boolean().optional(),
    nativeMetrics: nativeFontMetricsSchema.optional(),
    direction: z.enum(["ltr", "rtl", "ttb", "btt"]).default("ltr"),
    script: z
      .string()
      .regex(/^[A-Za-z]{4}$/)
      .optional(),
    language: z
      .string()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .default("und"),
    itemOffset: z.number().int().nonnegative().default(0),
    itemLength: z.number().int().nonnegative().optional(),
    features: z
      .array(
        z
          .object({
            tag: z.string().regex(/^[\x20-\x7e]{4}$/),
            value: z.number().int().min(0).max(0xffffffff).default(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type FontRunInput = Omit<
  z.input<typeof fontRunInputSchema>,
  "features" | "nativeMetrics"
> & {
  nativeMetrics?: Readonly<{
    em: number;
    glyphs: readonly Readonly<NativeFontMetrics["glyphs"][number]>[];
  }>;
} & { features?: readonly Readonly<{ tag: string; value?: number }>[] };
export type FontRunRequest = Readonly<
  Omit<
    z.output<typeof fontRunInputSchema>,
    "features" | "itemLength" | "css" | "nativeMetrics"
  > & {
    nativeMetrics?: ReturnType<typeof captureNativeFontMetrics>;
    css?: FontRunCss;
    itemLength: number;
    features: readonly Readonly<{ tag: string; value: number }>[];
  }
>;
export function normalizeFontRun(input: FontRunInput): FontRunRequest {
  const value = fontRunInputSchema.parse(input);
  if (value.nominal && value.direction !== "ltr" && value.direction !== "ttb")
    throw new Error(
      "Nominal font metrics require left-to-right or top-to-bottom source order.",
    );
  const end =
      value.itemOffset +
      (value.itemLength ?? value.text.length - value.itemOffset),
    boundary = (i: number) =>
      i <= 0 ||
      i >= value.text.length ||
      !(
        value.text.charCodeAt(i) >= 0xdc00 &&
        value.text.charCodeAt(i) <= 0xdfff &&
        value.text.charCodeAt(i - 1) >= 0xd800 &&
        value.text.charCodeAt(i - 1) <= 0xdbff
      );
  if (
    value.itemOffset > value.text.length ||
    end > value.text.length ||
    !boundary(value.itemOffset) ||
    !boundary(end)
  )
    throw new Error("Font run range must retain complete Unicode scalars.");
  for (const char of value.text) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff)
      throw new Error("Font run text contains an unpaired surrogate.");
  }
  return Object.freeze({
    ...value,
    ...(value.nativeMetrics
      ? { nativeMetrics: captureNativeFontMetrics(value.nativeMetrics) }
      : {}),
    ...(value.css ? { css: Object.freeze(value.css) } : {}),
    itemLength: end - value.itemOffset,
    features: Object.freeze(
      value.features.map((feature) => Object.freeze(feature)),
    ),
  });
}
const glyphSchema = z
  .object({
    glyphId: z.number().int().min(0).max(65534),
    cluster: z.number().int().nonnegative(),
    flags: z.number().int().min(0).max(7),
    xAdvance: z.number().finite(),
    yAdvance: z.number().finite(),
    xOffset: z.number().finite(),
    yOffset: z.number().finite(),
  })
  .strict();
export const fontRunResultSchema = z
  .object({
    version: z.literal(1),
    engine: z.literal("HarfBuzz 15.0.0"),
    unitsPerEm: z.number().int().min(1).max(65535),
    glyphCount: z.number().int().min(1).max(65535),
    glyphs: z.array(glyphSchema),
  })
  .strict();
export type FontRunResult = z.infer<typeof fontRunResultSchema>;
export type OwnedFontRun = Readonly<
  Omit<FontRunResult, "glyphs"> & {
    request: FontRunRequest;
    settings: string;
    glyphs: readonly Readonly<FontRunResult["glyphs"][number]>[];
  }
>;
const headerSchema = fontRunResultSchema.omit({ glyphs: true });
function assertHeader(
  header: z.infer<typeof headerSchema>,
  length: number,
  request: FontRunRequest,
  identity: { unitsPerEm: number; glyphCount: number },
) {
  if (
    header.unitsPerEm !== identity.unitsPerEm ||
    header.glyphCount !== identity.glyphCount
  )
    throw new Error("Shaped font identity differs from its retained source.");
  if ((!request.itemLength && length) || (request.itemLength && !length))
    throw new Error("Shaped glyph coverage is incomplete.");
}
function assertGlyph(
  glyph: FontRunResult["glyphs"][number],
  request: FontRunRequest,
  glyphCount: number,
  previous: number,
) {
  const cp = request.text.charCodeAt(glyph.cluster),
    prior = request.text.charCodeAt(glyph.cluster - 1);
  if (
    glyph.glyphId >= glyphCount ||
    glyph.cluster < request.itemOffset ||
    glyph.cluster >= request.itemOffset + request.itemLength ||
    (cp >= 0xdc00 && cp <= 0xdfff && prior >= 0xd800 && prior <= 0xdbff)
  )
    throw new Error("Shaped glyph or cluster is outside its original source.");
  if (
    request.direction === "rtl" || request.direction === "btt"
      ? glyph.cluster > previous
      : glyph.cluster < previous
  )
    throw new Error(
      "Shaped cluster order differs from its requested direction.",
    );
  return glyph.cluster;
}
const initialCluster = (request: FontRunRequest) =>
  request.direction === "rtl" || request.direction === "btt" ? Infinity : -1;
export function validateFontRun(
  value: unknown,
  request: FontRunRequest,
  settings: string,
  identity: { unitsPerEm: number; glyphCount: number },
): OwnedFontRun {
  const parsed = fontRunResultSchema.parse(value);
  assertHeader(parsed, parsed.glyphs.length, request, identity);
  let previous = initialCluster(request);
  for (const glyph of parsed.glyphs)
    previous = assertGlyph(glyph, request, identity.glyphCount, previous);
  return Object.freeze({
    ...parsed,
    request,
    settings,
    glyphs: Object.freeze(parsed.glyphs.map((glyph) => Object.freeze(glyph))),
  });
}

/** Typed transfer avoids cloning a large graph of mutable glyph objects. */
export function encodeFontRun(result: FontRunResult) {
  const data = new Float64Array(result.glyphs.length * 7);
  result.glyphs.forEach((g, i) =>
    data.set(
      [
        g.glyphId,
        g.cluster,
        g.flags,
        g.xAdvance,
        g.yAdvance,
        g.xOffset,
        g.yOffset,
      ],
      i * 7,
    ),
  );
  const { glyphs: _, ...header } = result;
  return { ...header, data };
}
export async function decodeFontRun(
  value: unknown,
  request: FontRunRequest,
  settings: string,
  identity: { unitsPerEm: number; glyphCount: number },
  check: () => void,
): Promise<OwnedFontRun> {
  check();
  const wire = headerSchema
    .extend({ data: z.instanceof(Float64Array) })
    .strict()
    .parse(value);
  if (wire.data.length % 7 || !(wire.data.buffer instanceof ArrayBuffer))
    throw new Error("Invalid shaped glyph transfer.");
  assertHeader(wire, wire.data.length / 7, request, identity);
  const glyphs: Readonly<FontRunResult["glyphs"][number]>[] = [],
    { data, ...header } = wire;
  let deadline = performance.now() + 2,
    previous = initialCluster(request);
  for (let i = 0; i < data.length; i += 7) {
    const glyph = glyphSchema.parse({
      glyphId: data[i],
      cluster: data[i + 1],
      flags: data[i + 2],
      xAdvance: data[i + 3],
      yAdvance: data[i + 4],
      xOffset: data[i + 5],
      yOffset: data[i + 6],
    });
    previous = assertGlyph(glyph, request, identity.glyphCount, previous);
    glyphs.push(Object.freeze(glyph));
    if ((i / 7) % 128 === 0 && performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  check();
  return Object.freeze({
    ...header,
    request,
    settings,
    glyphs: Object.freeze(glyphs),
  });
}
