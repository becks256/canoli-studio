import { z } from "zod";
import { allLayers, BLEND_MODES, findLayer, findParent, id } from "./model";
import type { DocumentData, LayerData } from "./model";
import { defaultStyle, styleSchema } from "./drawing";
import { affineSchema } from "./transform-schema";
import { execute } from "./commands";
import type { EditorCommand, LayerPatch } from "./commands";

const identifier = z.string().min(1).max(240);
const coordinate = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const dimension = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
export const layerCompOptionsSchema = z
  .object({
    visibility: z.boolean(),
    position: z.boolean(),
    appearance: z.boolean(),
  })
  .strict()
  .refine(
    (options) => options.visibility || options.position || options.appearance,
    "Capture at least one layer property category.",
  );
export const layerCompSchema = z
  .object({
    id: identifier,
    name: identifier,
    documentId: identifier,
    options: layerCompOptionsSchema,
    layers: z.array(
      z
        .object({
          id: identifier,
          parentId: identifier.nullable(),
          visible: z.boolean().optional(),
          position: z
            .object({
              x: coordinate,
              y: coordinate,
              transform: affineSchema,
              width: dimension.optional(),
              height: dimension.optional(),
            })
            .strict()
            .optional(),
          appearance: z
            .object({
              opacity: z.number().min(0).max(1),
              fillOpacity: z.number().min(0).max(1),
              clipped: z.boolean().optional(),
              blendMode: z.custom<(typeof BLEND_MODES)[number]>((value) =>
                BLEND_MODES.includes(value as (typeof BLEND_MODES)[number]),
              ),
              styles: styleSchema,
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((comp, ctx) => {
    const ids = new Set<string>();
    for (const layer of comp.layers) {
      if (ids.has(layer.id))
        ctx.addIssue({
          code: "custom",
          message: "Duplicate layer comp target.",
        });
      ids.add(layer.id);
      if (
        (layer.visible !== undefined) !== comp.options.visibility ||
        (layer.position !== undefined) !== comp.options.position ||
        (layer.appearance !== undefined) !== comp.options.appearance
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Layer comp entries must match captured categories.",
        });
      }
      if (
        layer.position &&
        (layer.position.width === undefined) !==
          (layer.position.height === undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Layer comp dimensions must be paired.",
        });
    }
  });
export type LayerCompData = z.infer<typeof layerCompSchema>;
export type LayerCompOptions = z.infer<typeof layerCompOptionsSchema>;
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function equivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equivalent(a[key], b[key]))
  );
}

function position(layer: LayerData) {
  return {
    x: layer.x,
    y: layer.y,
    transform: layer.transform ?? identity,
    ...("width" in layer ? { width: layer.width, height: layer.height } : {}),
  };
}
function appearance(layer: LayerData) {
  return {
    opacity: layer.opacity,
    fillOpacity: layer.fillOpacity ?? 1,
    ...(layer.clipped?{clipped:true}:{}),
    blendMode: layer.blendMode,
    styles: layer.styles ?? defaultStyle(),
  };
}

/** Capture editable presentation, never pixel sources or layer contents. */
export function captureLayerComp(
  document: DocumentData,
  name: string,
  options: LayerCompOptions = {
    visibility: true,
    position: true,
    appearance: true,
  },
  compId = id(),
): LayerCompData {
  return layerCompSchema.parse({
    id: compId,
    name,
    documentId: document.id,
    options,
    layers: allLayers(document.children).map((layer) => ({
      id: layer.id,
      parentId: findParent(document.children, layer.id) ?? null,
      ...(options.visibility ? { visible: layer.visible } : {}),
      ...(options.position ? { position: position(layer) } : {}),
      ...(options.appearance ? { appearance: appearance(layer) } : {}),
    })),
  });
}

/** Build one shared transaction; missing layers are reported, new layers stay intact. */
export function planLayerComp(
  document: DocumentData,
  input: LayerCompData,
): {
  command: EditorCommand;
  missingLayerIds: string[];
} {
  const comp = layerCompSchema.parse(input);
  if (comp.documentId !== document.id)
    throw new Error("Layer comp belongs to another document.");
  const commands: EditorCommand[] = [],
    missingLayerIds: string[] = [];
  for (const saved of comp.layers) {
    const layer = findLayer(document, saved.id);
    if (!layer) {
      missingLayerIds.push(saved.id);
      continue;
    }
    const patch: LayerPatch = {};
    if (saved.visible !== undefined && saved.visible !== layer.visible)
      patch.visible = saved.visible;
    if (saved.position) {
      if ((findParent(document.children, layer.id) ?? null) !== saved.parentId)
        throw new Error(
          `Layer '${layer.name}' changed parent since this comp was captured. Recapture its position.`,
        );
      if ((saved.position.width !== undefined) !== "width" in layer)
        throw new Error(
          `Layer '${layer.name}' no longer has compatible geometry.`,
        );
      if (!equivalent(saved.position, position(layer)))
        Object.assign(patch, saved.position);
    }
    if (saved.appearance && !equivalent(
      {...saved.appearance,clipped:saved.appearance.clipped??false},
      {...appearance(layer),clipped:layer.clipped??false},
    ))
      Object.assign(patch, {clipped:false}, saved.appearance);
    if (Object.keys(patch).length)
      commands.push({ type: "layer.update", id: layer.id, patch });
  }
  const command: EditorCommand = {
    type: "transaction",
    label: `Apply comp: ${comp.name}`,
    commands,
  };
  execute(document, command); // Shared validation and locks must pass for the entire plan.
  return { command, missingLayerIds };
}

/** Rebind a copied document's saved targets without changing presentation values. */
export function rebindLayerComps(
  document: Pick<DocumentData, "id" | "layerComps">,
  layerIds: ReadonlyMap<string, string> = new Map(),
): void {
  for (const comp of document.layerComps ?? []) {
    comp.documentId = document.id;
    for (const layer of comp.layers) {
      layer.id = layerIds.get(layer.id) ?? layer.id;
      if (layer.parentId !== null)
        layer.parentId = layerIds.get(layer.parentId) ?? layer.parentId;
    }
  }
}
