import { z } from "zod";

export interface Point {
  x: number;
  y: number;
}
export interface StrokePoint extends Point {
  pressure: number;
}
export interface Rect extends Point {
  width: number;
  height: number;
}
export type SelectionOperation = "add" | "subtract" | "intersect";
export interface SelectionRegion extends Rect {
  shape: "rectangle" | "ellipse";
  operation: SelectionOperation;
}
export interface SelectionData {
  regions: SelectionRegion[];
}
export type BlendChannel = "luminance" | "red" | "green" | "blue";
export type BlendRange = [number, number, number, number];
export interface BlendIfData {
  enabled: boolean;
  channel: BlendChannel;
  source: BlendRange;
  underlying: BlendRange;
}
export interface LayerStyleData {
  blendIf: BlendIfData;
  colorOverlay: { enabled: boolean; color: string; opacity: number };
  dropShadow: {
    enabled: boolean;
    color: string;
    opacity: number;
    x: number;
    y: number;
    blur: number;
  };
}
export interface CloneTile extends Rect {
  assetId: string;
}
export interface BrushStrokeData {
  id: string;
  kind: "brush" | "pencil" | "clone";
  points: StrokePoint[];
  size: number;
  hardness: number;
  opacity: number;
  color: string;
  clip: SelectionData | null;
  tiles: CloneTile[];
}
export interface FillData {
  id: string;
  kind: "fill";
  color: string;
  opacity: number;
  bounds: Rect;
  clip: SelectionData | null;
  erase: boolean;
}
export type PaintOperationData = BrushStrokeData | FillData;
export interface PathAnchor extends Point {
  in: Point;
  out: Point;
}
export interface VectorPathData {
  id: string;
  points: PathAnchor[];
  closed: boolean;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

const coordinate = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const dimension = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const identifier = z.string().min(1).max(240);
const unit = z.number().finite().min(0).max(1);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const rect = z
  .object({ x: coordinate, y: coordinate, width: dimension, height: dimension })
  .strict();
export const selectionSchema: z.ZodType<SelectionData> = z
  .object({
    regions: z
      .array(
        rect.extend({
          shape: z.enum(["rectangle", "ellipse"]),
          operation: z.enum(["add", "subtract", "intersect"]),
        }),
      )
      .max(128),
  })
  .strict();
export const blendRangeSchema = z
  .tuple([
    z.number().min(0).max(255),
    z.number().min(0).max(255),
    z.number().min(0).max(255),
    z.number().min(0).max(255),
  ])
  .refine(
    (r) => r[0] <= r[1] && r[1] <= r[2] && r[2] <= r[3],
    "Blend If handles must be in ascending order.",
  );
export const blendIfSchema: z.ZodType<BlendIfData> = z
  .object({
    enabled: z.boolean(),
    channel: z.enum(["luminance", "red", "green", "blue"]),
    source: blendRangeSchema,
    underlying: blendRangeSchema,
  })
  .strict();
export const styleSchema: z.ZodType<LayerStyleData> = z
  .object({
    blendIf: blendIfSchema,
    colorOverlay: z
      .object({ enabled: z.boolean(), color: colorSchema, opacity: unit })
      .strict(),
    dropShadow: z
      .object({
        enabled: z.boolean(),
        color: colorSchema,
        opacity: unit,
        x: z.number().min(-256).max(256),
        y: z.number().min(-256).max(256),
        blur: z.number().min(0).max(128),
      })
      .strict(),
  })
  .strict();
export const paintOperationSchema: z.ZodType<PaintOperationData> =
  z.discriminatedUnion("kind", [
    z
      .object({
        id: identifier,
        kind: z.enum(["brush", "pencil", "clone"]),
        points: z
          .array(point.extend({ pressure: unit }))
          .min(1)
          .max(20000),
        size: z.number().min(0.1).max(2048),
        hardness: unit,
        opacity: unit,
        color: colorSchema,
        clip: selectionSchema.nullable(),
        tiles: z.array(rect.extend({ assetId: identifier })).max(4096),
      })
      .strict()
      .refine(
        (stroke) => stroke.kind !== "clone" || stroke.tiles.length > 0,
        "Clone strokes require a source image.",
      ),
    z
      .object({
        id: identifier,
        kind: z.literal("fill"),
        color: colorSchema,
        opacity: unit,
        bounds: rect,
        clip: selectionSchema.nullable(),
        erase: z.boolean(),
      })
      .strict(),
  ]);
export const pathSchema = z
  .object({
    id: identifier,
    points: z
      .array(point.extend({ in: point, out: point }))
      .min(1)
      .max(20000),
    closed: z.boolean(),
    fill: colorSchema.nullable(),
    stroke: colorSchema.nullable(),
    strokeWidth: z.number().min(0).max(1024),
  })
  .strict();
export function defaultStyle(): LayerStyleData {
  return {
    blendIf: {
      enabled: false,
      channel: "luminance",
      source: [0, 0, 255, 255],
      underlying: [0, 0, 255, 255],
    },
    colorOverlay: { enabled: false, color: "#d5e79b", opacity: 1 },
    dropShadow: {
      enabled: false,
      color: "#000000",
      opacity: 0.45,
      x: 8,
      y: 8,
      blur: 12,
    },
  };
}
export function translateSelection(
  selection: SelectionData | null | undefined,
  x: number,
  y: number,
): SelectionData | null {
  return selection
    ? {
        regions: selection.regions.map((r) => ({
          ...r,
          x: r.x + x,
          y: r.y + y,
        })),
      }
    : null;
}
export function containsSelection(
  selection: SelectionData | null,
  x: number,
  y: number,
): boolean {
  if (!selection) return true;
  let inside = false;
  for (const region of selection.regions) {
    const hit =
      region.shape === "rectangle"
        ? x >= region.x &&
          x <= region.x + region.width &&
          y >= region.y &&
          y <= region.y + region.height
        : ((x - region.x - region.width / 2) / (region.width / 2)) ** 2 +
            ((y - region.y - region.height / 2) / (region.height / 2)) ** 2 <=
          1;
    inside =
      region.operation === "add"
        ? inside || hit
        : region.operation === "subtract"
          ? inside && !hit
          : inside && hit;
  }
  return inside;
}
export function strokeBounds(stroke: PaintOperationData): Rect {
  if (stroke.kind === "fill") return { ...stroke.bounds };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of stroke.points) {
    const r = (stroke.size * Math.max(0.05, p.pressure)) / 2 + 1;
    left = Math.min(left, p.x - r);
    top = Math.min(top, p.y - r);
    right = Math.max(right, p.x + r);
    bottom = Math.max(bottom, p.y + r);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function pathBounds(path: VectorPathData): Rect {
  // The control-point hull contains the entire Bézier curve.
  const points = path.points.flatMap((p) => [p, p.in, p.out]);
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  const r = path.strokeWidth / 2;
  return {
    x: left - r,
    y: top - r,
    width: Math.max(1, right - left + r * 2),
    height: Math.max(1, bottom - top + r * 2),
  };
}
