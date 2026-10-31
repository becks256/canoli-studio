import{floatSceneIssue}from'./float-document';
import {perspectiveSchema,type PerspectiveData} from './perspective';
import {activePerspective,perspectiveMatrix,perspectiveRect} from './perspective';
import {intrinsicLocalBounds} from './spatial';
import {usesNativeTextWriting,isVerticalText,writingModeSchema,textOrientationSchema,assertTextWritingVersion,type TextWritingProperties} from './text-writing';
import {textPathSchema,type TextPathData} from './text-path';
import {validateDeclaredFontVariations} from './font-variations';
import {normalizeCharacterRanges,type CharacterRangeData} from './text-ranges';
import {characterInputForLayer,characterTextBounds,assertCharacterTextScalars} from './character-layout';
import {assertFontFeaturesVersion,fontVariantCapsSchema,fontStretchSchema,fontVariationSettingsSchema,type FontFeatures} from './font-features';
import {fontFileSchema,documentFontFiles,validateCharacterFontDeclarations} from './font-files';
import {vectorStrokeKeys} from './vector-stroke';
import {visitLayerAssets} from './asset-references';
import {assertBrushVersion} from './drawing';
import {applyTextStyle, measureStyledText, UnsupportedTextStyleError} from './text-style';
import {layoutText, NativeJustificationError, assertParagraphStyle, type ParagraphStyle} from './text-layout';
import { yieldTask } from "./task-yield";
import { alphaChannelSchema, MAX_ALPHA_CHANNELS, type AlphaChannelData } from './alpha-channels';
import { z } from "zod";
import {validateParagraphStyles,type ParagraphStyleData,type ParagraphStyleBinding} from './paragraph-styles';
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
import { layerMaskSchema,assertMaskOperationVersion } from "./masks";
import type { LayerMaskData } from "./masks";
import { authoredMetadataSchema } from "./metadata";
import type { AuthoredMetadataData } from "./metadata";
import {
  rasterErasureSchema,
  assertRasterErasureVersion,
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
export const SCHEMA_VERSION = 53;
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
  "linear-light",
  "linear-burn",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];
export const GROUP_BLEND_MODES = ['pass-through', ...BLEND_MODES] as const;
export type LayerBlendMode = (typeof GROUP_BLEND_MODES)[number];

export interface ToneEffectData {
  id: string;
  kind: "tone";
  enabled: boolean;
  exposure: number;
  contrast: number;
  saturation: number;
}

