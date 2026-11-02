import { z } from "zod";
import { AffineTransform, type AffineData, type AffinePoint } from "./affine";
import { affineSchema } from "./transform-schema";
import {
  perspectiveSchema,
  perspectiveLocalQuad,
  perspectiveMatrix,
  activePerspective,
  IDENTITY_PERSPECTIVE,
  type PerspectiveData,
} from "./perspective";
import { ProjectiveTransform, type ProjectiveQuad } from "./projective";
import { compileProjectiveField } from "./projective-field";
import {
  captureFieldMapping,
  fieldMappingFromFrame,
  type FieldMapping,
} from "./mapped-field";
import type { LayerMaskData } from "./masks";

const size = z.number().finite().positive().max(Number.MAX_SAFE_INTEGER);
export interface MaskPlanePoseData {
  width: number;
  height: number;
  perspective: PerspectiveData;
  transform: AffineData;
}
export const maskPlanePoseSchema: z.ZodType<MaskPlanePoseData> = z
  .object({
    width: size,
    height: size,
    perspective: perspectiveSchema,
    transform: affineSchema,
  })
  .strict();
export const maskPlaneStepSchema = z
  .object({ pose: maskPlanePoseSchema, inverse: z.boolean() })
  .strict();
export type MaskPlaneStepData = z.infer<typeof maskPlaneStepSchema>;
export const maskPlaneSchema = z
  .object({
    reference: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("asset"),
          assetId: z.string().min(1).max(240),
        })
        .strict(),
      z
        .object({ kind: z.literal("pixels"), width: size, height: size })
        .strict(),
    ]),
    basis: affineSchema,
    pose: maskPlanePoseSchema,
    steps: z.array(maskPlaneStepSchema),
    phase: z.enum(["document", "native"]),
  })
  .strict();
export type MaskPlaneData = z.infer<typeof maskPlaneSchema>;

export function affineMaskPose(transform: AffineTransform): MaskPlanePoseData {
  return {
    width: 1,
    height: 1,
    perspective: { corners: IDENTITY_PERSPECTIVE },
    transform: transform.toJSON(),
  };
}
function identityAffine(value: AffineData) {
  return (
    value.a === 1 &&
    value.b === 0 &&
    value.c === 0 &&
    value.d === 1 &&
    value.e === 0 &&
    value.f === 0
  );
}
function sameAffine(a: AffineData, b: AffineData) {
  return (
    a.a === b.a &&
    a.b === b.b &&
    a.c === b.c &&
    a.d === b.d &&
    a.e === b.e &&
    a.f === b.f
  );
}
export function sameMaskPose(a: MaskPlanePoseData, b: MaskPlanePoseData) {
  if (!sameAffine(a.transform, b.transform)) return false;
  if (!activePerspective(a.perspective) && !activePerspective(b.perspective))
    return true;
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.perspective.corners.every(
      (p, i) =>
        p.x === b.perspective.corners[i].x &&
        p.y === b.perspective.corners[i].y,
    )
  );
}
/** Cancel captured inverse/forward poses before arithmetic. A linkage toggle
 * must not add interpolation or perturb an unchanged native mapping. */
