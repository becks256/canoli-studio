import { pixelCoverageSchema, coverageAt, type PixelCoverage } from "./pixel-selection";
import { AffineTransform } from "./affine";
import type { AffineData } from "./affine";
import { affineSchema } from "./transform-schema";
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
  transform?: AffineData;
  shape: "rectangle" | "ellipse" | "pixels";
  coverage?: PixelCoverage;
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
  kind: "brush" | "pencil" | "clone" | "eraser";
  points: StrokePoint[];
  size: number;
  hardness: number;
  opacity: number;
  flow?: number;
  spacing?: number;
  pressureSize?: boolean;
  pressureOpacity?: boolean;
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
          shape: z.enum(["rectangle", "ellipse", "pixels"]),
          coverage: pixelCoverageSchema.optional(),
          operation: z.enum(["add", "subtract", "intersect"]),
          transform: affineSchema.optional(),
        }).refine(r => (r.shape === "pixels") === !!r.coverage, "Pixel regions require coverage; geometric regions must not contain it."),
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
        kind: z.enum(["brush", "pencil", "clone", "eraser"]),
        points: z
          .array(point.extend({ pressure: unit }))
          .min(1)
          .max(20000),
        size: z.number().min(0.1).max(2048),
        hardness: unit,
        opacity: unit,
        flow: unit.optional(),
        spacing: z.number().min(0.01).max(10).optional(),
        pressureSize: z.boolean().optional(),
        pressureOpacity: z.boolean().optional(),
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
export const PATH_POINT_LIMIT = 20000;
export const pathSchema = z
  .object({
    id: identifier,
    points: z
      .array(point.extend({ in: point, out: point }))
      .min(1)
      .max(PATH_POINT_LIMIT),
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
  return transformSelection(selection, AffineTransform.translation(x, y));
}

export function selectionRegionTransform(
  region: SelectionRegion,
): AffineTransform {
  return region.transform
    ? AffineTransform.fromJSON(region.transform)
    : new AffineTransform();
}

export function transformSelection(
  selection: SelectionData | null | undefined,
  transform: AffineTransform,
): SelectionData | null {
  transform.inverse();
  if (!selection) return null;
  return selectionSchema.parse({
    regions: selection.regions.map((region) => {
      // Preserve the compact translation-only representation for old callers.
      if (
        !region.transform &&
        transform.a === 1 &&
        transform.b === 0 &&
        transform.c === 0 &&
        transform.d === 1
      )
        return {
          ...region,
          x: region.x + transform.e,
          y: region.y + transform.f,
        };
      return {
        ...region,
        transform: transform
          .multiply(selectionRegionTransform(region))
          .toJSON(),
      };
    }),
  });
}

export function containsSelection(
  selection: SelectionData | null,
  x: number,
  y: number,
): boolean {
  if (!selection) return true;
  let inside = false;
  for (const region of selection.regions) {
    const point = selectionRegionTransform(region).inverse().point({ x, y });
    const sx = point.x,
      sy = point.y;
    const hit =
      region.shape === "pixels"
        ? coverageAt(region.coverage!, (sx-region.x)*region.coverage!.width/region.width, (sy-region.y)*region.coverage!.height/region.height) > 0
        : region.shape === "rectangle"
        ? sx >= region.x &&
          sx <= region.x + region.width &&
          sy >= region.y &&
          sy <= region.y + region.height
        : ((sx - region.x - region.width / 2) / (region.width / 2)) ** 2 +
            ((sy - region.y - region.height / 2) / (region.height / 2)) ** 2 <=
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
    const r =
      (stroke.size *
        (stroke.pressureSize === false ? 1 : Math.max(0.05, p.pressure))) /
        2 +
      1;
    left = Math.min(left, p.x - r);
    top = Math.min(top, p.y - r);
    right = Math.max(right, p.x + r);
    bottom = Math.max(bottom, p.y + r);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function pathBounds(path: VectorPathData): Rect {
  // The control-point hull contains the entire Bézier curve.
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const p of path.points) {
    left = Math.min(left, p.x, p.in.x, p.out.x);
    top = Math.min(top, p.y, p.in.y, p.out.y);
    right = Math.max(right, p.x, p.in.x, p.out.x);
    bottom = Math.max(bottom, p.y, p.in.y, p.out.y);
  }
  const r = path.strokeWidth / 2;
  return {
    x: left - r,
    y: top - r,
    width: Math.max(1, right - left + r * 2),
    height: Math.max(1, bottom - top + r * 2),
  };
}

/** Capture the layer geometry so erasure follows later nonuniform raster resizing. */
export interface RasterErasureData { width: number; height: number; stroke: PaintOperationData }
export const rasterErasureSchema: z.ZodType<RasterErasureData> = z.object({
  width: dimension, height: dimension,
  stroke: paintOperationSchema.refine(stroke => stroke.kind === 'eraser' || (stroke.kind === 'fill' && stroke.erase), 'Raster erasure requires an eraser or clear operation.'),
}).strict();
