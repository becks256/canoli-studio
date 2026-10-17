import { z } from 'zod';
import { pathSchema, pathContours, PATH_POINT_LIMIT, type VectorPathData } from './drawing';
import { findLayer, isLocked, type DocumentData, type VectorLayerData } from './model';
import { layerTransform } from './spatial';

export const vectorBooleanOperationSchema = z.enum(['union', 'subtract', 'intersect', 'exclude']);
export type VectorBooleanOperation = z.infer<typeof vectorBooleanOperationSchema>;
const identifier = z.string().min(1).max(240);
export const vectorBooleanOperandsSchema = z.array(z.object({ layerId: identifier, pathId: identifier }).strict()).min(2).max(128)
  .refine(values => new Set(values.map(v => JSON.stringify([v.layerId, v.pathId]))).size === values.length, 'Boolean operands must be distinct.');
export const vectorBooleanSelectionSchema = z.object({ operation: vectorBooleanOperationSchema, operands: vectorBooleanOperandsSchema }).strict();
export type VectorBooleanSelection = z.infer<typeof vectorBooleanSelectionSchema>;
const contoursSchema = z.array(pathSchema.shape.points).max(128).refine(
  contours => contours.reduce((sum, points) => sum + points.length, 0) <= PATH_POINT_LIMIT,
  'Boolean geometry supports up to 20000 total anchors.',
);
export const vectorBooleanResultSchema = z.object({ contours: contoursSchema, fillRule: z.literal('nonzero') }).strict();
export type VectorBooleanResult = z.infer<typeof vectorBooleanResultSchema>;
export const vectorBooleanRequestSchema = z.object({
  operation: vectorBooleanOperationSchema,
  paths: z.array(z.object({ contours: contoursSchema.refine(c => c.length > 0, 'An operand requires a contour.'), fillRule: z.enum(['nonzero', 'evenodd']) }).strict()).min(2).max(128),
}).strict().superRefine((value, context) => {
  const contours = value.paths.flatMap(p => p.contours);
  if (contours.length > 128 || contours.reduce((sum, points) => sum + points.length, 0) > PATH_POINT_LIMIT)
    context.addIssue({ code: 'custom', message: 'A Boolean operation supports 128 input contours and 20000 total anchors.' });
});
export type VectorBooleanRequest = z.infer<typeof vectorBooleanRequestSchema>;
export interface VectorBooleanProgress { completed: number; total: number }
export interface VectorBooleanControl { signal?: AbortSignal; onProgress?(progress: VectorBooleanProgress): void }

/** Private preparation captures immutable document geometry in the first path's plane. */
export function captureVectorBoolean(document: DocumentData, value: VectorBooleanSelection) {
  const selection = vectorBooleanSelectionSchema.parse(value);
  const sources = selection.operands.map(ref => {
    const layer = findLayer(document, ref.layerId);
    if (layer?.kind !== 'vector') throw new Error('Boolean operands require attached vector layers.');
    if (isLocked(document, layer.id)) throw new Error('Unlock every operand and its ancestors first.');
    const path = layer.paths.find(p => p.id === ref.pathId);
    if (!path) throw new Error('Boolean operand path not found.');
    if (!path.closed) throw new Error('Boolean operations require closed paths.');
    return { layer, path };
  });
  const inverse = sources.some(source=>source.layer.id!==sources[0].layer.id)
    ? layerTransform(document, sources[0].layer.id)!.inverse() : null;
  const paths = sources.map(({ layer, path }) => {
    if (layer.id === sources[0].layer.id) return {fillRule:path.fillRule??'nonzero' as const,contours:pathContours(path).map(c=>c.points)};
    const matrix = inverse!.multiply(layerTransform(document, layer.id)!);
    return { fillRule: path.fillRule ?? 'nonzero' as const, contours: pathContours(path).map(c => c.points.map(p => ({
      ...matrix.point(p), in: matrix.point(p.in), out: matrix.point(p.out),
    }))) };
  });
  return { selection, first: sources[0], request: vectorBooleanRequestSchema.parse({ operation: selection.operation, paths }) };
}

/** Validated final geometry replaces all operands in one atomic shared command. */
export function replaceVectorPaths(document: DocumentData, operands: VectorBooleanSelection['operands'], result: VectorPathData | null) {
  const refs = vectorBooleanOperandsSchema.parse(operands);
  const first = refs[0], grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    const layer = findLayer(document, ref.layerId);
    if (layer?.kind !== 'vector' || !layer.paths.some(p => p.id === ref.pathId)) throw new Error('Boolean operand path not found.');
    if (!layer.paths.find(p=>p.id===ref.pathId)!.closed) throw new Error('Boolean operations require closed paths.');
    if (isLocked(document, layer.id)) throw new Error('Unlock every operand and its ancestors first.');
    const ids = grouped.get(layer.id) ?? new Set<string>(); ids.add(ref.pathId); grouped.set(layer.id, ids);
  }
  if (result) {
    pathSchema.parse(result);
    if (result.id !== first.pathId || !result.closed) throw new Error('Replacement must retain the first closed path identity.');
  }
  for (const [layerId, ids] of grouped) {
    const layer = findLayer(document, layerId) as VectorLayerData;
    layer.paths = layer.paths.flatMap(path => path.id === first.pathId && layerId === first.layerId
      ? result ? [structuredClone(result)] : [] : ids.has(path.id) ? [] : [path]);
  }
  // Only empty operand layers are removed; other content and parent groups retain identity.
  const clean = (children: DocumentData['children']) => {
    for (let i = children.length - 1; i >= 0; i--) {
      const layer = children[i];
      if (layer.kind === 'group') clean(layer.children);
      else if (layer.kind === 'vector' && grouped.has(layer.id) && !layer.paths.length) children.splice(i, 1);
    }
  };
  clean(document.children);
}
