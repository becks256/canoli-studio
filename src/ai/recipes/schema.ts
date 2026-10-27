import {recipeDeliverySchema} from './delivery';
import { z } from "zod";
import type { Recipe } from "./types";
import { RECIPE_SCHEMA_VERSION } from "./types";
import {paragraphOverrideKeysSchema} from '../../core/paragraph-styles';
import {recipeFontFilesSchema} from './fonts';
import {layerAlignmentSchema} from '../../core/layer-layout';

export const recipeParagraphStyleTargetSchema=z.discriminatedUnion('by',[
  z.object({by:z.literal('name'),name:z.string().trim().min(1).max(80)}).strict(),
  z.object({by:z.literal('stepResult'),stepId:z.string().min(1).max(120)}).strict(),
]);
const recipeParagraphFormatSchema=z.record(z.string(),z.unknown());
const recipeParagraphBaseSchema=z.object({style:recipeParagraphStyleTargetSchema,overrides:recipeParagraphFormatSchema}).strict().nullable().optional();

export function recipeOutputBindingsUnique(data: {
  steps: { id: string; outputVar?: string }[];
}): boolean {
  const owners = new Map<string, string>();
  for (const step of data.steps) {
    for (const key of new Set([
      step.id,
      ...(step.outputVar ? [step.outputVar] : []),
    ])) {
      if (owners.has(key) && owners.get(key) !== step.id) return false;
      owners.set(key, step.id);
    }
  }
  return true;
}

export const recipeParameterTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "layer",
  "color",
  "choice",
]);

export const recipeParameterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Parameter names must contain only letters, numbers, hyphens or underscores",
    ),
  label: z.string().min(1).max(120),
  type: recipeParameterTypeSchema,
  default: z.unknown().optional(),
  description: z.string().max(1000).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1).max(120)).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

export const semanticTargetSchema: z.ZodTypeAny = z
  .object({
    role: z
      .enum([
        "selected",
        "background",
        "topmost",
        "bottommost",
        "foreground",
        "all",
        "active-mask",
      ])
      .optional(),
    by: z.enum(["name", "kind", "tag", "stepResult", "parameter"]).optional(),
    pattern: z.string().min(1).max(240).optional(),
    literal: z.boolean().optional(),
    kind: z
      .enum(["raster", "group", "paint", "vector", "text", "adjustment", "smart-object"])
      .optional(),
    tag: z.string().min(1).max(80).optional(),
    stepId: z.string().min(1).max(120).optional(),
    childPath: z.array(z.number().int().nonnegative()).optional(),
    paramName: z.string().min(1).max(64).optional(),
    ambiguityStrategy: z.enum(["first", "fail"]).optional(),
    allowMultiple: z.boolean().optional(),
    ignoreLocked: z.boolean().optional(),
  })
  .refine((data) => data.role !== undefined || data.by !== undefined, {
    message: "SemanticTarget must specify either a 'role' or a 'by' selector",
  });

export const stepConditionSchema = z
  .object({
    param: z.string().min(1).max(64).optional(),
    op: z.enum([
      "equals",
      "notEquals",
      "truthy",
      "greaterThan",
      "lessThan",
      "layerExists",
      "layerCountEquals",
    ]),
    value: z.unknown().optional(),
    target: z.lazy(() => semanticTargetSchema).optional(),
  })
  .superRefine((condition, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (condition.op === "layerExists") {
      if (!condition.target) issue("layerExists requires a target.");
    } else if (condition.op === "layerCountEquals") {
      if (
        typeof condition.value !== "number" ||
        !Number.isSafeInteger(condition.value) ||
        condition.value < 0
      )
        issue("layerCountEquals requires a nonnegative integer value.");
    } else {
      if (!condition.param) issue(`${condition.op} requires a parameter.`);
      if (condition.op !== "truthy" && condition.value === undefined)
        issue(`${condition.op} requires a value.`);
      if (
        (condition.op === "greaterThan" || condition.op === "lessThan") &&
        (typeof condition.value !== "number" ||
          !Number.isFinite(condition.value))
      )
        issue(`${condition.op} requires a finite numeric value.`);
    }
  });

