import {
  styleSchema,
  selectionSchema,
  paintOperationSchema,
  pathSchema,
} from "./drawing";
import type {
  LayerStyleData,
  SelectionData,
  PaintOperationData,
  VectorPathData,
} from "./drawing";
export const SCHEMA_VERSION = 1;
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
  width: number;
  height: number;
}
export type LayerData =
  | RasterLayerData
  | GroupLayerData
  | PaintLayerData
  | VectorLayerData
  | TextLayerData;

// The editor DOM is serializable data, independent of React, Canvas, and WASM.
// Children are stored back-to-front. IDs, not object references, identify nodes.
export interface DocumentData {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  colorSpace: "srgb";
  selection?: SelectionData | null;
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
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;

export function measureTextBounds(
  text: string,
  fontSize: number,
  fontFamily: string,
  lineHeight: number,
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

  if (measureCtx) {
    try {
      measureCtx.font = `${fontSize}px ${fontFamily}`;
      for (const line of lines) {
        const metrics = measureCtx.measureText(line);
        maxWidth = Math.max(maxWidth, metrics.width);
      }
    } catch {
      maxWidth = 0;
    }
  }

  if (maxWidth === 0) {
    for (const line of lines) {
      maxWidth = Math.max(maxWidth, (line.length || 1) * fontSize * 0.6);
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
  } = {},
): TextLayerData {
  const fontSize = options.fontSize ?? 32;
  const fontFamily = options.fontFamily ?? "sans-serif";
  const color = options.color ?? "#ffffff";
  const align = options.align ?? "left";
  const lineHeight = options.lineHeight ?? 1.2;
  const bounds = measureTextBounds(text, fontSize, fontFamily, lineHeight);
  return {
    ...base(name),
    kind: "text",
    text,
    fontSize,
    fontFamily,
    color,
    align,
    lineHeight,
    width: bounds.width,
    height: bounds.height,
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
export function validateDocument(
  value: unknown,
): asserts value is DocumentData {
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
    value.schemaVersion !== 1 ||
    !text(value.id) ||
    !text(value.name) ||
    !dimension(value.width) ||
    !dimension(value.height) ||
    value.colorSpace !== "srgb"
  ) {
    throw new Error(
      "Invalid document. Use schema version 1, sRGB, and positive, safely representable integer dimensions.",
    );
  }
  if (value.selection != null) selectionSchema.parse(value.selection);
  const ids = new Set<string>();
  let count = 0;
  const walk = (nodes: unknown, depth: number) => {
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
      ids.add(node.id as string);
      if (node.fillOpacity !== undefined && !number(node.fillOpacity, 0, 1))
        throw new Error("Fill opacity must be between 0 and 1.");
      if (node.styles !== undefined) styleSchema.parse(node.styles);
      if (node.kind === "group") walk(node.children, depth + 1);
      else if (node.kind === "raster") {
        if (
          !text(node.assetId) ||
          !number(node.width, 1, MAX_COORDINATE) ||
          !number(node.height, 1, MAX_COORDINATE) ||
          !Array.isArray(node.effects) ||
          node.effects.length > 8
        )
          throw new Error("Invalid image layer.");
        const effectIds = new Set<string>();
        for (const effect of node.effects) {
          if (
            !record(effect) ||
            effect.kind !== "tone" ||
            !text(effect.id) ||
            effectIds.has(effect.id as string) ||
            typeof effect.enabled !== "boolean" ||
            !number(effect.exposure, -3, 3) ||
            !number(effect.contrast, -100, 100) ||
            !number(effect.saturation, -100, 100)
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
              ? paintOperationSchema.parse(entry)
              : pathSchema.parse(entry);
          if (entryIds.has(parsed.id))
            throw new Error("Duplicate drawing object ID.");
          entryIds.add(parsed.id);
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
          !number(node.height, 1, MAX_COORDINATE)
        ) {
          throw new Error("Invalid text layer.");
        }
      } else throw new Error("Unsupported layer type.");
    }
  };
  walk(value.children, 0);
}

export function referencedAssets(document: DocumentData): Set<string> {
  const assets = new Set<string>();
  for (const layer of allLayers(document.children)) {
    if (layer.kind === "raster") assets.add(layer.assetId);
    if (layer.kind === "paint")
      for (const stroke of layer.strokes)
        if (stroke.kind === "clone")
          for (const tile of stroke.tiles) assets.add(tile.assetId);
  }
  return assets;
}
