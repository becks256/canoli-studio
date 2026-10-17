import { z } from "zod";
import type { SelectionData } from "./drawing";
import { translateSelection, selectionRegionTransform } from "./drawing";
import { allLayers } from "./model";
import type { DocumentData } from "./model";

const integer = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const cropBoundsSchema = z
  .object({
    x: integer,
    y: integer,
    width: integer.positive(),
    height: integer.positive(),
  })
  .strict()
  .refine(
    (bounds) =>
      Number.isSafeInteger(bounds.x + bounds.width) &&
      Number.isSafeInteger(bounds.y + bounds.height),
    "Crop edges must be safely representable integer coordinates.",
  );
export type CropBounds = z.infer<typeof cropBoundsSchema>;

/** Rebase the canvas; retain every layer, operation and original asset reference. */
export function cropDocument(document: DocumentData, input: CropBounds): void {
  const { x, y, width, height } = cropBoundsSchema.parse(input);
  for (const layer of document.children) {
    layer.x -= x;
    layer.y -= y;
  }
  for (const layer of allLayers(document.children)) {
    if (
      (x || y) &&
      layer.kind === "smart-object" &&
      layer.filterMask?.linked === false
    ) {
      layer.filterMask.x = (layer.filterMask.x ?? 0) - x;
      layer.filterMask.y = (layer.filterMask.y ?? 0) - y;
    }
    if ((x || y) && layer.mask?.linked === false) {
      layer.mask.x = (layer.mask.x ?? 0) - x;
      layer.mask.y = (layer.mask.y ?? 0) - y;
    }
  }
  // Comp positions use the same local coordinate system as their captured layers.
  // Only captured roots move with the canvas origin; nested positions stay local.
  for (const comp of document.layerComps ?? []) {
    for (const layer of comp.layers) {
      if (layer.position && layer.parentId === null) {
        layer.position.x -= x;
        layer.position.y -= y;
      }
    }
  }
  for (const guide of document.guides ?? []) {
    guide.position -= guide.orientation === "vertical" ? x : y;
  }
  if (document.selection)
    document.selection = translateSelection(document.selection, -x, -y);
  for(const channel of document.alphaChannels??[])
    channel.selection=translateSelection(channel.selection,-x,-y)!;
  document.width = width;
  document.height = height;
}

export function cropFromSelection(
  selection: SelectionData | null | undefined,
): CropBounds | null {
  const region = selection?.regions.length === 1 ? selection.regions[0] : null;
  if (region?.shape !== "rectangle" || region.operation !== "add") return null;
  const transformed = selectionRegionTransform(region).bounds(region);
  const bounds = cropBoundsSchema.safeParse({
    x: Math.floor(transformed.x),
    y: Math.floor(transformed.y),
    width:
      Math.ceil(transformed.x + transformed.width) - Math.floor(transformed.x),
    height:
      Math.ceil(transformed.y + transformed.height) - Math.floor(transformed.y),
  });
  return bounds.success ? bounds.data : null;
}