// Parameter expressions are resolved and then validated by the native options contract.
const rawNumber=z.union([z.number().finite(),z.string().min(1)]);
export const recipeRawDevelopmentSchema=z.object({
  lens:z.union([z.record(z.string(),z.unknown()),z.string().min(1)]).optional(),
  image:rawNumber.optional(),whiteBalance:z.string().min(1).optional(),demosaic:z.string().min(1).optional(),
  exposure:rawNumber.optional(),highlightPreservation:rawNumber.optional(),highlights:rawNumber.optional(),
  multipliers:z.object({red:rawNumber.optional(),green:rawNumber.optional(),blue:rawNumber.optional()}).strict().optional(),
}).strict();

export const recipeActionSchema = z.discriminatedUnion("type", [
  z.object({type:z.literal('layer.align'),targets:z.array(semanticTargetSchema).min(1),alignment:layerAlignmentSchema,reference:z.discriminatedUnion('type',[
    z.object({type:z.literal('selection')}).strict(),z.object({type:z.literal('canvas')}).strict(),z.object({type:z.literal('layer'),layer:semanticTargetSchema}).strict(),
  ]).optional()}).strict(),
  z.object({type:z.literal('font.file.add'),id:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({type:z.literal('font.file.rename'),id:z.string().regex(/^[a-f0-9]{64}$/),name:z.string().min(1).max(240)}).strict(),
  z.object({type:z.literal('font.file.remove'),id:z.string().regex(/^[a-f0-9]{64}$/),replaceWith:z.string().min(1).max(240).optional()}).strict(),
  z.object({type:z.literal('document.font.replace'),from:z.string().min(1).max(240),to:z.string().min(1).max(240)}).strict(),
  z.object({type:z.literal("raw.develop"),development:recipeRawDevelopmentSchema,allowPrecisionLoss:z.literal(true)}).strict(),
  z.object({type:z.literal('paragraphStyle.ensure'),name:z.string().min(1).max(80),format:recipeParagraphFormatSchema,basedOn:recipeParagraphBaseSchema}).strict(),
  z.object({type:z.literal('paragraphStyle.update'),style:recipeParagraphStyleTargetSchema,name:z.string().min(1).max(80),format:recipeParagraphFormatSchema,basedOn:recipeParagraphBaseSchema}).strict(),
  z.object({type:z.literal('paragraphStyle.remove'),style:recipeParagraphStyleTargetSchema}).strict(),
  z.object({type:z.literal('text.paragraphStyle'),style:recipeParagraphStyleTargetSchema.nullable(),keepOverrides:z.boolean().optional()}).strict(),
  z.object({type:z.literal('text.paragraphOverrides.clear'),keys:paragraphOverrideKeysSchema.optional()}).strict(),
  z.object({
    type: z.literal("layer.translate"),
    dx: z.union([z.number(), z.string()]),
    dy: z.union([z.number(), z.string()]),
  }),
  z.object({
    type: z.literal("layer.update"),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("layer.duplicate"),
    newName: z.string().min(1).max(240).optional(),
    inPlace: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("layer.remove"),
  }),
  z.object({
    type: z.literal("layer.reorder"),
    direction: z.enum(["up", "down"]),
  }),
  z.object({
    type: z.literal("layer.add"),
    layerTemplate: z
      .object({
        kind: z.enum([
          "raster",
          "group",
          "paint",
          "vector",
          "text",
          "adjustment",
        ]),
        name: z.string().min(1).max(240),
      })
      .passthrough(),
    parentTarget: semanticTargetSchema.optional(),
    paragraphStyles:z.record(z.string().min(1),recipeParagraphStyleTargetSchema).optional(),
  }),
  z.object({
    type: z.literal("effect.tone"),
    values: z.object({
      exposure: z.union([z.number(), z.string()]).optional(),
      contrast: z.union([z.number(), z.string()]).optional(),
      saturation: z.union([z.number(), z.string()]).optional(),
    }),
  }),
  z.object({
    type: z.literal("effect.add"),
    effect: z.object({
      id: z.string().min(1),
      kind: z.literal("tone"),
      enabled: z.boolean(),
      exposure: z.number(),
      contrast: z.number(),
      saturation: z.number(),
    }),
  }),
  z.object({
    type: z.literal("effect.update"),
    effectId: z.string().optional(),
    effectIndex: z.number().int().nonnegative().optional(),
    values: z.object({
      enabled: z.boolean().optional(),
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      saturation: z.number().optional(),
    }),
  }),
  z.object({
    type: z.literal("effect.remove"),
    effectId: z.string().optional(),
    effectIndex: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("effect.reset") }),
  z.object({
    type: z.enum(["document.resize", "document.resizeImage"]),
    width: z.union([z.number(), z.string()]),
    height: z.union([z.number(), z.string()]),
  }),
  z.object({
    type: z.literal("document.crop"),
    bounds: z.object({
      x: z.union([z.number(), z.string()]),
      y: z.union([z.number(), z.string()]),
      width: z.union([z.number(), z.string()]),
      height: z.union([z.number(), z.string()]),
    }),
  }),
  z.object({
    type: z.literal("document.rename"),
    name: z.string().min(1).max(240),
  }),
  z.object({
    type: z.literal("selection.set"),
    selection: z.unknown().nullable().optional(),
  }),
  z.object({
    type: z.literal("ai.generate"),
    prompt: z.string().min(1).max(4000),
    modality: z.enum(["text-to-image", "masked-edit"]),
    output: z
      .object({
        width: z.number().min(1).max(8192),
        height: z.number().min(1).max(8192),
        alpha: z.boolean().optional(),
      })
      .optional(),
    estimatedCostCents: z.number().min(0).optional(),
  }),
]);

export const recipeStepSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(240),
  description: z.string().max(1000).optional(),
  condition: stepConditionSchema.optional(),
  target: semanticTargetSchema.optional(),
  action: recipeActionSchema,
  literalValues: z.boolean().optional(),
  outputVar: z.string().min(1).max(64).optional(),
});

