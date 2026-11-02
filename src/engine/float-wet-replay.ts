import { AffineTransform } from "../core/affine";
import { ProjectiveTransform, type ProjectiveQuad } from "../core/projective";
import { perspectiveLocalQuad } from "../core/perspective";
import { affineMaskPose, pullMaskPlaneThrough } from "../core/mask-plane";
import { maskMappedFieldMapping } from "../core/mask-plane-brush";
import { wetPaintBounds, type WetPaintStrokeData } from "../core/wet-operation";
import { paintOperationSchema } from "../core/drawing";
import { freeze } from "../core/immutable";
import type { AssetStore } from "../core/assets";
import type { FloatSourceWindow } from "../core/float-source/types";
import { captureHdrWetAssetField } from "./hdr-wet-field";
import { wetBrowserAssets } from "./wet-composite";
import {
  projectMappedHdrWetFieldWindow,
  projectPerspectiveHdrWetFieldWindow,
} from "./projective-field";
import type { PixelProcessor } from "./processor";

export interface CapturedFloatWetReplay {
  readonly bounds: { x: number; y: number; width: number; height: number };
  read(region: FloatSourceWindow): Promise<Float64Array>;
  dispose(): void;
}

/** Pull authoritative prepared pigment/removal onto the original raster grid.
 * The current layer projection happens only after all modifiers have replayed.
 * Complete original validation also applies to hidden/zero-opacity strokes. */
export async function captureFloatWetReplay(
  input: WetPaintStrokeData,
  assets: AssetStore,
  processor: Pick<PixelProcessor, "floatMappedHdrWet">,
  logicalToNative: AffineTransform,
  current: () => void,
): Promise<CapturedFloatWetReplay> {
  const stroke = freeze(
    paintOperationSchema.parse(input),
  ) as WetPaintStrokeData;
  if (stroke.kind !== "wet" || stroke.precision !== "float32")
    throw new Error("Native float wet replay requires an explicit HDR stroke.");
  const field = await captureHdrWetAssetField(
    stroke.tiles,
    wetBrowserAssets(assets, current),
    { check: current },
  );
  try {
    const bounds = Object.freeze(
        logicalToNative.bounds(wetPaintBounds(stroke)),
      ),
      placement = stroke.placement,
      native = AffineTransform.fromJSON(stroke.nativeTransform);
    const check = () => {
        field.check();
        current();
      },
      control = {
        isCancelled: () => {
          check();
          return false;
        },
      };
    const frame = logicalToNative.multiply(native),
      sourceOrigin = {
        x: Math.floor(field.bounds.x + field.bounds.width / 2),
        y: Math.floor(field.bounds.y + field.bounds.height / 2),
      };
    const inverseLinear = new AffineTransform(
      frame.a,
      frame.b,
      frame.c,
      frame.d,
    ).inverse();
    const mapping =
      placement && "geometry" in placement
        ? pullMaskPlaneThrough(
            maskMappedFieldMapping(placement, field.bounds, native),
            { pose: affineMaskPose(logicalToNative), inverse: false },
          )
        : {
            matrix: ProjectiveTransform.fromAffine(inverseLinear).values,
            inputOrigin: frame.point(sourceOrigin),
            sourceOrigin,
          };
    const width = placement ? Math.ceil(placement.width) : 0,
      height = placement ? Math.ceil(placement.height) : 0;
    const placed =
      placement && "perspective" in placement
        ? {
            source: {
              ...field,
              width,
              height,
              direction: "source-to-quad" as const,
              input: {
                origin: { x: 0, y: 0 },
                matrix: AffineTransform.scale(
                  width / placement.width,
                  height / placement.height,
                )
                  .multiply(AffineTransform.fromJSON(placement.basis))
                  .multiply(logicalToNative.inverse())
                  .toJSON(),
              },
            },
            corners: perspectiveLocalQuad(
              placement.width,
              placement.height,
              placement.perspective,
            ).map((p) =>
              native.inverse().point(p),
            ) as unknown as ProjectiveQuad,
          }
        : undefined;
    check();
    return Object.freeze({
      bounds,
      dispose: () => field.dispose(),
      read: async (region: FloatSourceWindow) => {
        check();
        const result = placed
          ? await projectPerspectiveHdrWetFieldWindow(
              placed.source,
              processor,
              placed.corners,
              region,
              control,
            )
          : await projectMappedHdrWetFieldWindow(
              field,
              processor,
              mapping,
              region,
              control,
            );
        check();
        return result;
      },
    });
  } catch (error) {
    field.dispose();
    throw error;
  }
}
