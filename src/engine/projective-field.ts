import { validateHdrWetField } from "../core/hdr-wet-field";
import { compileHdrWetProjectiveField } from "../core/hdr-wet-projective";
import { validateWetField } from "../core/wet-field";
import {
  captureFieldBounds,
  compileProjectiveField,
  type ProjectiveFieldOptions,
  type ProjectiveFieldDirection,
  type ProjectiveFieldInput,
} from "../core/projective-field";
import type { ProjectiveQuad } from "../core/projective";
import {
  captureFieldMapping,
  fieldMappingFromFrame,
  compileMappedField,
  type FieldMapping,
  type MappedFieldOptions,
} from "../core/mapped-field";
import {
  validateWindow,
  type FloatSourceWindow,
  type FloatSourceControl,
} from "../core/float-source/types";
import { validateFloatAlpha } from "../core/float-shadow";
import type { FloatProjectionControl } from "./float-projection";
import { checkRenderCurrent } from "./render-control";
import { yieldTask } from "../core/task-yield";

export interface ProjectiveFieldSource {
  /** Original/reference rectangle for the homography, independent of support. */
  channels?: 1 | 5;
  width: number;
  height: number;
  bounds: FloatSourceWindow | undefined;
  background: number;
  direction?: ProjectiveFieldDirection;
  input?: ProjectiveFieldInput;
  readWindow(
    bounds: FloatSourceWindow,
    control?: FloatSourceControl,
  ): Promise<Float32Array>;
}
export interface ProjectiveFieldSampler {
  floatProjectiveField(
    alpha: Float32Array,
    options: ProjectiveFieldOptions,
  ): Promise<Float32Array>;
  floatProjectiveWet?(
    alpha: Float32Array,
    options: ProjectiveFieldOptions,
  ): Promise<Float32Array>;
}

/** A constant-sign homography maps a rectangle to a convex quadrilateral.
 * Its bounding box can overlap finite support while the actual footprint misses
 * it. Separate on edge normals only with a strictly positive guarded gap. */