export function appendMaskPlaneSteps(
  initial: readonly MaskPlaneStepData[],
  ...additional: MaskPlaneStepData[]
): MaskPlaneStepData[] {
  const steps: MaskPlaneStepData[] = [];
  for (const step of [...initial, ...additional]) {
    if (
      !activePerspective(step.pose.perspective) &&
      identityAffine(step.pose.transform)
    )
      continue;
    const last = steps.at(-1);
    if (
      last &&
      last.inverse !== step.inverse &&
      sameMaskPose(last.pose, step.pose)
    )
      steps.pop();
    else steps.push(step);
  }
  return steps;
}
export function maskPosePoint(
  pose: MaskPlanePoseData,
  point: AffinePoint,
  inverse = false,
): AffinePoint {
  const world = AffineTransform.fromJSON(pose.transform),
    projected = activePerspective(pose.perspective);
  if (!inverse)
    return world.point(
      projected
        ? perspectiveMatrix(pose.width, pose.height, pose.perspective).point(
            point,
          )
        : point,
    );
  const linear = new AffineTransform(
      world.a,
      world.b,
      world.c,
      world.d,
    ).inverse(),
    local = linear.point({ x: point.x - world.e, y: point.y - world.f });
  return projected
    ? perspectiveMatrix(pose.width, pose.height, pose.perspective)
        .inverse()
        .point(local)
    : local;
}
export function maskPoseCorners(pose: MaskPlanePoseData): ProjectiveQuad {
  const world = AffineTransform.fromJSON(pose.transform);
  return perspectiveLocalQuad(pose.width, pose.height, pose.perspective).map(
    (p) => world.point(p),
  ) as unknown as ProjectiveQuad;
}
export function maskOwnerPose(
  layer: {
    kind: string;
    width?: number;
    height?: number;
    perspective?: PerspectiveData | null;
  },
  world: AffineTransform,
  master?: { width: number; height: number },
): MaskPlanePoseData {
  const image = layer.kind === "raster" || layer.kind === "smart-object",
    width = image ? (master?.width ?? layer.width!) : 1,
    height = image ? (master?.height ?? layer.height!) : 1;
  const transform = master
    ? world.multiply(
        AffineTransform.scale(layer.width! / width, layer.height! / height),
      )
    : world;
  return maskPlanePoseSchema.parse({
    width,
    height,
    perspective:
      image && layer.perspective
        ? layer.perspective
        : { corners: IDENTITY_PERSPECTIVE },
    transform: transform.toJSON(),
  });
}
export function maskPlaneDisplaySteps(
  mask: LayerMaskData,
  owner: MaskPlanePoseData,
  filterMask = false,
  post?: AffineTransform,
): MaskPlaneStepData[] {
  const linked = mask.linked !== false,
    placedBefore = !linked || filterMask;
  const affine = AffineTransform.translation(
    (mask.x ?? 0) + (placedBefore ? (mask.placedX ?? 0) : 0),
    (mask.y ?? 0) + (placedBefore ? (mask.placedY ?? 0) : 0),
  ).multiply(
    mask.basis ? AffineTransform.fromJSON(mask.basis) : new AffineTransform(),
  );
  const steps: MaskPlaneStepData[] = [
    { pose: affineMaskPose(affine), inverse: false },
  ];
  if (linked) {
    const pose = filterMask
      ? owner
      : {
          ...owner,
          transform: AffineTransform.fromJSON(owner.transform)
            .multiply(
              AffineTransform.translation(mask.placedX ?? 0, mask.placedY ?? 0),
            )
            .toJSON(),
        };
    steps.push({ pose, inverse: false });
  }
  if (post) steps.push({ pose: affineMaskPose(post), inverse: false });
  return appendMaskPlaneSteps([], ...steps);
}
/** Capture the current display plane, then attach its inverse owner pose when
 * linking. Exact captured pose pairs cancel before any sampling arithmetic. */
export function relinkMaskPlane(
  mask: LayerMaskData,
  owner: MaskPlanePoseData,
  linked: boolean,
  reference?: MaskPlaneData["reference"],
  filterMask = false,
): LayerMaskData {
  let plane = mask.plane,
    steps: MaskPlaneStepData[];
  if (plane)
    steps = appendMaskPlaneSteps(
      plane.steps,
      ...maskPlaneDisplaySteps(mask, owner, filterMask),
    );
  else {
    const wasLinked = mask.linked !== false;
    if (wasLinked && !reference)
      throw new Error(
        "A native source-grid reference is required to unlink this mask.",
      );
    const pose = wasLinked
      ? filterMask
        ? owner
        : {
            ...owner,
            transform: AffineTransform.fromJSON(owner.transform)
              .multiply(
                AffineTransform.translation(
                  mask.placedX ?? 0,
                  mask.placedY ?? 0,
                ),
              )
              .toJSON(),
          }
      : affineMaskPose(new AffineTransform());
    const placedBefore = !wasLinked || filterMask,
      basis = AffineTransform.translation(
        (mask.x ?? 0) + (placedBefore ? (mask.placedX ?? 0) : 0),
        (mask.y ?? 0) + (placedBefore ? (mask.placedY ?? 0) : 0),
      ).multiply(
        mask.basis
          ? AffineTransform.fromJSON(mask.basis)
          : new AffineTransform(),
      );
    plane = {
      reference: wasLinked
        ? reference!
        : { kind: "pixels", width: 1, height: 1 },
      basis: basis.toJSON(),
      pose,
      phase: wasLinked && filterMask ? "native" : "document",
      steps: [],
    };
    steps = [];
  }
  if (linked)
    steps = appendMaskPlaneSteps(steps, { pose: owner, inverse: true });
  return {
    ...mask,
    plane: maskPlaneSchema.parse({ ...plane, steps }),
    linked,
    x: 0,
    y: 0,
    placedX: 0,
    placedY: 0,
    basis: new AffineTransform().toJSON(),
  };
}
/** Change only the destination frame. Distant affine placement remains outside
 * projective cofactors; the native source lattice/origin never changes. */
