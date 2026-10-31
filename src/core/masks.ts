import { z } from "zod";
import { affineSchema } from "./transform-schema";
import { AffineTransform } from "./affine";
import { rasterErasureSchema, paintOperationSchema, pathSchema, selectionSchema } from "./drawing";

import type { WetPaintStrokeData } from "./wet-operation";
import type { BrushStrokeData } from "./drawing";

export const maskStrokeSchema = z
  .object({
    mode: z.enum(["hide", "reveal"]),
    stroke: paintOperationSchema.refine(
      (value) =>
        (value.kind === "brush" || value.kind === "pencil") &&
        value.tiles.length === 0,
      "Masks accept brush or pencil strokes without source tiles.",
    ) as z.ZodType<BrushStrokeData>,
  })
  .strict();
export const wetMaskStrokeSchema=z.object({mode:z.literal('wet'),stroke:paintOperationSchema.refine(value=>value.kind==='wet','Wet mask operations require prepared native pixels.') as z.ZodType<WetPaintStrokeData>}).strict();
export const maskOperationSchema=z.discriminatedUnion('mode',[maskStrokeSchema,wetMaskStrokeSchema]);
export type MaskOperationData=z.infer<typeof maskOperationSchema>;
export const maskStrokePointCount=(entry:MaskOperationData)=>entry.stroke.kind==='wet'?entry.stroke.brush.points.length:entry.stroke.points.length;
export function assertMaskOperationVersion(mask:LayerMaskData,version:number){if(mask.kind==='raster-erasures'&&version<36)throw new Error('Raster erasure masks require schema version 36.');if(mask.kind==='raster-erasures'&&version<51&&mask.erasures.some(entry=>entry.placement))throw new Error('Placed erasures require document schema version 51.');if(version<34&&(mask.strokes??[]).some(entry=>entry.mode==='wet'))throw new Error('Wet mask coverage requires schema version 34.');}
export const maskStrokesSchema = z
  .array(maskOperationSchema)
  .max(2048)
  .refine(
    (strokes) =>
      strokes.reduce((sum, entry) => sum + maskStrokePointCount(entry), 0) <=
      200000,
    "A mask supports at most 200,000 stroke points.",
  );
const position = z
  .number()
  .finite()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const settings = {
  basis: affineSchema
    .refine(
      (value) => value.e === 0 && value.f === 0,
      "Mask basis translation must use x/y.",
    )
    .optional(),
  strokes: maskStrokesSchema.optional(),
  x: position.optional(),
  y: position.optional(),
  linked: z.boolean().optional(),
  feather: z.number().finite().min(0).max(128).optional(),
  enabled: z.boolean(),
  inverted: z.boolean(),
  density: z.number().finite().min(0).max(1),
};
const maskPath = z.object({ points: pathSchema.shape.points }).strict();
/** Geometry uses document-pixel units in a linked layer or unlinked document coordinate plane, before layer styles. */
export const layerMaskSchema = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("raster-erasures"),width:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),height:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
    erasures:z.array(rasterErasureSchema.refine(entry=>entry.stroke.kind!=="wet","Raster erasure coverage accepts only eraser and clear operations.")).max(2048),...settings}).strict(),
  z
    .object({
      kind: z.literal("paint"),
      base: z.number().finite().min(0).max(1),
      ...settings,
      strokes: maskStrokesSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("selection"),
      selection: selectionSchema,
      ...settings,
    })
    .strict(),
  z
    .object({
      kind: z.literal("vector"),
      paths: z.array(maskPath).max(128),
      fillRule: z.enum(["evenodd", "nonzero"]),
      ...settings,
    })
    .strict()
    .refine(
      (value) =>
        value.paths.reduce((sum, path) => sum + path.points.length, 0) <= 20000,
      "A vector mask supports at most 20,000 anchors in total.",
    ),
  z
    .object({
      kind: z.literal("bitmap"),
      assetId: z.string().min(1).max(240),
      ...settings,
    })
    .strict(),
]);
export type LayerMaskData = z.infer<typeof layerMaskSchema>;
/** Inert prepared records retain metadata/assets without changing geometry routing. */
export const hasMaskRefinements=(mask:LayerMaskData)=>!!mask.strokes?.some(entry=>entry.mode!=='wet'||entry.stroke.opacity>0);

/** Linked offsets are local to the layer; unlinked offsets are document-space. */
export function maskTransform(
  mask: LayerMaskData,
  layer: AffineTransform,
): AffineTransform {
  const offset = AffineTransform.translation(mask.x ?? 0, mask.y ?? 0).multiply(
    mask.basis ? AffineTransform.fromJSON(mask.basis) : new AffineTransform(),
  );
  return mask.linked === false ? offset : layer.multiply(offset);
}

/** Translation-only adapter for existing renderer and tool callers. */
export function maskOrigin(
  mask: LayerMaskData,
  layerX: number,
  layerY: number,
) {
  return maskTransform(mask, AffineTransform.translation(layerX, layerY)).point(
    { x: 0, y: 0 },
  );
}

/** All raw coverage inputs, excluding settings applied after rasterization. */
export function maskGeometry(mask: LayerMaskData) {
  return [
    mask.kind,
    mask.kind === "selection"
      ? mask.selection
      : mask.kind === "vector"
        ? [mask.paths, mask.fillRule]
        : mask.kind === "bitmap"
          ? mask.assetId
          : mask.kind === "raster-erasures" ? [mask.width,mask.height,mask.erasures] : mask.base,
    mask.strokes ?? [],
  ];
}