function missesField(
  points: readonly { x: number; y: number }[],
  field: FloatSourceWindow,
  padding: number,
): boolean {
  if (
    points.length !== 4 ||
    !Number.isFinite(padding) ||
    !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return false;
  const quad = [points[0], points[1], points[3], points[2]],
    origin = quad[0];
  const left = field.x - origin.x - padding,
    top = field.y - origin.y - padding,
    right = field.x - origin.x + field.width + padding,
    bottom = field.y - origin.y + field.height + padding;
  for (let i = 0; i < 4; i++) {
    const p = quad[i],
      q = quad[(i + 1) % 4],
      dx = q.x - p.x,
      dy = q.y - p.y,
      scale = Math.max(Math.abs(dx), Math.abs(dy));
    if (!scale || !Number.isFinite(scale)) continue;
    const nx = -dy / scale,
      ny = dx / scale;
    let min = Infinity,
      max = -Infinity;
    for (const point of quad) {
      const value = (point.x - origin.x) * nx + (point.y - origin.y) * ny;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    const a = left * nx,
      b = right * nx,
      c = top * ny,
      d = bottom * ny,
      lo = Math.min(a, b) + Math.min(c, d),
      hi = Math.max(a, b) + Math.max(c, d);
    if (
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      !Number.isFinite(lo) ||
      !Number.isFinite(hi)
    )
      continue;
    const magnitude = Math.max(
      1,
      Math.abs(min),
      Math.abs(max),
      Math.abs(a),
      Math.abs(b),
      Math.abs(c),
      Math.abs(d),
    );
    const tolerance = magnitude * Number.EPSILON * 128;
    if (
      Number.isFinite(tolerance) &&
      (max < lo - tolerance || hi < min - tolerance)
    )
      return true;
  }
  return false;
}

/** Project a scalar field, optionally bounded by finite support. Unknown support
 * streams complete inverse-sampling neighborhoods rather than clipping to an
 * image frame. A
 * linked mask may extend beyond the image; the image quad never clips this
 * plane. Sampling is at output pixel centers, with constant border neighbors.
 * Callers retain source leases and apply output-plane feather/settings later. */
export async function projectPerspectiveFieldWindow(
  source: ProjectiveFieldSource,
  processor: ProjectiveFieldSampler,
  corners: ProjectiveQuad,
  input: FloatSourceWindow,
  control: FloatProjectionControl = {},
): Promise<Float32Array<ArrayBuffer>> {
  const channels = source.channels ?? 1;
  if (
    (channels !== 1 && channels !== 5) ||
    (channels === 5 &&
      (source.background !== 0 || !processor.floatProjectiveWet))
  )
    throw new Error("Invalid projective field channels or background.");
  const width = source.width,
    height = source.height,
    absoluteField = source.bounds
      ? captureFieldBounds(source.bounds)
      : undefined,
    background = source.background,
    direction = source.direction;
  if (!absoluteField && (direction === "source-to-quad" || source.input))
    throw new Error("Unbounded fields require quad-to-source sampling.");
  const capturedInput = source.input,
    signature = JSON.stringify(capturedInput);
  const frameField = absoluteField ?? { x: 0, y: 0, width: 1, height: 1 };
  const bounds = validateWindow(input),
    read = source.readWindow;
  const compiled = compileProjectiveField({
    sourceWidth: width,
    sourceHeight: height,
    field: frameField,
    background,
    direction,
    input: capturedInput,
    source: { x: frameField.x, y: frameField.y, width: 1, height: 1 },
    output: bounds,
    corners,
  });
  const field = absoluteField
      ? {
          ...absoluteField,
          x: absoluteField.x - compiled.sourceOrigin.x,
          y: absoluteField.y - compiled.sourceOrigin.y,
        }
      : undefined,
    quad = compiled.options.corners,
    signal = control.signal,
    isCancelled = control.isCancelled;
  const check = () => {
    signal?.throwIfAborted();
    checkRenderCurrent(isCancelled);
    if (
      (source.channels ?? 1) !== channels ||
      source.width !== width ||
      source.height !== height ||
      source.direction !== direction ||
      source.background !== background ||
      source.readWindow !== read ||
      JSON.stringify(source.input) !== signature ||
      !!source.bounds !== !!absoluteField ||
      (absoluteField &&
        (source.bounds!.x !== absoluteField.x ||
          source.bounds!.y !== absoluteField.y ||
          source.bounds!.width !== absoluteField.width ||
          source.bounds!.height !== absoluteField.height))
    )
      throw new Error("Perspective field source geometry changed.");
  };
  return streamFieldWindow(
    {
      channels,
      field,
      bounds,
      background,
      ...compiled,
      create: (length: number) => new Float32Array(length),
      validate: channels === 5 ? validateWetField : validateFloatAlpha,
      read: (b, c) => read.call(source, b, c),
      check,
      sample: (alpha, nativeBounds, region) =>
        (channels === 5
          ? processor.floatProjectiveWet!.bind(processor)
          : processor.floatProjectiveField.bind(processor))(alpha, {
          sourceWidth: width,
          sourceHeight: height,
          corners: quad,
          field: absoluteField ?? nativeBounds,
          background,
          direction,
          input: compiled.options.input,
          source: nativeBounds,
          output: region,
        }),
    },
    control,
  ) as Promise<Float32Array<ArrayBuffer>>;
}

export interface MappedFieldSource {
  channels?: 1 | 5;
  bounds: FloatSourceWindow | undefined;
  background: number;
  readWindow(
    bounds: FloatSourceWindow,
    control?: FloatSourceControl,
  ): Promise<Float32Array>;
}
export interface MappedFieldSampler {
  floatMappedField(
    alpha: Float32Array,
    options: MappedFieldOptions,
  ): Promise<Float32Array>;
  floatMappedWet?(
    alpha: Float32Array,
    options: MappedFieldOptions,
  ): Promise<Float32Array>;
}

/** Retained relative-frame homography, including maps whose horizon crosses
 * an arbitrary reference rectangle. The field remains an independent plane. */
export async function projectMappedFieldWindow(
  source: MappedFieldSource,
  processor: MappedFieldSampler,
  inputMapping: FieldMapping,
  input: FloatSourceWindow,
  control: FloatProjectionControl = {},
): Promise<Float32Array<ArrayBuffer>> {
  const channels = source.channels ?? 1;
  if (
    (channels !== 1 && channels !== 5) ||
    (channels === 5 && (source.background !== 0 || !processor.floatMappedWet))
  )
    throw new Error("Invalid mapped field channels or background.");
  const mapping = captureFieldMapping(inputMapping),
    absoluteField = source.bounds
      ? captureFieldBounds(source.bounds)
      : undefined,
    background = source.background,
    bounds = validateWindow(input),
    read = source.readWindow,
    signal = control.signal,
    isCancelled = control.isCancelled;
  const frameField = absoluteField ?? {
    ...mapping.sourceOrigin,
    width: 1,
    height: 1,
  };
  const compiled = compileMappedField({
    mapping,
    field: frameField,
    source: { x: frameField.x, y: frameField.y, width: 1, height: 1 },
    output: bounds,
    background,
  });
  const field = absoluteField
    ? {
        ...absoluteField,
        x: absoluteField.x - mapping.sourceOrigin.x,
        y: absoluteField.y - mapping.sourceOrigin.y,
      }
    : undefined;
  const check = () => {
    signal?.throwIfAborted();
    checkRenderCurrent(isCancelled);
    if (
      (source.channels ?? 1) !== channels ||
      source.background !== background ||
      source.readWindow !== read ||
      !!source.bounds !== !!absoluteField ||
      (absoluteField &&
        (source.bounds!.x !== absoluteField.x ||
          source.bounds!.y !== absoluteField.y ||
          source.bounds!.width !== absoluteField.width ||
          source.bounds!.height !== absoluteField.height))
    )
      throw new Error("Mapped field source geometry changed.");
  };
  return streamFieldWindow(
    {
      channels,
      field,
      bounds,
      background,
      ...compiled,
      create: (length: number) => new Float32Array(length),
      validate: channels === 5 ? validateWetField : validateFloatAlpha,
      read: (b, c) => read.call(source, b, c),
      check,
      sample: (alpha, nativeBounds, region) =>
        (channels === 5
          ? processor.floatMappedWet!.bind(processor)
          : processor.floatMappedField.bind(processor))(alpha, {
          mapping,
          field: absoluteField ?? nativeBounds,
          background,
          source: nativeBounds,
          output: region,
        }),
    },
    control,
  ) as Promise<Float32Array<ArrayBuffer>>;
}

/** Private prepared HDR fields always have finite native support and zero
 * background. Geometry/ROI subdivision is shared with scalar and byte fields. */
export interface HdrWetFieldSource {
  bounds: FloatSourceWindow;
  readWindow(
    bounds: FloatSourceWindow,
    control?: FloatSourceControl,
  ): Promise<Float64Array>;
}
export interface HdrWetFieldSampler {
  floatMappedHdrWet(
    field: Float64Array,
    options: MappedFieldOptions,
  ): Promise<Float64Array>;
}
export async function projectMappedHdrWetFieldWindow(
  source: HdrWetFieldSource,
  processor: HdrWetFieldSampler,
  inputMapping: FieldMapping,
  input: FloatSourceWindow,
  control: FloatProjectionControl = {},
): Promise<Float64Array<ArrayBuffer>> {
  const mapping = captureFieldMapping(inputMapping),
    absoluteField = captureFieldBounds(source.bounds),
    bounds = validateWindow(input),
    read = source.readWindow;
  const compiled = compileMappedField({
    mapping,
    field: absoluteField,
    source: { x: absoluteField.x, y: absoluteField.y, width: 1, height: 1 },
    output: bounds,
    background: 0,
  });
  const field = {
    ...absoluteField,
    x: absoluteField.x - mapping.sourceOrigin.x,
    y: absoluteField.y - mapping.sourceOrigin.y,
  };
  const check = () => {
    control.signal?.throwIfAborted();
    checkRenderCurrent(control.isCancelled);
    if (
      source.readWindow !== read ||
      !source.bounds ||
      source.bounds.x !== absoluteField.x ||
      source.bounds.y !== absoluteField.y ||
      source.bounds.width !== absoluteField.width ||
      source.bounds.height !== absoluteField.height
    )
      throw new Error("HDR wet field source changed.");
  };
  return streamFieldWindow(
    {
      channels: 5,
      field,
      bounds,
      background: 0,
      ...compiled,
      create: (length: number) => new Float64Array(length),
      validate: validateHdrWetField,
      read: (b, c) => read.call(source, b, c),
      check,
      sample: (field, nativeBounds, region) =>
        processor.floatMappedHdrWet(field, {
          mapping,
          field: absoluteField,
          background: 0,
          source: nativeBounds,
          output: region,
        }),
    },
    control,
  ) as Promise<Float64Array<ArrayBuffer>>;
}
export async function projectPerspectiveHdrWetFieldWindow(
  source: HdrWetFieldSource & {
    width: number;
    height: number;
    direction?: ProjectiveFieldDirection;
    input?: ProjectiveFieldInput;
  },
  processor: HdrWetFieldSampler,
  corners: ProjectiveQuad,
  input: FloatSourceWindow,
  control: FloatProjectionControl = {},
): Promise<Float64Array<ArrayBuffer>> {
  const field = captureFieldBounds(source.bounds),
    width = source.width,
    height = source.height,
    direction = source.direction,
    signature = JSON.stringify(source.input),
    read = source.readWindow;
  const check = () => {
    control.signal?.throwIfAborted();
    checkRenderCurrent(control.isCancelled);
    if (
      source.width !== width ||
      source.height !== height ||
      source.direction !== direction ||
      JSON.stringify(source.input) !== signature ||
      source.readWindow !== read ||
      !source.bounds ||
      source.bounds.x !== field.x ||
      source.bounds.y !== field.y ||
      source.bounds.width !== field.width ||
      source.bounds.height !== field.height
    )
      throw new Error("HDR wet projective source changed.");
  };
  check();
  const compiled = compileHdrWetProjectiveField({
    sourceWidth: width,
    sourceHeight: height,
    field,
    source: { x: field.x, y: field.y, width: 1, height: 1 },
    output: input,
    background: 0,
    direction,
    input: source.input,
    corners,
  });
  const result = await projectMappedHdrWetFieldWindow(
    {
      bounds: field,
      readWindow: async (b, c) => {
        check();
        const result = await read.call(source, b, c);
        check();
        return result;
      },
    },
    processor,
    fieldMappingFromFrame(compiled),
    input,
    control,
  );
  check();
  return result;
}

type FieldArray = Float32Array | Float64Array;
interface FieldStream<T extends FieldArray> {
  channels: 1 | 5;
  field: FloatSourceWindow | undefined;
  bounds: FloatSourceWindow;
  background: number;
  inputOrigin: { x: number; y: number };
  sourceOrigin: { x: number; y: number };
  values: Float64Array;
  create(length: number): T;
  validate(value: unknown, pixels: number): void;
  read(bounds: FloatSourceWindow, control?: FloatSourceControl): Promise<T>;
  sample(
    alpha: T,
    source: FloatSourceWindow,
    output: FloatSourceWindow,
  ): Promise<T>;
  check(): void;
}

async function streamFieldWindow<T extends FieldArray>(
  stream: FieldStream<T>,
  control: FloatProjectionControl,
): Promise<T> {
  const {
      channels,
      field,
      bounds,
      background,
      values: m,
      read,
      sample,
      check,
    } = stream,
    compiled = stream,
    signal = control.signal;
  const validate = stream.validate;
  check();
  const output = stream.create(bounds.width * bounds.height * channels);
  output.fill(background);
  let deadline = performance.now() + 2;
  const render = async (region: FloatSourceWindow): Promise<void> => {
    check();
    if (performance.now() >= deadline) {
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
    const points = [];
    let negative = false,
      positive = false,
      horizon = false;
    let numeratorMagnitude = 0,
      denominatorMagnitude = 0,
      minimumDenominator = Infinity,
      coordinateMagnitude = 1;
    for (const py of [region.y, region.y + region.height - 1])
      for (const px of [region.x, region.x + region.width - 1]) {
        // Match native relative-frame arithmetic exactly, including pixel centers.
        const x = px - compiled.inputOrigin.x + 0.5,
          y = py - compiled.inputOrigin.y + 0.5,
          w = m[6] * x + m[7] * y + m[8];
        const nu = m[0] * x + m[1] * y + m[2],
          nv = m[3] * x + m[4] * y + m[5];
        if (!Number.isFinite(w) || !Number.isFinite(nu) || !Number.isFinite(nv))
          throw new Error(
            "Perspective field mapping exceeds working precision.",
          );
        negative ||= w < 0;
        positive ||= w > 0;
        horizon ||= w === 0;
        if (w !== 0) {
          const u = nu / w,
            v = nv / w;
          points.push({ x: u - 0.5, y: v - 0.5 });
          numeratorMagnitude = Math.max(
            numeratorMagnitude,
            Math.abs(m[0] * x) + Math.abs(m[1] * y) + Math.abs(m[2]),
            Math.abs(m[3] * x) + Math.abs(m[4] * y) + Math.abs(m[5]),
          );
          denominatorMagnitude = Math.max(
            denominatorMagnitude,
            Math.abs(m[6] * x) + Math.abs(m[7] * y) + Math.abs(m[8]),
          );
          minimumDenominator = Math.min(minimumDenominator, Math.abs(w));
          coordinateMagnitude = Math.max(
            coordinateMagnitude,
            Math.abs(u),
            Math.abs(v),
          );
        }
      }
    const split = async () => {
      if (region.width >= region.height && region.width > 1) {
        const half = Math.floor(region.width / 2);
        await render({ ...region, width: half });
        await render({
          ...region,
          x: region.x + half,
          width: region.width - half,
        });
      } else if (region.height > 1) {
        const half = Math.floor(region.height / 2);
        await render({ ...region, height: half });
        await render({
          ...region,
          y: region.y + half,
          height: region.height - half,
        });
      } else
        throw new Error(
          "Perspective field footprint cannot be resolved at working precision.",
        );
    };
    if (horizon || (negative && positive)) {
      if (region.width === 1 && region.height === 1) return; // Infinity has the field's constant background.
      await split();
      return;
    }
    // With a constant-sign affine denominator, rational coordinate extrema
    // over this rectangle lie at its corners. Include a guard neighbor for
    // roundoff; the native kernel rejects any missing finite-support sample.
    const minX = Math.min(...points.map((p) => p.x)),
      maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y)),
      maxY = Math.max(...points.map((p) => p.y));
    if (
      field &&
      (maxX < field.x - 1 ||
        maxY < field.y - 1 ||
        minX >= field.x + field.width ||
        minY >= field.y + field.height)
    )
      return;
    if (field) {
      // Cover dot-product/division roundoff throughout this rectangle, not only
      // projection arithmetic in the separating test. Ill-conditioned windows
      // retain the existing native sampling path. Two extra native neighbors
      // conservatively contain complete bilinear support and integer half ties.
      const denominatorError = denominatorMagnitude * Number.EPSILON * 32,
        lower = minimumDenominator - denominatorError;
      const error =
        lower > 0
          ? (numeratorMagnitude * Number.EPSILON * 32 +
              coordinateMagnitude * denominatorError) /
              lower +
            coordinateMagnitude * Number.EPSILON * 32
          : Infinity;
      if (missesField(points, field, 2 + error * 4)) return;
    }
    const x = field
        ? Math.max(field.x, Math.floor(Math.max(field.x - 1, minX)) - 1)
        : Math.floor(minX) - 1,
      y = field
        ? Math.max(field.y, Math.floor(Math.max(field.y - 1, minY)) - 1)
        : Math.floor(minY) - 1;
    const right = field
      ? Math.min(
          field.x + field.width,
          Math.floor(Math.min(field.x + field.width, maxX)) + 3,
        )
      : Math.floor(maxX) + 3;
    const bottom = field
      ? Math.min(
          field.y + field.height,
          Math.floor(Math.min(field.y + field.height, maxY)) + 3,
        )
      : Math.floor(maxY) + 3;
    if ((right - x) * (bottom - y) > 262144) {
      await split();
      return;
    }
    const nativeBounds = captureFieldBounds({
      x: x + compiled.sourceOrigin.x,
      y: y + compiled.sourceOrigin.y,
      width: right - x,
      height: bottom - y,
    });
    const alpha = await read(
      { ...nativeBounds },
      { signal, onProgress: check },
    );
    check();
    validate(alpha, nativeBounds.width * nativeBounds.height);
    const result = await sample(alpha, nativeBounds, region);
    check();
    validate(result, region.width * region.height);
    for (let row = 0; row < region.height; row++)
      output.set(
        result.subarray(
          row * region.width * channels,
          (row + 1) * region.width * channels,
        ),
        ((region.y - bounds.y + row) * bounds.width + region.x - bounds.x) *
          channels,
      );
  };
  await render(bounds);
  check();
  validate(output, bounds.width * bounds.height);
  return output;
}
