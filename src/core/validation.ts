import { BLEND_MODES } from "./model";
import {
  selectionSchema,
  styleSchema,
  paintOperationSchema,
  pathSchema,
} from "./drawing";
import { z } from "zod";
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
    exposure: z.number().min(-3).max(3).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
  })
  .strict();
const patch = z
  .object({
    name: identifier.optional(),
    x: position.optional(),
    y: position.optional(),
    width: dimension.optional(),
    height: dimension.optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    fillOpacity: z.number().min(0).max(1).optional(),
    styles: styleSchema.optional(),
    blendMode: z.enum(BLEND_MODES).optional(),
    text: z.string().max(10000).optional(),
    fontSize: z.number().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    fontFamily: identifier.optional(),
    color: identifier.optional(),
    align: z.enum(["left", "center", "right"]).optional(),
    lineHeight: z.number().min(0.5).max(10).optional(),
  })
  .strict();
const layer = z.unknown().transform((value, context) => {
  try {
    validateDocument({ ...createDocument(), children: [value] });
    return value as LayerData;
  } catch {
    context.addIssue({ code: "custom", message: "Invalid layer tree." });
    return z.NEVER;
  }
});

const commandSchema: z.ZodType<EditorCommand> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("selection.set"),
        selection: selectionSchema.nullable(),
      })
      .strict(),
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
    z
      .object({
        type: z.literal("path.update"),
        id: identifier,
        pathId: identifier,
        patch: pathSchema.omit({ id: true }).partial(),
      })
      .strict(),
    z
      .object({
        type: z.literal("path.remove"),
        id: identifier,
        pathId: identifier,
      })
      .strict(),
    z.object({ type: z.literal("document.rename"), name: identifier }).strict(),
    z
      .object({
        type: z.literal("document.resize"),
        width: dimension,
        height: dimension,
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
        type: z.literal("transaction"),
        label: identifier,
        commands: z.array(commandSchema).max(256),
      })
      .strict(),
  ]),
);

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
