import { yieldTask } from "./task-yield";
import { z } from "zod";
import { isImmutable } from "./immutable";
import { layerCompSchema, type LayerCompData } from "./layer-comps";
import { smartFiltersSchema } from "./smart/filters";
import { ComponentRegistry } from "./smart/manager";
import type {
  SmartComponentDefinition,
  SmartObjectInstanceData,
} from "./smart/types";
import { TONE_LIMITS } from "./tone";
import { guidesSchema, type GuideData } from "./guides";
import { affineSchema } from "./transform-schema";
import type { AffineData } from "./affine";
import { adjustmentSchema, defaultCurvesAdjustment } from "./adjustments";
import type { AdjustmentData } from "./adjustments";
import { layerMaskSchema } from "./masks";
import type { LayerMaskData } from "./masks";
import { authoredMetadataSchema } from "./metadata";
import type { AuthoredMetadataData } from "./metadata";
import {
  rasterErasureSchema,
  styleSchema,
  selectionSchema,
  paintOperationSchema,
  pathSchema,
  PATH_POINT_LIMIT,
} from "./drawing";
import type {
  LayerStyleData,
  SelectionData,
  PaintOperationData,
  VectorPathData,
} from "./drawing";
export const SCHEMA_VERSION = 16;
export const MAX_LAYERS = 64;
// Document geometry is independent of renderer allocation budgets.
export const MAX_COORDINATE = Number.MAX_SAFE_INTEGER;
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export interface ToneEffectData {
  id: string;
  kind: "tone";
  enabled: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
}

export interface LayerBaseData {
  transform?: AffineData;
  mask?: LayerMaskData | null;
  metadata?: AuthoredMetadataData | null;
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  fillOpacity?: number;
  styles?: LayerStyleData;
  blendMode: BlendMode;
  x: number;
  y: number;
}

export interface RasterLayerData extends LayerBaseData {
  kind: "raster";
  assetId: string;
  width: number;
  height: number;
  effects: ToneEffectData[];
  erasures?: import("./drawing").RasterErasureData[];
}

export interface GroupLayerData extends LayerBaseData {
  kind: "group";
  children: LayerData[];
}

export interface PaintLayerData extends LayerBaseData {
  kind: "paint";
  strokes: PaintOperationData[];
}
export interface VectorLayerData extends LayerBaseData {
  kind: "vector";
  paths: VectorPathData[];
}
export interface TextLayerData extends LayerBaseData {
  kind: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing?: number;
  fontWeight?: string;
  fontStyle?: "normal" | "italic";
  direction?: "ltr" | "rtl";
  width: number;
  height: number;
}
export interface AdjustmentLayerData extends LayerBaseData {
  kind: "adjustment";
  adjustment: AdjustmentData;
}
export type LayerData =
  | RasterLayerData
  | GroupLayerData
  | PaintLayerData
  | VectorLayerData
  | TextLayerData
  | AdjustmentLayerData
  | SmartObjectInstanceData;

// The editor DOM is serializable data, independent of React, Canvas, and WASM.
// Children are stored back-to-front. IDs, not object references, identify nodes.
export interface DocumentData {
  schemaVersion:
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | typeof SCHEMA_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  colorSpace: "srgb";
  selection?: SelectionData | null;
  guides?: GuideData[];
  components?: SmartComponentDefinition[];
  layerComps?: LayerCompData[];
  children: LayerData[];
}

export function id(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Opaque-origin workers do not expose the secure-context-only randomUUID API.
  // getRandomValues remains available; preserve UUIDv4 entropy and shape.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createDocument(
  name = "Untitled",
  width = 1600,
  height = 1200,
): DocumentData {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id(),
    name,
    width,
    height,
    colorSpace: "srgb",
    children: [],
  };
}

