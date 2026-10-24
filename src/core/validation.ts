import {fontVariantCapsSchema,fontStretchSchema} from './font-features';
import {fontFamilyRequestSchema} from './font-management';
import {fontFileSchema} from './font-files';
import { layerCompSchema } from "./layer-comps";
import {paragraphStyleSchema,paragraphOverrideKeysSchema} from './paragraph-styles';
import { alphaChannelSchema } from './alpha-channels';
import { polygonSelectionSchema } from "./lasso";
import { smartFiltersSchema } from "./smart/filters";
import { componentDefinitionSchema } from "./smart/manager";
import { TONE_LIMITS } from "./tone";
import { guidesSchema } from "./guides";
import { affineSchema } from "./transform-schema";
import { cropBoundsSchema } from "./crop";
import { layerMaskSchema } from "./masks";
import { authoredMetadataSchema } from "./metadata";
import { adjustmentSchema } from "./adjustments";
import { GROUP_BLEND_MODES } from "./model";
import {
  rasterErasureSchema,
  selectionSchema,
  styleSchema,
  paintOperationSchema,
  pathSchema,
} from "./drawing";
import { z } from "zod";
import { vectorBooleanOperandsSchema } from './vector-boolean';
import type { EditorCommand } from "./commands";
import { validateDocument, createDocument } from "./model";
import type { LayerData } from "./model";

const identifier = z.string().min(1).max(240);
const position = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const dimension = z.number().finite().min(1).max(Number.MAX_SAFE_INTEGER);
const toneValues = z
  .object({
    enabled: z.boolean().optional(),
    exposure: z
      .number()
      .min(TONE_LIMITS.exposure.min)
      .max(TONE_LIMITS.exposure.max)
      .optional(),
    contrast: z
      .number()
      .min(TONE_LIMITS.contrast.min)
      .max(TONE_LIMITS.contrast.max)
      .optional(),
    saturation: z
      .number()
      .min(TONE_LIMITS.saturation.min)
      .max(TONE_LIMITS.saturation.max)
      .optional(),
  })
  .strict();
const patch = z
  .object({
    transform: affineSchema.optional(),
    mask: layerMaskSchema.nullable().optional(),
    metadata: authoredMetadataSchema.nullable().optional(),
    name: identifier.optional(),
    x: position.optional(),
    y: position.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    frequencyRadius: z.number().finite().min(0).max(4096/3).nullable().optional(),
    styles: styleSchema.optional(),
    blendMode: z.enum(GROUP_BLEND_MODES).optional(),
    text: z.string().max(10000).optional(),
    fontSize: z.number().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    fontFamily: identifier.optional(),
    color: identifier.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    lineHeight: z.number().min(0.5).max(10).optional(),
    letterSpacing: z.number().min(-50).max(500).optional(),
    wordSpacing: z.number().min(-50).max(500).optional(),
    fontKerning: z.enum(['auto', 'normal', 'none']).optional(),
    fontVariantCaps:fontVariantCapsSchema.optional(),
    fontStretch:fontStretchSchema.optional(),
    paragraphJustify: z.enum(["none","inter-word"]).optional(),
    wrapWidth: dimension.nullable().optional(),
    paragraphSpacing: z.number().min(0).max(10000).optional(),
    firstLineIndent: z.number().min(-10000).max(10000).optional(),
    fontWeight: identifier.optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    direction: z.enum(["ltr", "rtl"]).optional(),
    adjustment: adjustmentSchema.optional(),
    erasures: z.array(rasterErasureSchema).max(2048).optional(),
  })
  .strict();
const layer = z.unknown().transform((value, context) => {
  try {
    validateDocument({ ...createDocument(), children: [value] }, false);
    return value as LayerData;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid layer tree." });
    return z.NEVER;
  }
});

