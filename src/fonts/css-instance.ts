import { z } from "zod";
import {
  parseFontVariations,
  formatFontVariations,
} from "../core/font-variations";
import type { FontDescriptors } from "./types";
/** Already resolved native face request, not a new authored text property. */
export const fontRunCssSchema = z
  .object({
    weight: z.number().finite().min(1).max(1000),
    width: z.number().finite().positive(),
    style: z.enum(["normal", "italic", "oblique"]),
    styleAxis: z.enum(["ital", "slnt", "none"]).optional(),
    opticalSize: z.number().finite().positive().optional(),
  })
  .strict();
export type FontRunCss = Readonly<z.infer<typeof fontRunCssSchema>>;
export interface FontAxisRange {
  tag: string;
  min: number;
  max: number;
}
/** CSS matching precedes explicit source-face variation settings. Unrelated
 * axes retain the original font default. A captured native optical size applies
 * only to a declared opsz axis, before explicit source-face overrides. */
export function resolveFontRunSettings(
  axes: readonly FontAxisRange[],
  settings: string,
  css?: FontRunCss,
): string {
  if (!css) return settings;
  const request = fontRunCssSchema.parse(css),
    ranges = new Map(axes.map((axis) => [axis.tag, axis])),
    values = new Map<string, number>();
  const put = (tag: string, value: number) => {
    const axis = ranges.get(tag);
    if (axis) values.set(tag, Math.max(axis.min, Math.min(axis.max, value)));
  };
  put("wght", request.weight);
  put("wdth", request.width);
  if (request.opticalSize !== undefined) put("opsz", request.opticalSize);
  const axis =
    request.styleAxis ??
    (request.style === "oblique" && ranges.has("slnt")
      ? "slnt"
      : ranges.has("ital")
        ? "ital"
        : "slnt");
  if (axis !== "none")
    put(axis, request.style === "normal" ? 0 : axis === "ital" ? 1 : -14);
  for (const axis of parseFontVariations(settings)) put(axis.tag, axis.value);
  return formatFontVariations(
    [...values].map(([tag, value]) => ({ tag, value })),
  );
}
export const CSS_FONT_WIDTHS: Readonly<Record<string, number>> = Object.freeze({
  "ultra-condensed": 50,
  "extra-condensed": 62.5,
  condensed: 75,
  "semi-condensed": 87.5,
  normal: 100,
  "semi-expanded": 112.5,
  expanded: 125,
  "extra-expanded": 150,
  "ultra-expanded": 200,
});
/** Resolve the source's closest declared style and clamp to the actual native
 * descriptor before the independent source-font axis range clamp. */
export function selectNativeFontInstance(
  input: FontRunCss,
  descriptors: readonly Readonly<FontDescriptors>[],
): FontRunCss {
  const css = fontRunCssSchema.parse(input),
    order =
      css.style === "normal"
        ? ["normal", "oblique", "italic"]
        : css.style === "italic"
          ? ["italic", "oblique", "normal"]
          : ["oblique", "italic", "normal"];
  const descriptor = order
    .map((style) => descriptors.find((d) => d.style === style))
    .find(Boolean);
  if (!descriptor)
    throw new Error("The native font has no matching descriptor.");
  const weights = descriptor.weight.split(" ").map(Number),
    widths = descriptor.stretch.split(" ").map((n) => Number(n.slice(0, -1))),
    clamp = (value: number, range: number[]) =>
      Math.max(range[0], Math.min(range.at(-1)!, value));
  return Object.freeze(
    fontRunCssSchema.parse({
      weight: clamp(css.weight, weights),
      width: clamp(css.width, widths),
      style: descriptor.style,
      ...(css.opticalSize === undefined
        ? {}
        : { opticalSize: css.opticalSize }),
    }),
  );
}