export interface LayerBaseData {
  /** Normalized TL/TR/BR/BL image corners; raster and smart-object instances only. */
  perspective?:PerspectiveData|null;
  /** Use the transparency of the preceding unclipped sibling as the clipping base. */
  clipped?: boolean;
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

export interface GroupLayerData extends Omit<LayerBaseData, 'blendMode'> {
  kind: "group";
  blendMode: LayerBlendMode;
  /** Shared native-pixel radius for descendant frequency filters in this document plane. */
  frequencyRadius?: number | null;
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
export interface TextLayerData extends LayerBaseData, ParagraphStyle, FontFeatures, TextWritingProperties {
  textPath?:TextPathData|null;
  textPathOrigin?:{x:number;y:number};
  textFrameOrigin?:{x:number;y:number};
  textInlineExtent?:number;
  characterRanges?:readonly CharacterRangeData[];
  paragraphStyle?:ParagraphStyleBinding|null;
  kind: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing?: number;
  wordSpacing?: number;
  fontKerning?: 'auto' | 'normal' | 'none';
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
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 23
    | 24
    | 25
    | 26
    | 27
    | 28
    | 29
    | 30
    | 31
    | 32
    | 33
    | 34
    | 35
    | 36
    | 37
    | 38
    | 39
    | 40
    | 41
    | 42
    | 43
    | 44
    | 45
    | 46
    | 47
    | 48
    | 49
    | 50
    | 51
    | 52
    | typeof SCHEMA_VERSION;
  id: string;
  name: string;
  width: number;
  height: number;
  colorSpace: "srgb" | "linear-srgb";
  precision?:"uint8"|"float32";
  selection?: SelectionData | null;
  guides?: GuideData[];
  components?: SmartComponentDefinition[];
  layerComps?: LayerCompData[];
  paragraphStyles?:ParagraphStyleData[];
  fontFiles?:import('./font-files').FontFileData[];
  alphaChannels?: AlphaChannelData[];
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
  options: ParagraphStyle & FontFeatures & TextWritingProperties & {
    textPath?:TextPathData|null;
    characterRanges?:readonly CharacterRangeData[];
    color?:string;
    align?:'left'|'center'|'right';
    letterSpacing?: number;
    wordSpacing?: number;
    fontKerning?: 'auto' | 'normal' | 'none';
    direction?: 'ltr' | 'rtl';
    fontWeight?: string;
    fontStyle?: "normal" | "italic";
  } = {},
): import('./character-layout').CharacterBounds {
  assertParagraphStyle(options);
  if(options.characterRanges!==undefined||options.textPath!==undefined||usesNativeTextWriting(options))return characterTextBounds(characterInputForLayer({...options,text,fontSize,fontFamily,lineHeight,color:options.color??'#ffffff'}));

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

  const letterSpacing = options.letterSpacing ?? 0;

  if (measureCtx) {
    const context = measureCtx;
    try {
      applyTextStyle(context, {...options, fontSize, fontFamily});
      const layout = layoutText({...options, text, fontSize, lineHeight}, (line, spacing) => {
        const width = measureStyledText(context,line,{...options,fontSize,fontFamily},spacing);
        const spacingAdjustment =
          "letterSpacing" in context
            ? 0
            : Math.max(0, line.length - 1) * letterSpacing;
        return width + spacingAdjustment;
      });
      return {width: layout.width, height: layout.height};
    } catch (error) {
      if (error instanceof UnsupportedTextStyleError || error instanceof NativeJustificationError) throw error;
    }
  }

  const layout = layoutText({...options, text, fontSize, lineHeight}, (line, spacing) =>
    (line.length || 1) * fontSize * 0.6 + Math.max(0, line.length - 1) * letterSpacing +
    (line.match(/[ \u00a0\t\r\f]/g)?.length ?? 0) * (spacing ?? options.wordSpacing ?? 0));
  return {width: layout.width, height: layout.height};
}

export function createText(
  name: string,
  text = "Text",
  options: ParagraphStyle & FontFeatures & TextWritingProperties & {
    textPath?:TextPathData|null;
    characterRanges?:readonly CharacterRangeData[];
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    align?: "left" | "center" | "right";
    lineHeight?: number;
    letterSpacing?: number;
    wordSpacing?: number;
    fontKerning?: 'auto' | 'normal' | 'none';
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
  const wordSpacing = options.wordSpacing;
  const fontKerning = options.fontKerning;
  const fontWeight = options.fontWeight;
  const fontStyle = options.fontStyle;
  const direction = options.direction;
  const bounds = measureTextBounds(text, fontSize, fontFamily, lineHeight, {
    textPath:options.textPath,characterRanges:options.characterRanges,writingMode:options.writingMode,textOrientation:options.textOrientation,color,align,
    letterSpacing,
    wordSpacing,
    fontKerning,
    direction,
    fontWeight,
    fontStyle,
    ...(options.fontVariantCaps===undefined?{}:{fontVariantCaps:options.fontVariantCaps}),
    ...(options.fontStretch===undefined?{}:{fontStretch:options.fontStretch}),
    ...(options.fontVariationSettings===undefined?{}:{fontVariationSettings:options.fontVariationSettings}),
    ...(options.wrapWidth === undefined ? {} : {wrapWidth: options.wrapWidth}),
    ...(options.paragraphSpacing === undefined ? {} : {paragraphSpacing: options.paragraphSpacing}),
    ...(options.firstLineIndent === undefined ? {} : {firstLineIndent: options.firstLineIndent}),
    ...(options.paragraphJustify === undefined ? {} : {paragraphJustify: options.paragraphJustify}),
  });
  return {
    ...base(name),
    kind: "text",
    ...(options.textPath===undefined?{}:{textPath:options.textPath?textPathSchema.parse(options.textPath):null}),
    ...(bounds.origin?(options.textPath?{textPathOrigin:{...bounds.origin}}:{textFrameOrigin:{...bounds.origin}}):{}),
    ...(bounds.inlineExtent===undefined?{}:{textInlineExtent:bounds.inlineExtent}),
    ...(options.writingMode===undefined?{}:{writingMode:writingModeSchema.parse(options.writingMode)}),
    ...(options.textOrientation===undefined?{}:{textOrientation:textOrientationSchema.parse(options.textOrientation)}),
    ...(options.characterRanges===undefined&&!usesNativeTextWriting(options)?{}:{characterRanges:normalizeCharacterRanges(text,options.characterRanges??[])}),
    text,
    fontSize,
    fontFamily,
    color,
    align,
    lineHeight,
    letterSpacing,
    ...(wordSpacing === undefined ? {} : {wordSpacing}),
    ...(fontKerning === undefined ? {} : {fontKerning}),
    ...(options.fontVariantCaps===undefined?{}:{fontVariantCaps:options.fontVariantCaps}),
    ...(options.fontStretch===undefined?{}:{fontStretch:options.fontStretch}),
    ...(options.fontVariationSettings===undefined?{}:{fontVariationSettings:options.fontVariationSettings}),
    ...(options.wrapWidth === undefined ? {} : {wrapWidth: options.wrapWidth}),
    ...(options.paragraphSpacing === undefined ? {} : {paragraphSpacing: options.paragraphSpacing}),
    ...(options.firstLineIndent === undefined ? {} : {firstLineIndent: options.firstLineIndent}),
    ...(options.paragraphJustify === undefined ? {} : {paragraphJustify: options.paragraphJustify}),
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

type LayerLookup = { layer: LayerData; locked: boolean };
const immutableLayerLookups = new WeakMap<DocumentData, Map<string, LayerLookup>>();

/** Only the internal deep-immutability proof permits retaining query results.
 * Shallow-frozen caller roots and mutable command drafts still traverse afresh.
 * Root identity also keeps inherited locks separate across shared subtrees,
 * independent documents, previews and retained undo/redo states.
 */
function immutableLayerLookup(document: DocumentData) {
  if (!isImmutable(document)) return undefined;
  const cached = immutableLayerLookups.get(document);
  if (cached) return cached;
  const lookup = new Map<string, LayerLookup>();
  const visit = (nodes: LayerData[], parentLocked: boolean) => {
    for (const layer of nodes) {
      const locked = parentLocked || layer.locked;
      // Match the existing depth-first, first-occurrence query order.
      if (!lookup.has(layer.id)) lookup.set(layer.id, {layer, locked});
      if (layer.kind === 'group') visit(layer.children, locked);
    }
  };
  visit(document.children, false);
  immutableLayerLookups.set(document, lookup);
  return lookup;
}

export function findLayer(
  document: DocumentData,
  layerId: string | null,
): LayerData | undefined {
  const lookup = immutableLayerLookup(document);
  if (lookup) return layerId === null ? undefined : lookup.get(layerId)?.layer;
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
  const lookup = immutableLayerLookup(document);
  if (lookup) return lookup.get(layerId)?.locked ?? false;
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
const validatedAlphaChannels = new WeakSet<object>();
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
const validationPathSchema = pathSchema.safeExtend({
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
      value.schemaVersion !== 16 &&
      value.schemaVersion !== 17 &&
      value.schemaVersion !== 18 &&
      value.schemaVersion !== 19 &&
      value.schemaVersion !== 20 &&
      value.schemaVersion !== 21 &&
      value.schemaVersion !== 22 &&
      value.schemaVersion !== 23 &&
      value.schemaVersion !== 24 &&
      value.schemaVersion !== 25 &&
      value.schemaVersion !== 26 &&
      value.schemaVersion !== 27 &&
      value.schemaVersion !== 28 &&
      value.schemaVersion !== 29 &&
      value.schemaVersion !== 30 && value.schemaVersion !== 31 && value.schemaVersion !== 32 && value.schemaVersion !== 33 && value.schemaVersion !== 34 && value.schemaVersion !== 35 && value.schemaVersion !== 36 && value.schemaVersion !== 37 && value.schemaVersion !== 38 && value.schemaVersion !== 39 && value.schemaVersion !== 40 && value.schemaVersion !== 41 && value.schemaVersion !== 42 && value.schemaVersion !== 43 && value.schemaVersion !== 44 && value.schemaVersion !== 45 && value.schemaVersion !== 46 && value.schemaVersion !== 47 && value.schemaVersion !== 48 && value.schemaVersion !== 49 && value.schemaVersion !== 50 && value.schemaVersion !== 51 && value.schemaVersion !== 52 && value.schemaVersion !== 53) ||
    !text(value.id) ||
    !text(value.name) ||
    !dimension(value.width) ||
    !dimension(value.height) ||
    !(value.colorSpace === "srgb" && (value.precision === undefined || value.precision === "uint8") || value.colorSpace === "linear-srgb" && value.precision === "float32")
  ) {
    throw new Error(
      "Invalid document. Use a supported schema version (1–53), a supported precision/working-space pair, and positive, safely representable integer dimensions.",
    );
  }
  if(value.precision!==undefined&&Number(value.schemaVersion)<49)throw new Error('Document precision requires schema version 49.');
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
  if(value.fontFiles!==undefined){
    if(Number(value.schemaVersion)<43)throw new Error('Embedded font files require document schema version 43.');
    if(!Array.isArray(value.fontFiles))throw new Error('Invalid document font files.');
    const fontIds=new Set<string>();
    for(const entry of value.fontFiles){const font=fontFileSchema.parse(entry);if(fontIds.has(font.id))throw new Error('Duplicate document font identity.');fontIds.add(font.id);yield;}
  }
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
      if(Number(value.schemaVersion)<50&&comp.layers.some(layer=>layer.position?.perspective!==undefined))throw new Error('Layer comp perspective requires document schema version 50.');
      if(Number(value.schemaVersion)<48&&comp.layers.some(layer=>layer.appearance?.clipped!==undefined))throw new Error('Layer comp clipping requires document schema version 48.');
      if (comp.documentId !== value.id || compIds.has(comp.id))
        throw new Error("Invalid layer comp ownership or duplicate identity.");
      compIds.add(comp.id);
    }
  }
  if(value.alphaChannels!==undefined){
    if(Number(value.schemaVersion)<21)throw new Error('Alpha channels require schema version 21.');
    if(!Array.isArray(value.alphaChannels)||value.alphaChannels.length>MAX_ALPHA_CHANNELS)throw new Error('A document supports at most 64 alpha channels.');
    const channelIds=new Set<string>();
    for(const entry of value.alphaChannels){
      const channel=isImmutable(entry)&&validatedAlphaChannels.has(entry)?entry as AlphaChannelData:alphaChannelSchema.parse(entry);
      if(isImmutable(entry))validatedAlphaChannels.add(entry);
      if(channelIds.has(channel.id))throw new Error('Duplicate alpha channel identity.');
      channelIds.add(channel.id);yield;
    }
  }
  const checkBrush=(brush:{kind?:string;brush?:import('./drawing').BrushStrokeData;pressureCurve?:unknown;tip?:unknown;symmetry?:unknown;texture?:unknown;points?:readonly {tilt?:unknown}[];clip:unknown})=>{if(brush.kind==='wet'){if(Number(value.schemaVersion)<33)throw new Error('Prepared wet paint requires schema version 33.');if(!brush.brush)throw new Error('Missing wet-paint brush metadata.');checkBrush(brush.brush);}assertBrushVersion(brush,Number(value.schemaVersion));checkSelection(brush.clip);};
  checkSelection(value.selection);
  const ids = new Set<string>();
  let count = 0;
  let hasParagraphStyle=false;
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
        !GROUP_BLEND_MODES.includes(node.blendMode as LayerBlendMode) ||
        !number(node.x, -MAX_COORDINATE, MAX_COORDINATE) ||
        !number(node.y, -MAX_COORDINATE, MAX_COORDINATE)
      ) {
        throw new Error(
          "Invalid layer properties, duplicate IDs, or more than 64 layers.",
        );
      }
      if(node.clipped!==undefined&&(typeof node.clipped!=='boolean'||Number(value.schemaVersion)<48))throw new Error('Clipping layers require a boolean and document schema version 48.');
      if(node.perspective!==undefined){
        if(Number(value.schemaVersion)<50||(node.kind!=='raster'&&node.kind!=='smart-object'))throw new Error('Perspective requires an image layer and document schema version 50.');
        if(node.perspective!==null)perspectiveSchema.parse(node.perspective);
      }
      if(node.kind!=='text'&&('fontVariantCaps'in node||'fontStretch'in node||'fontVariationSettings'in node||'characterRanges'in node||'textPath'in node||'textPathOrigin'in node||'writingMode'in node||'textOrientation'in node||'textFrameOrigin'in node||'textInlineExtent'in node))throw new Error('Native font features require a text layer.');
      if (node.blendMode === 'pass-through') {
        if (node.kind !== 'group' || Number(value.schemaVersion) < 28)
          throw new Error('Pass-through blending requires a group and document schema 28.');
        const style = node.styles === undefined ? undefined : styleSchema.parse(node.styles);
        if ((node.fillOpacity ?? 1) !== 1 || style?.dropShadow.enabled || style?.colorOverlay.enabled || style?.blendIf.enabled)
          throw new Error('Pass-through groups require full fill opacity and disabled group styles. Use Normal to isolate group effects.');
      }
      if (node.kind !== 'text' && ('wordSpacing' in node || 'fontKerning' in node))
        throw new Error('Word spacing and font kerning require a text layer.');
      if(node.paragraphStyle!=null){if(node.kind!=='text')throw new Error('Paragraph styles require a text layer.');hasParagraphStyle=true;}
      if (node.frequencyRadius !== undefined) {
        if (node.kind !== 'group' || Number(value.schemaVersion) < 37)
          throw new Error('A shared frequency radius requires a group and schema version 37.');
        if (node.frequencyRadius !== null && !number(node.frequencyRadius, 0, 4096 / 3))
          throw new Error('Frequency radius must be finite and between 0 and 4096/3 native pixels.');
      }
      if (node.kind !== 'text' && ('paragraphJustify' in node || 'wrapWidth' in node || 'paragraphSpacing' in node || 'firstLineIndent' in node))
        throw new Error('Paragraph layout requires a text layer.');
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
        assertMaskOperationVersion(mask,Number(value.schemaVersion));
        if (mask.basis && Number(value.schemaVersion) < 6)
          throw new Error("Mask bases require schema version 6.");
        if (mask.kind === "selection") checkSelection(mask.selection);
        for (const paint of mask.strokes ?? [])
          checkBrush(paint.stroke);
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
      if ((node.blendMode === "linear-light" || node.blendMode === "linear-burn") && Number(value.schemaVersion) < 36)
        throw new Error("Linear Light requires schema version 36.");
      if (node.styles !== undefined) styleSchema.parse(node.styles);
      if (node.kind === "group") yield* walk(node.children, depth + 1);
      else if (node.kind === "smart-object") {
        if (Number(value.schemaVersion) < 10)
          throw new Error("Smart objects require schema version 10.");
        if (node.filterMask != null) {
          if (Number(value.schemaVersion) < 12)
            throw new Error("Smart-filter masks require schema version 12.");
          const mask = layerMaskSchema.parse(node.filterMask);
          assertMaskOperationVersion(mask,Number(value.schemaVersion));
          if (mask.kind === "selection") checkSelection(mask.selection);
          for (const paint of mask.strokes ?? []) checkBrush(paint.stroke);
        }
        if (node.smartFilters !== undefined) {
          if (Number(value.schemaVersion) < 11)
            throw new Error("Smart filters require schema version 11.");
          smartFiltersSchema.parse(node.smartFilters);
          if(Number(value.schemaVersion)<39&&(node.smartFilters as any[]).some(f=>f.kind==='bilateral-denoise'))
            throw new Error('Bilateral denoise filters require schema version 39.');
          if (Number(value.schemaVersion) < 38 && (node.smartFilters as any[]).some(f=>f.kind==='median'))
            throw new Error('Median filters require schema version 38.');
          if (Number(value.schemaVersion) < 36 && (node.smartFilters as any[]).some(f => f.kind === "frequency-band" || f.kind === "native-composition" || f.kind === "document-tone"))
            throw new Error("Frequency bands require schema version 36.");
        }
        if (
          !text(node.componentId) ||
          !number(node.width, 1, MAX_COORDINATE) ||
          !number(node.height, 1, MAX_COORDINATE)
        )
          throw new Error("Invalid smart-object instance.");
        if(node.perspective&&activePerspective(node.perspective as unknown as PerspectiveData)){const image=node as unknown as SmartObjectInstanceData;perspectiveRect(perspectiveMatrix(image.width,image.height,image.perspective!),{x:0,y:0,width:image.width,height:image.height});}
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
            const erasure = validateDrawing(rasterErasureSchema, entry);
            assertRasterErasureVersion(erasure,Number(value.schemaVersion));
            checkBrush(erasure.stroke);
            yield;
          }
        }
        if(node.perspective&&activePerspective(node.perspective as unknown as PerspectiveData)){
          const raster=node as unknown as RasterLayerData;perspectiveRect(perspectiveMatrix(raster.width,raster.height,raster.perspective!),intrinsicLocalBounds(raster)!);
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
          if(node.kind==='vector'&&Number(value.schemaVersion)<23&&'fillGradient' in (entry as object))throw new Error('Vector gradients require schema version 23.');
          if(node.kind==='vector'&&Number(value.schemaVersion)<24&&('subpaths' in (entry as object)||'fillRule' in (entry as object)))throw new Error('Compound paths and fill rules require schema version 24.');
          if(node.kind==='vector'&&Number(value.schemaVersion)<22&&vectorStrokeKeys.some(key=>key in (entry as object)))throw new Error('Vector stroke styles require schema version 22.');
          if ("clip" in parsed) {if(parsed.kind!=='fill')checkBrush(parsed);else checkSelection(parsed.clip);}
          if (entryIds.has(parsed.id))
            throw new Error("Duplicate drawing object ID.");
          entryIds.add(parsed.id);
          yield;
        }
      } else if (node.kind === "text") {
        assertFontFeaturesVersion(node,Number(value.schemaVersion));
        if(node.fontVariantCaps!==undefined)fontVariantCapsSchema.parse(node.fontVariantCaps);
        if(node.fontStretch!==undefined)fontStretchSchema.parse(node.fontStretch);
        if(node.fontVariationSettings!==undefined)fontVariationSettingsSchema.parse(node.fontVariationSettings);
        if (Number(value.schemaVersion) < 27 && 'paragraphJustify' in node) throw new Error('Paragraph justification requires schema version 27.');
        if (Number(value.schemaVersion) < 26 && ('wrapWidth' in node || 'paragraphSpacing' in node || 'firstLineIndent' in node))
          throw new Error('Paragraph layout requires schema version 26.');
        assertParagraphStyle(node);
        if (node.wrapWidth != null && (isVerticalText(node as unknown as TextLayerData)
          ?node.textInlineExtent!==node.wrapWidth||!number(node.height,node.wrapWidth as number,MAX_COORDINATE)
          :node.width!==node.wrapWidth))
          throw new Error('Paragraph bounds must retain their authored wrap width.');
        if (Number(value.schemaVersion) < 25 && ('wordSpacing' in node || 'fontKerning' in node))
          throw new Error('Word spacing and font kerning require schema version 25.');
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
          (node.wordSpacing !== undefined && !number(node.wordSpacing, -50, 500)) ||
          (node.fontKerning !== undefined && !['auto', 'normal', 'none'].includes(node.fontKerning as string)) ||
          (node.fontWeight !== undefined && !text(node.fontWeight)) ||
          (node.fontStyle !== undefined &&
            !["normal", "italic"].includes(node.fontStyle as string)) ||
          (node.direction !== undefined &&
            !["ltr", "rtl"].includes(node.direction as string))
        ) {
          throw new Error("Invalid text layer.");
        }
        assertTextWritingVersion(node,Number(value.schemaVersion));
        if(node.writingMode!==undefined)writingModeSchema.parse(node.writingMode);
        if(node.textOrientation!==undefined)textOrientationSchema.parse(node.textOrientation);
        if('textFrameOrigin'in node||'textInlineExtent'in node){
          if(Number(value.schemaVersion)<47)throw new Error('Vertical text frames require document schema version 47.');
          if(!isVerticalText(node as unknown as TextLayerData)||node.textPath)throw new Error('A vertical text frame requires vertical writing without a path.');
          if(!record(node.textFrameOrigin)||Object.keys(node.textFrameOrigin).some(key=>!['x','y'].includes(key))||!number(node.textFrameOrigin.x,-MAX_COORDINATE,MAX_COORDINATE)||!number(node.textFrameOrigin.y,-MAX_COORDINATE,MAX_COORDINATE)||!number(node.textInlineExtent,1,MAX_COORDINATE))throw new Error('Vertical text requires a measured frame origin and logical inline extent.');
        }else if(isVerticalText(node as unknown as TextLayerData)&&!node.textPath)throw new Error('Vertical text requires its measured frame.');
        if(usesNativeTextWriting(node as unknown as TextLayerData))assertCharacterTextScalars(node.text as string);
        if('textPath'in node||'textPathOrigin'in node){
          if(Number(value.schemaVersion)<46)throw new Error('Text paths require document schema version 46.');
          if(node.textPath!==undefined)assertCharacterTextScalars(node.text as string);
          if(node.textPath!=null){
            const path=textPathSchema.parse(node.textPath);characterInputForLayer({...node,text:node.text as string,textPath:path}as unknown as TextLayerData);
            if(!record(node.textPathOrigin)||Object.keys(node.textPathOrigin).some(key=>!['x','y'].includes(key))||!number(node.textPathOrigin.x,-MAX_COORDINATE,MAX_COORDINATE)||!number(node.textPathOrigin.y,-MAX_COORDINATE,MAX_COORDINATE))throw new Error('A text path requires its measured frame origin.');
            // Validation stays structural; source-owned native geometry belongs to commands.
            if(node.wrapWidth!=null||node.paragraphSpacing!=null&&node.paragraphSpacing!==0||node.firstLineIndent!=null&&node.firstLineIndent!==0||node.paragraphJustify!=null&&node.paragraphJustify!=='none'||/[\n\u2028\u2029]/u.test(node.text as string))throw new Error('Path text requires one logical line without paragraph layout.');
          }else if(node.textPathOrigin!==undefined)throw new Error('A text frame origin requires a baseline path.');
        }
        if('characterRanges'in node){
          if(Number(value.schemaVersion)<45)throw new Error('Character ranges require document schema version 45.');
          if(node.characterRanges!==undefined){normalizeCharacterRanges(node.text,node.characterRanges as readonly CharacterRangeData[]);assertCharacterTextScalars(node.text);}
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
        if ((node.adjustment.kind === "color-balance" || node.adjustment.kind === "vibrance") && Number(value.schemaVersion) < 17)
          throw new Error("Color Balance and Vibrance adjustments require schema version 17.");
        if (node.adjustment.kind === "gradient-map" && Number(value.schemaVersion) < 18)
          throw new Error("Gradient maps require schema version 18.");
        if (node.adjustment.kind === "white-balance" && Number(value.schemaVersion) < 19)
          throw new Error("White balance requires schema version 19.");
        if (node.adjustment.kind === "lut" && Number(value.schemaVersion) < 20)
          throw new Error("Imported LUTs require schema version 20.");
        if (node.adjustment.kind === "red-eye" && Number(value.schemaVersion) < 35)
          throw new Error("Red-eye correction requires schema version 35.");
        const adjustment = adjustmentSchema.parse(node.adjustment);
        if (adjustment.kind === "tonal")
          for (const stroke of adjustment.strokes) checkBrush(stroke.brush);
      } else throw new Error("Unsupported layer type.");
      yield;
    }
  };
  yield* walk(value.children, 0);
  if(value.precision==='float32'){const issue=floatSceneIssue(value as unknown as DocumentData);if(issue)throw new Error(issue);}
  if(value.paragraphStyles!==undefined||hasParagraphStyle)validateParagraphStyles(value as unknown as DocumentData);
  if(value.fontFiles!==undefined)validateDeclaredFontVariations(value as unknown as DocumentData);
  if (value.components !== undefined && Number(value.schemaVersion) < 10)
    throw new Error("Component definitions require schema version 10.");
  if (checkComponents) {
    validateCharacterFontDeclarations(value as unknown as DocumentData);
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
    if(value.fontFiles!==undefined||value.components!==undefined)documentFontFiles(value as unknown as DocumentData);
  }
}

export function referencedAssets(document: DocumentData): Set<string> {
  const assets = document.components
    ? new ComponentRegistry(document.components).assetIds()
    : new Set<string>();
  for (const layer of allLayers(document.children))visitLayerAssets(layer,reference=>assets.add(reference.assetId));
  return assets;
}
