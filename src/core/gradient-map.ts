import { z } from "zod";

export interface GradientStop { position: number; color: string }
export interface GradientMapAdjustmentData {
  kind: "gradient-map";
  stops: GradientStop[];
  reverse: boolean;
}

export const gradientMapAdjustmentSchema = z.object({
  kind: z.literal("gradient-map"),
  stops: z.array(z.object({
    position: z.number().finite().min(0).max(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex color."),
  }).strict()).min(2).max(32).refine(
    stops => stops.every((stop, i) => i === 0 || stop.position > stops[i - 1].position),
    "Gradient stops must have strictly increasing positions.",
  ),
  reverse: z.boolean(),
}).strict();

export function defaultGradientMapAdjustment(): GradientMapAdjustmentData {
  return { kind: "gradient-map", stops: [
    { position: 0, color: "#000000" }, { position: 1, color: "#ffffff" },
  ], reverse: false };
}

/** Four values per stop: position, encoded red, green, blue, all normalized. */
export function packGradientStops(stops: readonly GradientStop[]): number[] {
  return stops.flatMap(stop => [stop.position, ...[1, 3, 5].map(
    offset => parseInt(stop.color.slice(offset, offset + 2), 16) / 255,
  )]);
}