export function pullMaskPlaneThrough(
  input: FieldMapping,
  step: MaskPlaneStepData,
): FieldMapping {
  const mapping = captureFieldMapping(input),
    pose = maskPlanePoseSchema.parse(step.pose),
    world = AffineTransform.fromJSON(pose.transform),
    linear = new AffineTransform(world.a, world.b, world.c, world.d);
  const matrix = new ProjectiveTransform(mapping.matrix);
  let pull: ProjectiveTransform, inputOrigin: AffinePoint;
  if (!activePerspective(pose.perspective)) {
    if (step.inverse) {
      inputOrigin = linear
        .inverse()
        .point({
          x: mapping.inputOrigin.x - world.e,
          y: mapping.inputOrigin.y - world.f,
        });
      pull = ProjectiveTransform.fromAffine(linear);
    } else {
      inputOrigin = world.point(mapping.inputOrigin);
      pull = ProjectiveTransform.fromAffine(linear.inverse());
    }
  } else if (step.inverse) {
    inputOrigin = { x: 0, y: 0 };
    pull = ProjectiveTransform.fromAffine(
      new AffineTransform(
        world.a,
        world.b,
        world.c,
        world.d,
        world.e - mapping.inputOrigin.x,
        world.f - mapping.inputOrigin.y,
      ),
    ).multiply(perspectiveMatrix(pose.width, pose.height, pose.perspective));
  } else {
    inputOrigin = { x: world.e, y: world.f };
    pull = ProjectiveTransform.fromAffine(
      AffineTransform.translation(
        -mapping.inputOrigin.x,
        -mapping.inputOrigin.y,
      ),
    )
      .multiply(
        perspectiveMatrix(pose.width, pose.height, pose.perspective).inverse(),
      )
      .multiply(ProjectiveTransform.fromAffine(linear.inverse()));
  }
  return captureFieldMapping({
    matrix: matrix.multiply(pull).values,
    inputOrigin,
    sourceOrigin: mapping.sourceOrigin,
  });
}
export function compileMaskPlane(
  plane: MaskPlaneData,
  reference: { width: number; height: number },
  additional: readonly MaskPlaneStepData[] = [],
) {
  const value = maskPlaneSchema.parse(plane),
    width = size.parse(reference.width),
    height = size.parse(reference.height),
    corners = maskPoseCorners(value.pose);
  const steps = appendMaskPlaneSteps(value.steps, ...additional);
  let mapping: FieldMapping;
  if (steps[0]?.inverse && sameMaskPose(value.pose, steps[0].pose)) {
    // Preserve the original native filter lattice exactly when the captured
    // image placement cancels. No projective multiply or second interpolation.
    mapping = captureFieldMapping({
      matrix: ProjectiveTransform.fromAffine(
        AffineTransform.scale(
          width / value.pose.width,
          height / value.pose.height,
        ),
      ).values,
      inputOrigin: { x: 0, y: 0 },
      sourceOrigin: { x: 0, y: 0 },
    });
    steps.shift();
  } else {
    const nativeInteger =
      Number.isSafeInteger(width) && Number.isSafeInteger(height);
    const frame = compileProjectiveField({
      sourceWidth: nativeInteger ? width : 1,
      sourceHeight: nativeInteger ? height : 1,
      corners,
      field: { x: 0, y: 0, width: 1, height: 1 },
      source: { x: 0, y: 0, width: 1, height: 1 },
      output: { x: 0, y: 0, width: 1, height: 1 },
      background: 0,
    });
    mapping = fieldMappingFromFrame(frame);
    if (!nativeInteger)
      mapping = captureFieldMapping({
        ...mapping,
        matrix: ProjectiveTransform.fromAffine(
          AffineTransform.scale(width, height),
        ).multiply(new ProjectiveTransform(mapping.matrix)).values,
      });
  }
  const baseMapping = mapping;
  for (const step of steps) mapping = pullMaskPlaneThrough(mapping, step);
  const basis = AffineTransform.scale(
    width / value.pose.width,
    height / value.pose.height,
  ).multiply(AffineTransform.fromJSON(value.basis));
  return { mapping, baseMapping, basis, steps };
}
