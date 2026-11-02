import { z } from "zod";
import { ProjectiveTransform, type ProjectiveData } from "./projective";
import { captureFieldBounds } from "./projective-field";
import { validateWindow, type FloatSourceWindow } from "./float-source/types";

const finite = z.number().finite(),
  point = z.object({ x: finite, y: finite }).strict();
const origin = z
  .object({ x: z.number().int().safe(), y: z.number().int().safe() })
  .strict();
const coefficient = z.tuple([
  finite,
  finite,
  finite,
  finite,
  finite,
  finite,
  finite,
  finite,
  finite,
]);
export const fieldMappingSchema = z
  .object({ matrix: coefficient, inputOrigin: point, sourceOrigin: origin })
  .strict();
/** Private pull mapping. Subtract inputOrigin before the homogeneous multiply;
 * add sourceOrigin only when addressing original native field pixels. */
export interface FieldMapping {
  matrix: ProjectiveData;
  inputOrigin: { x: number; y: number };
  sourceOrigin: { x: number; y: number };
}
export interface MappedFieldOptions {
  mapping: FieldMapping;
  field: FloatSourceWindow;
  source: FloatSourceWindow;
  output: FloatSourceWindow;
  background: number;
}
const rectangle = z
  .object({
    x: z.number().int().safe(),
    y: z.number().int().safe(),
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
  })
  .strict();
const schema = z
  .object({
    mapping: fieldMappingSchema,
    field: rectangle,
    source: rectangle,
    output: rectangle,
    background: finite.min(0).max(1),
  })
  .strict();

export function captureFieldMapping(input: FieldMapping): FieldMapping {
  const value = fieldMappingSchema.parse(input);
  // Check invertibility without normalizing/reordering any sampled coefficient.
  new ProjectiveTransform(value.matrix).inverse();
  return Object.freeze({
    matrix: Object.freeze(value.matrix),
    inputOrigin: Object.freeze(value.inputOrigin),
    sourceOrigin: Object.freeze(value.sourceOrigin),
  });
}

/** Retain exact compiled coefficients/origins without solving corners again. */
export function fieldMappingFromFrame(frame: {
  values: Float64Array;
  inputOrigin: { x: number; y: number };
  sourceOrigin: { x: number; y: number };
}): FieldMapping {
  return captureFieldMapping({
    matrix: Array.from(
      frame.values.subarray(0, 9),
    ) as unknown as ProjectiveData,
    inputOrigin: frame.inputOrigin,
    sourceOrigin: frame.sourceOrigin,
  });
}

/** The same scalar native ABI, with an already retained relative-frame map.
 * Reference rectangles/corners are not needed and do not clip finite support. */
export function compileMappedField(input: MappedFieldOptions) {
  const options = schema.parse(input),
    mapping = captureFieldMapping(options.mapping),
    field = captureFieldBounds(options.field),
    source = validateWindow(options.source),
    output = validateWindow(options.output);
  if (
    source.x < field.x ||
    source.y < field.y ||
    source.x + source.width > field.x + field.width ||
    source.y + source.height > field.y + field.height
  )
    throw new Error(
      "Mapped field source window lies outside the finite field.",
    );
  const localField = captureFieldBounds({
      ...field,
      x: field.x - mapping.sourceOrigin.x,
      y: field.y - mapping.sourceOrigin.y,
    }),
    localSource = validateWindow({
      ...source,
      x: source.x - mapping.sourceOrigin.x,
      y: source.y - mapping.sourceOrigin.y,
    });
  return {
    options: { ...options, mapping, field, source, output },
    inputOrigin: mapping.inputOrigin,
    sourceOrigin: mapping.sourceOrigin,
    values: new Float64Array([
      ...mapping.matrix,
      mapping.inputOrigin.x,
      mapping.inputOrigin.y,
      localField.x,
      localField.y,
      localField.width,
      localField.height,
      localSource.x,
      localSource.y,
      localSource.width,
      localSource.height,
      output.x,
      output.y,
      output.width,
      output.height,
      options.background,
    ]),
  };
}