const commandVariants = () =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("layer.flip"),
        ids: z.array(identifier).min(1),
        axis: z.enum(["horizontal", "vertical"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("layer.distribute"),
        ids: z.array(identifier).min(3),
        axis: z.enum(["horizontal", "vertical"]),
        mode: z.enum(["gaps", "centers"]),
      })
      .strict(),
    z
      .object({ type: z.literal("layerComp.set"), comp: layerCompSchema })
      .strict(),
    z.object({type:z.literal('document.font.replace'),from:fontFamilyRequestSchema,to:fontFamilyRequestSchema}).strict(),
    z.object({type:z.literal('font.file.add'),file:fontFileSchema}).strict(),
    z.object({type:z.literal('font.file.rename'),id:identifier,name:fontFileSchema.shape.name}).strict(),
    z.object({type:z.literal('font.file.remove'),id:identifier,replaceWith:fontFamilyRequestSchema.optional()}).strict(),
    z.object({type:z.literal('paragraphStyle.set'),style:paragraphStyleSchema}).strict(),
    z.object({type:z.literal('paragraphStyle.remove'),id:identifier}).strict(),
    z.object({type:z.literal('text.paragraphStyle'),id:identifier,styleId:identifier.nullable(),keepOverrides:z.boolean().optional()}).strict(),
    z.object({type:z.literal('text.paragraphOverrides.clear'),id:identifier,keys:paragraphOverrideKeysSchema.optional()}).strict(),
    z.object({type:z.literal('alphaChannel.set'),channel:alphaChannelSchema}).strict(),
    z.object({type:z.literal('alphaChannel.remove'),id:identifier}).strict(),
    z.object({type:z.literal('alphaChannel.reorder'),id:identifier,direction:z.enum(['up','down'])}).strict(),
    z.object({ type: z.literal("layerComp.remove"), id: identifier }).strict(),
    z.object({ type: z.literal("layerComp.apply"), id: identifier }).strict(),
    z
      .object({
        type: z.literal("smartObject.filterMask"),
        id: identifier,
        mask: layerMaskSchema.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("smartObject.filters"),
        id: identifier,
        filters: smartFiltersSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("component.set"),
        definition: componentDefinitionSchema as z.ZodType<
          import("./smart/types").SmartComponentDefinition
        >,
      })
      .strict(),
    z
      .object({
        type: z.literal("component.replaceAll"),
        definitions: z.array(componentDefinitionSchema) as z.ZodType<
          import("./smart/types").SmartComponentDefinition[]
        >,
      })
      .strict(),
    z.object({ type: z.literal("component.remove"), id: identifier }).strict(),
    z
      .object({
        type: z.literal("smartObject.duplicateIndependent"),
        id: identifier,
        instanceId: identifier,
        componentIds: z.record(identifier, identifier),
      })
      .strict(),
    z
      .object({
        type: z.literal("smartObject.convertLayers"),
        ids: z.array(identifier).min(1),
        componentId: identifier,
        instanceId: identifier,
      })
      .strict(),
    z
      .object({
        type: z.literal("smartObject.convertToRaster"),
        id: identifier,
        layer: layer.refine(
          (value) => value.kind === "raster",
          "Rasterization requires raster data",
        ),
      })
      .strict(),
    z
      .object({
        type: z.literal("smartObject.convertRaster"),
        id: identifier,
        componentId: identifier,
        instanceId: identifier,
      })
      .strict(),
    z
      .object({
        type: z.literal("selection.set"),
        selection: selectionSchema.nullable(),
      })
      .strict(),
    polygonSelectionSchema.extend({ type: z.literal("selection.polygon") }),
    z
      .object({
        type: z.literal("layer.place"),
        id: identifier,
        targetId: identifier.nullable(),
        placement: z.enum(["before", "after", "inside"]),
        preservePosition: z.boolean(),
      })
      .strict(),
    z
      .object({
        type: z.literal("paint.add"),
        id: identifier,
        stroke: paintOperationSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("paint.remove"),
        id: identifier,
        strokeId: identifier,
      })
      .strict(),
    z
      .object({ type: z.literal("path.add"), id: identifier, path: pathSchema })
      .strict(),
    z.object({type:z.literal('paths.replace'),operands:vectorBooleanOperandsSchema,result:pathSchema.nullable()}).strict(),
    z
      .object({
        type: z.literal("path.update"),
        id: identifier,
        pathId: identifier,
        patch: z.object(pathSchema.shape).omit({ id: true }).partial().strict(),
      })
      .strict(),
    z
      .object({
        type: z.literal("path.remove"),
        id: identifier,
        pathId: identifier,
      })
      .strict(),
    z
      .object({ type: z.literal("document.guides"), guides: guidesSchema })
      .strict(),
    z.object({ type: z.literal("document.rename"), name: identifier }).strict(),
    z
      .object({ type: z.literal("document.crop"), bounds: cropBoundsSchema })
      .strict(),
    z
      .object({
        type: z.enum(["document.resize", "document.resizeImage"]),
        width: dimension.int(),
        height: dimension.int(),
      })
      .strict(),
    z
      .object({
        type: z.literal("layer.add"),
        layer,
        parentId: identifier.optional(),
      })
      .strict(),
    z
      .object({ type: z.literal("layer.update"), id: identifier, patch })
      .strict(),
    z.object({ type: z.literal("layer.remove"), id: identifier }).strict(),
    z
      .object({
        type: z.literal("layer.duplicate"),
        id: identifier,
        newIds: z.record(identifier, identifier).optional(),
      })
      .strict(),
    z
      .object({
        type: z.literal("layer.reorder"),
        id: identifier,
        direction: z.enum(["up", "down"]),
      })
      .strict(),
    z
      .object({
        type: z.literal("layer.reparent"),
        id: identifier,
        parentId: identifier.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("effect.tone"),
        id: identifier,
        values: toneValues.omit({ enabled: true }),
      })
      .strict(),
    z.object({ type: z.literal("effect.reset"), id: identifier }).strict(),
    z
      .object({
        type: z.literal("effect.add"),
        id: identifier,
        effect: toneValues
          .required()
          .extend({ id: identifier, kind: z.literal("tone") }),
      })
      .strict(),
    z
      .object({
        type: z.literal("effect.update"),
        id: identifier,
        effectId: identifier,
        values: toneValues,
      })
      .strict(),
    z
      .object({
        type: z.literal("effect.remove"),
        id: identifier,
        effectId: identifier,
      })
      .strict(),
    z
      .object({
        type: z.literal("mask.setFromMatting"),
        id: identifier,
        mask: layerMaskSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal("transaction"),
        label: identifier,
        commands: z.array(commandSchema).max(256),
      })
      .strict(),
  ]);
const commandSchema: z.ZodType<EditorCommand> = z.lazy(commandVariants);

/** Metadata for trusted adapters. parseCommands remains the admission boundary. */
export const commandMetadataSchema=commandSchema;
export const commandMetadataVariants=()=>commandVariants().options;
export const layerPatchMetadataSchema=patch;

/** Shared trust boundary for REST and sandbox results. Bound nesting before schema recursion. */
export function parseCommands(input: unknown): EditorCommand[] {
  const stack: { value: unknown; depth: number }[] = [
    { value: input, depth: 0 },
  ];
  let budget = 40_000;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (--budget < 0 || depth > 40)
      throw new Error("Command payload exceeds the complexity limit.");
    if (value && typeof value === "object")
      for (const child of Object.values(value))
        stack.push({ value: child, depth: depth + 1 });
  }
  return z.array(commandSchema).max(256).parse(input);
}

export const createDocumentSchema = z
  .object({
    name: identifier.optional(),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
  })
  .strict();
export const commandRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    label: identifier.optional(),
    commands: z.unknown(),
  })
  .strict();
export const revisionSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
