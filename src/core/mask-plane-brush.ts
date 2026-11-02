import { z } from "zod";
import { AffineTransform, type AffineBounds } from "./affine";
import { affineSchema } from "./transform-schema";
import { ProjectiveTransform } from "./projective";
import { perspectiveRect } from "./perspective";
import { captureFieldBounds } from "./projective-field";
import { captureFieldMapping } from "./mapped-field";
import {
  maskPlanePoseSchema,
  maskPlaneStepSchema,
  compileMaskPlane,
  appendMaskPlaneSteps,
  maskPlaneDisplaySteps,
  type MaskPlanePoseData,
  type MaskPlaneData,
} from "./mask-plane";
import type { LayerMaskData } from "./masks";

const size = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
export const mappedMaskPlacementSchema = z
  .object({
    kind: z.literal("mapped"),
    width: size,
    height: size,
    geometry: z
      .object({
        basis: affineSchema,
        pose: maskPlanePoseSchema,
        steps: z.array(maskPlaneStepSchema),
      })
      .strict(),
    authoring: affineSchema,
  })
  .strict();
export type MappedMaskPlacementData = z.infer<typeof mappedMaskPlacementSchema>;

export function captureMaskMappedPlacement(
  mask: LayerMaskData,
  owner: MaskPlanePoseData,
  authoring: AffineTransform,
  width: number,
  height: number,
  filterMask = false,
): MappedMaskPlacementData {
  const plane = mask.plane;
  if (!plane)
    throw new Error("Retained mask geometry is required for mapped painting.");
  return mappedMaskPlacementSchema.parse({
    kind: "mapped",
    width,
    height,
    geometry: {
      basis: plane.basis,
      pose: plane.pose,
      steps: appendMaskPlaneSteps(
        plane.steps,
        ...maskPlaneDisplaySteps(mask, owner, filterMask),
      ),
    },
    authoring: authoring.toJSON(),
  });
}

/** A complete brush field is pulled into native mask geometry. Its source and
 * geometry origins are fixed from the whole captured stroke, never from an ROI. */
export function maskMappedBrushMapping(
  input: MappedMaskPlacementData,
  stroke: AffineBounds,
) {
  const value = mappedMaskPlacementSchema.parse(input),
    sx = Math.ceil(value.width) / value.width,
    sy = Math.ceil(value.height) / value.height;
  const x = Math.floor(stroke.x * sx) - 3,
    y = Math.floor(stroke.y * sy) - 3,
    source = captureFieldBounds({
      x,
      y,
      width: Math.ceil((stroke.x + stroke.width) * sx) + 3 - x,
      height: Math.ceil((stroke.y + stroke.height) * sy) + 3 - y,
    });
  return {
    mapping: maskMappedFieldMapping(
      value,
      source,
      AffineTransform.scale(1 / sx, 1 / sy),
    ),
    source,
  };
}

/** Pull an arbitrary complete prepared field into retained native geometry. */
export function maskMappedFieldMapping(
  input: MappedMaskPlacementData,
  source: AffineBounds,
  nativeTransform: AffineTransform,
) {
  const value = mappedMaskPlacementSchema.parse(input),
    p = value.geometry;
  const sourceOrigin = {
    x: Math.floor(source.x + source.width / 2),
    y: Math.floor(source.y + source.height / 2),
  };
  const plane: MaskPlaneData = {
    ...p,
    reference: { kind: "pixels", width: p.pose.width, height: p.pose.height },
    phase: "document",
  };
  const compiled = compileMaskPlane(plane, {
      width: p.pose.width,
      height: p.pose.height,
    }),
    pull = new ProjectiveTransform(compiled.mapping.matrix),
    basis = compiled.basis,
    author = AffineTransform.fromJSON(value.authoring),
    authorLinear = new AffineTransform(author.a, author.b, author.c, author.d),
    toSource = nativeTransform.inverse().multiply(authorLinear.inverse());
  let geometryOrigin = { x: 0, y: 0 };
  try {
    const center = author.point(nativeTransform.point(sourceOrigin)),
      native = pull.point({
        x: center.x - compiled.mapping.inputOrigin.x,
        y: center.y - compiled.mapping.inputOrigin.y,
      });
    geometryOrigin = new AffineTransform(basis.a, basis.b, basis.c, basis.d)
      .inverse()
      .point({ x: native.x - basis.e, y: native.y - basis.f });
  } catch {
    /* A brush center on a horizon still has a valid complete field. */
  }
  const offset = toSource.point({
    x: compiled.mapping.inputOrigin.x - author.e,
    y: compiled.mapping.inputOrigin.y - author.f,
  });
  const matrix = ProjectiveTransform.fromAffine(
    AffineTransform.translation(
      offset.x - sourceOrigin.x,
      offset.y - sourceOrigin.y,
    ),
  )
    .multiply(
      ProjectiveTransform.fromAffine(
        new AffineTransform(toSource.a, toSource.b, toSource.c, toSource.d),
      ),
    )
    .multiply(pull.inverse())
    .multiply(ProjectiveTransform.fromAffine(basis))
    .multiply(
      ProjectiveTransform.fromAffine(
        AffineTransform.translation(geometryOrigin.x, geometryOrigin.y),
      ),
    );
  return captureFieldMapping({
    matrix: matrix.values,
    inputOrigin: geometryOrigin,
    sourceOrigin,
  });
}
export function mappedMaskBrushBounds(
  placement: MappedMaskPlacementData,
  stroke: AffineBounds,
): AffineBounds | undefined {
  try {
    const { mapping, source } = maskMappedBrushMapping(placement, stroke),
      relative = {
        ...source,
        x: source.x - mapping.sourceOrigin.x,
        y: source.y - mapping.sourceOrigin.y,
      },
      box = perspectiveRect(
        new ProjectiveTransform(mapping.matrix).inverse(),
        relative,
      ).bounds;
    const x = Math.floor(box.x + mapping.inputOrigin.x) - 2,
      y = Math.floor(box.y + mapping.inputOrigin.y) - 2;
    return {
      x,
      y,
      width: Math.ceil(box.x + box.width + mapping.inputOrigin.x) + 2 - x,
      height: Math.ceil(box.y + box.height + mapping.inputOrigin.y) + 2 - y,
    };
  } catch {
    return undefined;
  }
}
