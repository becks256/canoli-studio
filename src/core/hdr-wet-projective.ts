import { AffineTransform } from "./affine";
import { ProjectiveTransform } from "./projective";
import {
  compileProjectiveField,
  type ProjectiveFieldOptions,
} from "./projective-field";
import { compileMappedField } from "./mapped-field";

/** Preserve exact affine geometry instead of solving a rectangle through a
 * general homography. This is specific to the new Float64 HDR field path;
 * existing scalar and encoded-byte sampling keep their accepted arithmetic. */
export function compileHdrWetProjectiveField(input: ProjectiveFieldOptions) {
  const compiled = compileProjectiveField(input),
    options = compiled.options,
    [p, q, r, s] = options.corners;
  const ax = q.x - p.x,
    ay = q.y - p.y,
    bx = s.x - p.x,
    by = s.y - p.y;
  if (r.x - p.x !== ax + bx || r.y - p.y !== ay + by) return compiled;
  const forward = new AffineTransform(
    ax / options.sourceWidth,
    ay / options.sourceWidth,
    bx / options.sourceHeight,
    by / options.sourceHeight,
  );
  let matrix: AffineTransform;
  if (options.direction === "source-to-quad") {
    matrix = AffineTransform.translation(
      p.x - compiled.sourceOrigin.x,
      p.y - compiled.sourceOrigin.y,
    ).multiply(forward);
    if (options.input)
      matrix = matrix.multiply(AffineTransform.fromJSON(options.input.matrix));
  } else matrix = forward.inverse();
  const exact = compileMappedField({
    mapping: {
      matrix: ProjectiveTransform.fromAffine(matrix).values,
      inputOrigin: compiled.inputOrigin,
      sourceOrigin: compiled.sourceOrigin,
    },
    field: options.field,
    source: options.source,
    output: options.output,
    background: options.background,
  });
  return { ...compiled, values: exact.values };
}