export function base(name: string): LayerBaseData {
  return {
    id: id(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: 0,
    y: 0,
  };
}

export function createRaster(
  name: string,
  assetId: string,
  width: number,
  height: number,
): RasterLayerData {
  return { ...base(name), kind: "raster", assetId, width, height, effects: [] };
}

export function createGroup(name = "Group"): GroupLayerData {
  return { ...base(name), kind: "group", children: [] };
}

let measureCtx:
  CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

export function measureTextBounds(
  text: string,
  fontSize: number,
  fontFamily: string,
  lineHeight: number,
  options: {
    letterSpacing?: number;
    fontWeight?: string;
    fontStyle?: "normal" | "italic";
  } = {},
): { width: number; height: number } {
  const lines = text.split("\n");
  const lineHeightPx = fontSize * lineHeight;
  const height = Math.max(1, Math.round(lines.length * lineHeightPx));
  let maxWidth = 0;

  if (!measureCtx) {
    if (typeof OffscreenCanvas !== "undefined") {
      try {
        const offscreen = new OffscreenCanvas(1, 1);
        measureCtx = offscreen.getContext("2d");
      } catch {}
    } else if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        measureCtx = canvas.getContext("2d");
      } catch {}
    }
  }

  const weight = options.fontWeight ?? "normal";
  const style = options.fontStyle ?? "normal";
  const letterSpacing = options.letterSpacing ?? 0;

  if (measureCtx) {
    try {
      measureCtx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`;
      if ("letterSpacing" in measureCtx) {
        (measureCtx as any).letterSpacing = `${letterSpacing}px`;
      }
      for (const line of lines) {
        const metrics = measureCtx.measureText(line);
        const spacingAdjustment =
          "letterSpacing" in measureCtx
            ? 0
            : Math.max(0, line.length - 1) * letterSpacing;
        maxWidth = Math.max(maxWidth, metrics.width + spacingAdjustment);
      }
    } catch {
      maxWidth = 0;
    }
  }

  if (maxWidth === 0) {
    for (const line of lines) {
      maxWidth = Math.max(
        maxWidth,
        (line.length || 1) * fontSize * 0.6 +
          Math.max(0, line.length - 1) * letterSpacing,
      );
    }
  }

  const width = Math.max(1, Math.round(maxWidth));
  return { width, height };
}

export function createText(
  name: string,
  text = "Text",
  options: {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    align?: "left" | "center" | "right";
    lineHeight?: number;
    letterSpacing?: number;
    fontWeight?: string;
    fontStyle?: "normal" | "italic";
    direction?: "ltr" | "rtl";
  } = {},
): TextLayerData {
  const fontSize = options.fontSize ?? 32;
  const fontFamily = options.fontFamily ?? "sans-serif";
  const color = options.color ?? "#ffffff";
  const align = options.align ?? "left";
  const lineHeight = options.lineHeight ?? 1.2;
  const letterSpacing = options.letterSpacing;
  const fontWeight = options.fontWeight;
  const fontStyle = options.fontStyle;
  const direction = options.direction;
  const bounds = measureTextBounds(text, fontSize, fontFamily, lineHeight, {
    letterSpacing,
    fontWeight,
    fontStyle,
  });
  return {
    ...base(name),
    kind: "text",
    text,
    fontSize,
    fontFamily,
    color,
    align,
    lineHeight,
    letterSpacing,
    fontWeight,
    fontStyle,
    direction,
    width: bounds.width,
    height: bounds.height,
  };
}

export function createAdjustmentLayer(
  name = "Adjustment",
  adjustment: AdjustmentData = defaultCurvesAdjustment(),
): AdjustmentLayerData {
  return {
    ...base(name),
    kind: "adjustment",
    adjustment,
  };
}

export function allLayers(children: LayerData[]): LayerData[] {
  return children.flatMap((node) =>
    node.kind === "group" ? [node, ...allLayers(node.children)] : [node],
  );
}

export function findLayer(
  document: DocumentData,
  layerId: string | null,
): LayerData | undefined {
  return allLayers(document.children).find((node) => node.id === layerId);
}

export function findContainer(
  children: LayerData[],
  layerId: string,
): LayerData[] | undefined {
  if (children.some((node) => node.id === layerId)) return children;
  for (const node of children) {
    if (node.kind === "group") {
      const result = findContainer(node.children, layerId);
      if (result) return result;
    }
  }
}

export function findParent(
  nodes: LayerData[],
  id: string,
  parent: string | null = null,
): string | null | undefined {
  for (const node of nodes) {
    if (node.id === id) return parent;
    if (node.kind === "group") {
      const result = findParent(node.children, id, node.id);
      if (result !== undefined) return result;
    }
  }
}

export function isLocked(document: DocumentData, layerId: string): boolean {
  const walk = (
    nodes: LayerData[],
    parentLocked: boolean,
  ): boolean | undefined => {
    for (const node of nodes) {
      const locked = parentLocked || node.locked;
      if (node.id === layerId) return locked;
      if (node.kind === "group") {
        const found = walk(node.children, locked);
        if (found !== undefined) return found;
      }
    }
  };
  return walk(document.children, false) ?? false;
}

export function toneOf(layer: RasterLayerData): ToneEffectData {
  return (
    layer.effects.find((effect) => effect.kind === "tone") ?? {
      id: `tone-${layer.id}`,
      kind: "tone",
      enabled: true,
      exposure: 0,
      contrast: 0,
      saturation: 0,
    }
  );
}

// Import and command validation share the same invariants. Unknown node/effect
// types fail explicitly instead of silently disappearing on load or export.
const validatedSelections = new WeakSet<object>();
const validatedDrawing = new WeakMap<object, Set<object>>();
/** Validation may be reused only for recursively frozen store-owned values. */
function validateDrawing<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  if (isImmutable(value)) {
    let schemas = validatedDrawing.get(value);
    if (!schemas?.has(schema)) {
      schema.parse(value);
      if (!schemas) { schemas = new Set(); validatedDrawing.set(value, schemas); }
      schemas.add(schema);
    }
    return value as T;
  }
  return schema.parse(value);
}

// Validation-only schema: reuse proofs for immutable anchors in changing paths.
// Mutable points still pass the exact public point schema on every invocation.
const validationPathSchema = pathSchema.extend({
  points: z.array(z.custom<z.infer<typeof pathSchema.shape.points.element>>((value) => {
    validateDrawing(pathSchema.shape.points.element, value);
    return true;
  })).min(1).max(PATH_POINT_LIMIT),
});

export function validateDocument(value: unknown, checkComponents = true): asserts value is DocumentData {
  for (const _ of documentValidationSteps(value, checkComponents)) { /* synchronous contract */ }
}

/** @internal Same validator, task boundaries only between complete checks of stable data. */
export async function validateDocumentCooperatively(value: unknown): Promise<void> {
  if (!isImmutable(value)) throw new Error("Cooperative validation requires immutable model data.");
  let deadline = performance.now() + 2;
  for (const _ of documentValidationSteps(value, true)) {
    if (performance.now() >= deadline) {
      await yieldTask();
      deadline = performance.now() + 2;
    }
  }
}

function* documentValidationSteps(value: unknown, checkComponents: boolean): Generator<void> {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const number = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const text = (v: unknown) =>
    typeof v === "string" && v.length > 0 && v.length <= 240;
  const dimension = (v: unknown) =>
    number(v, 1, MAX_COORDINATE) && Number.isSafeInteger(v);
  if (
    !record(value) ||
    (value.schemaVersion !== 1 &&
      value.schemaVersion !== 2 &&
      value.schemaVersion !== 3 &&
      value.schemaVersion !== 4 &&
      value.schemaVersion !== 5 &&
      value.schemaVersion !== 6 &&
      value.schemaVersion !== 7 &&
      value.schemaVersion !== 8 &&
      value.schemaVersion !== 9 &&
      value.schemaVersion !== 10 &&
      value.schemaVersion !== 11 &&
      value.schemaVersion !== 12 &&
      value.schemaVersion !== 13 &&
      value.schemaVersion !== 14 &&
      value.schemaVersion !== 15 &&
      value.schemaVersion !== 16) ||
    !text(value.id) ||
    !text(value.name) ||
    !dimension(value.width) ||
    !dimension(value.height) ||
    value.colorSpace !== "srgb"
  ) {
    throw new Error(
      "Invalid document. Use a supported schema version (1–16), sRGB, and positive, safely representable integer dimensions.",
    );
  }
  const checkSelection = (selection: unknown) => {
    if (selection == null) return;
    const cached = isImmutable(selection) && validatedSelections.has(selection);
    const parsed = cached ? selection as import("./drawing").SelectionData : selectionSchema.parse(selection);
    if (isImmutable(selection)) validatedSelections.add(selection);
    if (Number(value.schemaVersion) < 16 && parsed.regions.some(r => r.shape === "pixels")) throw new Error("Pixel selections require schema version 16.");
    if (
      Number(value.schemaVersion) < 5 &&
      parsed.regions.some((region) => region.transform !== undefined)
    )
      throw new Error(
        "Affine selection regions require document schema version 5 or later.",
      );
  };
  if (value.guides !== undefined) {
    if (Number(value.schemaVersion) < 7)
      throw new Error("Document guides require schema version 7.");
    guidesSchema.parse(value.guides);
  }
  if (value.layerComps !== undefined) {
    if (Number(value.schemaVersion) < 14)
      throw new Error("Layer comps require schema version 14.");
    if (!Array.isArray(value.layerComps))
      throw new Error("Invalid layer comps.");
    const compIds = new Set<string>();
    for (const entry of value.layerComps) {
      const comp = layerCompSchema.parse(entry);
      if (comp.documentId !== value.id || compIds.has(comp.id))
        throw new Error("Invalid layer comp ownership or duplicate identity.");
      compIds.add(comp.id);
    }
  }
  checkSelection(value.selection);
  const ids = new Set<string>();
  let count = 0;
  const walk = function* (nodes: unknown, depth: number): Generator<void> {
    if (!Array.isArray(nodes) || depth > 8)
      throw new Error("Invalid layer tree (maximum nesting: 8).");
    for (const node of nodes) {
      if (
        !record(node) ||
        !text(node.id) ||
        ids.has(node.id as string) ||
        ++count > MAX_LAYERS ||
        !text(node.name) ||
        typeof node.visible !== "boolean" ||
        typeof node.locked !== "boolean" ||
        !number(node.opacity, 0, 1) ||
        !BLEND_MODES.includes(node.blendMode as BlendMode) ||
        !number(node.x, -MAX_COORDINATE, MAX_COORDINATE) ||
        !number(node.y, -MAX_COORDINATE, MAX_COORDINATE)
      ) {
        throw new Error(
          "Invalid layer properties, duplicate IDs, or more than 64 layers.",
        );
      }
      if (node.transform !== undefined) {
        if (Number(value.schemaVersion) < 6)
          throw new Error("Layer transforms require schema version 6.");
        const transform = affineSchema.parse(node.transform);
        if (transform.e !== 0 || transform.f !== 0)
          throw new Error("Layer transform translation must use x/y.");
      }
      if (node.mask != null) {
        if ((value as any).schemaVersion < 3)
          throw new Error(
            "Layer masks require document schema version 3 or later.",
          );
        const mask = layerMaskSchema.parse(node.mask);
        if (mask.basis && Number(value.schemaVersion) < 6)
          throw new Error("Mask bases require schema version 6.");
        if (mask.kind === "selection") checkSelection(mask.selection);
        for (const paint of mask.strokes ?? [])
          checkSelection(paint.stroke.clip);
      }
      if (node.metadata != null) {
        if (value.schemaVersion === 1)
          throw new Error(
            "Authored metadata requires document schema version 2 or later.",
          );
        authoredMetadataSchema.parse(node.metadata);
      }
      ids.add(node.id as string);
      if (node.fillOpacity !== undefined && !number(node.fillOpacity, 0, 1))
        throw new Error("Fill opacity must be between 0 and 1.");
      if (node.styles !== undefined) styleSchema.parse(node.styles);
      if (node.kind === "group") yield* walk(node.children, depth + 1);
      else if (node.kind === "smart-object") {
        if (Number(value.schemaVersion) < 10)
          throw new Error("Smart objects require schema version 10.");
        if (node.filterMask != null) {
          if (Number(value.schemaVersion) < 12)
            throw new Error("Smart-filter masks require schema version 12.");
          const mask = layerMaskSchema.parse(node.filterMask);
          if (mask.kind === "selection") checkSelection(mask.selection);
          for (const paint of mask.strokes ?? []) checkSelection(paint.stroke.clip);
        }
        if (node.smartFilters !== undefined) {
          if (Number(value.schemaVersion) < 11)
            throw new Error("Smart filters require schema version 11.");
          smartFiltersSchema.parse(node.smartFilters);
        }
        if (
          !text(node.componentId) ||
          !number(node.width, 1, MAX_COORDINATE) ||
          !number(node.height, 1, MAX_COORDINATE)
        )
          throw new Error("Invalid smart-object instance.");
      } else if (node.kind === "raster") {
        if (
          !text(node.assetId) ||
          !number(node.width, 1, MAX_COORDINATE) ||
          !number(node.height, 1, MAX_COORDINATE) ||
          !Array.isArray(node.effects) ||
          node.effects.length > 8
        )
          throw new Error("Invalid image layer.");
        if (node.erasures !== undefined) {
          if (Number(value.schemaVersion) < 16 || !Array.isArray(node.erasures) || node.erasures.length > 2048) throw new Error("Invalid raster erasures; schema version 16 is required.");
          for (const entry of node.erasures) {
            const { stroke } = validateDrawing(rasterErasureSchema, entry);
            checkSelection(stroke.clip);
            yield;
          }
        }
        const effectIds = new Set<string>();
        for (const effect of node.effects) {
          if (
            !record(effect) ||
            effect.kind !== "tone" ||
            !text(effect.id) ||
            effectIds.has(effect.id as string) ||
            typeof effect.enabled !== "boolean" ||
            !number(
              effect.exposure,
              TONE_LIMITS.exposure.min,
              TONE_LIMITS.exposure.max,
            ) ||
            !number(
              effect.contrast,
              TONE_LIMITS.contrast.min,
              TONE_LIMITS.contrast.max,
            ) ||
            !number(
              effect.saturation,
              TONE_LIMITS.saturation.min,
              TONE_LIMITS.saturation.max,
            )
          ) {
            throw new Error("Invalid or unsupported image adjustment.");
          }
          effectIds.add(effect.id as string);
        }
      } else if (node.kind === "paint" || node.kind === "vector") {
        const entries = node.kind === "paint" ? node.strokes : node.paths;
        if (!Array.isArray(entries) || entries.length > 2048)
          throw new Error(
            "A drawing layer supports up to 2048 strokes or paths.",
          );
        const entryIds = new Set<string>();
        for (const entry of entries) {
          const parsed =
            node.kind === "paint"
              ? validateDrawing(paintOperationSchema, entry)
              : validateDrawing(validationPathSchema, entry);
          if ("clip" in parsed) checkSelection(parsed.clip);
          if (entryIds.has(parsed.id))
            throw new Error("Duplicate drawing object ID.");
          entryIds.add(parsed.id);
          yield;
        }
      } else if (node.kind === "text") {
        if (
          typeof node.text !== "string" ||
          node.text.length > 10000 ||
          !number(node.fontSize, 1, MAX_COORDINATE) ||
          !text(node.fontFamily) ||
          !text(node.color) ||
          !["left", "center", "right"].includes(node.align as string) ||
          !number(node.lineHeight, 0.5, 10) ||
          !number(node.width, 1, MAX_COORDINATE) ||
          !number(node.height, 1, MAX_COORDINATE) ||
          (node.letterSpacing !== undefined &&
            !number(node.letterSpacing, -50, 500)) ||
          (node.fontWeight !== undefined && !text(node.fontWeight)) ||
          (node.fontStyle !== undefined &&
            !["normal", "italic"].includes(node.fontStyle as string)) ||
          (node.direction !== undefined &&
            !["ltr", "rtl"].includes(node.direction as string))
        ) {
          throw new Error("Invalid text layer.");
        }
      } else if (node.kind === "adjustment") {
        if ((value as any).schemaVersion < 4)
          throw new Error(
            "Adjustment layers require document schema version 4 or later.",
          );
        if (!record(node.adjustment))
          throw new Error("Invalid adjustment layer.");
        if (node.adjustment.kind === "tonal" && Number(value.schemaVersion) < 8)
          throw new Error("Tonal strokes require schema version 8.");
        if (node.adjustment.kind === "patch" && Number(value.schemaVersion) < 9)
          throw new Error("Patch adjustments require schema version 9.");
        if (node.adjustment.kind === "hsl" && Number(value.schemaVersion) < 15)
          throw new Error("HSL adjustments require schema version 15.");
        const adjustment = adjustmentSchema.parse(node.adjustment);
        if (adjustment.kind === "tonal")
          for (const stroke of adjustment.strokes) checkSelection(stroke.brush.clip);
      } else throw new Error("Unsupported layer type.");
      yield;
    }
  };
  yield* walk(value.children, 0);
  if (value.components !== undefined && Number(value.schemaVersion) < 10)
    throw new Error("Component definitions require schema version 10.");
  if (checkComponents) {
    if (value.components !== undefined && !Array.isArray(value.components))
      throw new Error("Invalid component definitions.");
    const registry = new ComponentRegistry(
      (value.components ?? []) as SmartComponentDefinition[],
    );
    if (
      Number(value.schemaVersion) < 13 &&
      registry
        .values()
        .some(
          (definition) =>
            definition.source.kind === "asset" && definition.source.link,
        )
    )
      throw new Error("Linked image files require schema version 13.");
    for (const layer of allLayers(value.children as LayerData[]))
      if (layer.kind === "smart-object") registry.get(layer.componentId);
  }
}

export function referencedAssets(document: DocumentData): Set<string> {
  const assets = document.components
    ? new ComponentRegistry(document.components).assetIds()
    : new Set<string>();
  for (const layer of allLayers(document.children)) {
    if (layer.kind === "raster") assets.add(layer.assetId);
    if (layer.kind === "adjustment" && layer.adjustment.kind === "patch")
      assets.add(layer.adjustment.assetId);
    if (layer.kind === "smart-object" && layer.filterMask?.kind === "bitmap")
      assets.add(layer.filterMask.assetId);
    if (layer.mask?.kind === "bitmap") assets.add(layer.mask.assetId);
    if (layer.kind === "paint")
      for (const stroke of layer.strokes)
        if (stroke.kind === "clone")
          for (const tile of stroke.tiles) assets.add(tile.assetId);
  }
  return assets;
}
