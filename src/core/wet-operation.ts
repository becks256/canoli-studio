import { z } from 'zod';
import { AffineTransform, type AffineData } from './affine';
import type { BrushStrokeData, Rect } from './drawing';
import { affineSchema } from './transform-schema';
import { wetPaintLoadSchema, wetPaintMixSchema, type WetPaintLoadSettings, type WetPaintMixSettings } from './wet-paint';
import {perspectiveSchema,perspectiveMatrix,perspectiveLocalQuad,perspectiveRect,type PerspectiveData} from './perspective';
import {ProjectiveTransform} from './projective';

/** Tile pixels live in a placed authoring plane. Pull them through this captured
 * image mapping before the owner's current affine/perspective placement. */
export interface WetPaintPlacementData {width:number;height:number;perspective:PerspectiveData;basis:AffineData}
export const wetPaintPlacementSchema=z.object({width:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),height:z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),perspective:perspectiveSchema,basis:affineSchema}).strict().superRefine((value,context)=>{
 try{perspectiveLocalQuad(Math.ceil(value.width),Math.ceil(value.height),value.perspective);}catch(error){context.addIssue({code:'custom',message:error instanceof Error?error.message:String(error)});}
});
export function assertWetPaintVersion(stroke:{kind?:string;placement?:unknown},version:number){if(stroke.kind==='wet'&&stroke.placement!==undefined&&version<55)throw new Error('Placed wet paint requires schema version 55.');}

export interface WetPaintTileData extends Rect { assetId: string; coverage: { assetId: string }; }
/** Inert prepared metadata must not select a different pixel reconstruction. */
export function isActiveWetPaint(operation: { kind: string; opacity: number }): boolean { return operation.kind === 'wet' && operation.opacity > 0; }
/** Prepared native replacement. Brush selection/opacity is baked in its pixels;
 * opacity here is an independent, once-only envelope on the complete operation. */
export interface WetPaintStrokeData {
  id: string;
  kind: 'wet';
  opacity: number;
  clip: null;
  brush: BrushStrokeData;
  load: WetPaintLoadSettings;
  mix: WetPaintMixSettings;
  nativeTransform: AffineData;
  placement?:WetPaintPlacementData;
  tiles: WetPaintTileData[];
}

// Drawing supplies its nonrecursive brush schema; no runtime import cycle.
export function wetPaintOperationSchema(brush: z.ZodType<BrushStrokeData>) {
  const integer = z.number().finite().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
  const extent = integer.positive(), reference = z.object({ assetId: z.string().min(1).max(240) }).strict();
  const tile = z.object({ x: integer, y: integer, width: extent, height: extent, assetId: reference.shape.assetId, coverage: reference }).strict().superRefine((value, context) => {
    if (![value.x + value.width, value.y + value.height, value.width * value.height * 4].every(Number.isSafeInteger)) context.addIssue({ code: 'custom', message: 'Wet-paint native tile geometry exceeds numeric precision.' });
  });
  return z.object({
    id: reference.shape.assetId, kind: z.literal('wet'), opacity: z.number().finite().min(0).max(1), clip: z.null(),
    brush: brush.refine(value => (value.kind === 'brush' || value.kind === 'pencil') && value.tiles.length === 0, 'Wet-paint metadata requires a brush or pencil without clone tiles.'),
    load: wetPaintLoadSchema, mix: wetPaintMixSchema, nativeTransform: affineSchema,placement:wetPaintPlacementSchema.optional(),
    // Metadata grows with genuine native output; no image/tile-count tier.
    tiles: z.array(tile).min(1),
  }).strict();
}

export function wetPaintBounds(stroke: WetPaintStrokeData): Rect {
  const transform = AffineTransform.fromJSON(stroke.nativeTransform);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const placement=stroke.placement,matrix=placement?ProjectiveTransform.fromAffine(AffineTransform.fromJSON(placement.basis).inverse()).multiply(perspectiveMatrix(placement.width,placement.height,placement.perspective).inverse()).multiply(ProjectiveTransform.fromAffine(transform)):undefined;
  for (const tile of stroke.tiles) {
    // Bilinear sampling includes source neighbors outside the stored rectangle.
    // A horizon is genuinely unbounded; mask callers retain streaming coverage,
    // while finite artwork geometry must reject it before publication.
    const box=matrix?perspectiveRect(matrix,{x:tile.x-1,y:tile.y-1,width:tile.width+2,height:tile.height+2}).bounds:transform.bounds(tile);
    left = Math.min(left, box.x); top = Math.min(top, box.y); right = Math.max(right, box.x + box.width); bottom = Math.max(bottom, box.y + box.height);
  }
  if (![left, top, right, bottom, right - left, bottom - top].every(Number.isFinite)) throw new Error('Wet-paint bounds exceed working precision.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}
