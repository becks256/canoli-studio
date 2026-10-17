import { z } from 'zod';
import type { DocumentData } from './model';
import { findLayer } from './model';
import { layerTransform } from './spatial';
import { AffineTransform } from './affine';
import type { SelectionModificationControl } from './selection-modification';

export const selectSubjectOptionsSchema = z.object({
  targetLayerId: z.string().min(1).max(240).optional(),
  threshold: z.number().finite().min(0).max(1).default(.35),
  expandRadius: z.number().int().min(0).max(64).default(0),
}).strict();
export type SelectSubjectOptions = z.input<typeof selectSubjectOptionsSchema>;
export type SelectSubjectSettings = z.output<typeof selectSubjectOptionsSchema>;
export type SelectSubjectControl = SelectionModificationControl;
export const subjectRequestSchema = selectSubjectOptionsSchema.omit({targetLayerId:true}).extend({
  width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type SubjectRequest = z.output<typeof subjectRequestSchema>;

/** Original-pixel sampling and placement are separate; no synthetic scene fallback. */
export function subjectSource(document: DocumentData, options: SelectSubjectSettings,
  asset: (id: string) => {id: string; width: number; height: number}) {
  const layer = findLayer(document, options.targetLayerId ?? null);
  if (!layer || layer.kind !== 'raster') throw new Error('Select a raster layer for Select Subject.');
  const source = asset(layer.assetId);
  const transform = layerTransform(document, layer.id)!.multiply(AffineTransform.scale(layer.width/source.width, layer.height/source.height));
  return {assetId: source.id, width: source.width, height: source.height, transform: transform.toJSON()};
}