export const recipeSchema = z
  .object({
    schemaVersion: z.union([z.literal(RECIPE_SCHEMA_VERSION),z.literal(2),z.literal(3)]),
    delivery:recipeDeliverySchema.optional(),
    fontFiles:recipeFontFilesSchema.optional(),
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(240),
    description: z.string().max(4000),
    version: z.number().int().min(1),
    parameters: z.array(recipeParameterSchema),
    steps: z
      .array(recipeStepSchema)
      .min(1, "Recipe must contain at least one step"),
    tags: z.array(z.string().min(1).max(80)).optional(),
    author: z.string().max(240).optional(),
    created: z.string().optional(),
    modified: z.string().optional(),
  })
  .refine(data=>(data.schemaVersion===3?data.delivery!==undefined:data.delivery===undefined)&&(data.schemaVersion===1?data.fontFiles===undefined:data.schemaVersion===2?data.fontFiles!==undefined:true)&&(!data.steps.some(step=>step.action.type.startsWith('font.file.'))||!!data.fontFiles?.length),{message:'Font dependencies require recipe version 2/3; delivery dependencies require version 3 and a complete package.'})
  .refine(
    (data) => {
      // Check that step IDs are unique
      const stepIds = new Set<string>();
      for (const step of data.steps) {
        if (stepIds.has(step.id)) return false;
        stepIds.add(step.id);
      }
      return true;
    },
    { message: "Recipe step IDs must be unique" },
  )
  .refine(recipeOutputBindingsUnique, {
    message:
      "Recipe output aliases must not collide with another step ID or output alias",
  })
  .refine(
    (data) => {
      // Check that parameter names are unique
      const paramNames = new Set<string>();
      for (const param of data.parameters) {
        if (paramNames.has(param.name)) return false;
        paramNames.add(param.name);
      }
      return true;
    },
    { message: "Recipe parameter names must be unique" },
  );

export function validateRecipe(input: unknown): {
  valid: boolean;
  errors: string[];
  recipe?: Recipe;
} {
  const result = recipeSchema.safeParse(input);
  if (result.success) {
    return { valid: true, errors: [], recipe: result.data as Recipe };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`,
  );
  return { valid: false, errors };
}
