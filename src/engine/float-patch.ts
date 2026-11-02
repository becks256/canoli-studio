import {
  patchAdjustmentSchema,
  type PatchAdjustmentData,
} from "../core/adjustments";
import type { WetAssetProvider } from "../core/wet-assets";
import { captureFloatPatchAssets } from "../core/float-patch-assets";
import {
  readFloatWetTileWindow,
  type FloatWetTileControl,
} from "../core/float-wet-tile";
import { AffineTransform } from "../core/affine";
import type { FloatSourceWindow } from "../core/float-source/types";
import { projectFloatWindow } from "./float-projection";
import { validateFloatWorkerWindow } from "./float-pixels";
import { yieldTask } from "../core/task-yield";

export interface CapturedFloatPatch {
  check(): void;
  dispose(): void;
  read(area: FloatSourceWindow, world: AffineTransform): Promise<Float32Array>;
}
export async function captureFloatPatch(
  patch: PatchAdjustmentData,
  provider: Pick<WetAssetProvider, "get" | "check">,
  control: FloatWetTileControl = {},
): Promise<CapturedFloatPatch> {
  patch = patchAdjustmentSchema.parse(patch);
  const captured = await captureFloatPatchAssets([patch], provider, control);
  try {
    const tile = captured.tiles[0],
      width = tile.region.width,
      height = tile.region.height,
      check = captured.check;
    const source = {
      width: width + 2,
      height: height + 2,
      readWindow: (area: FloatSourceWindow) =>
        readFloatWetTileWindow(
          tile.original,
          width,
          height,
          { ...area, x: area.x - 1, y: area.y - 1 },
          { check },
        ),
    };
    return Object.freeze({
      check,
      dispose: captured.dispose,
      read: async (area: FloatSourceWindow, world: AffineTransform) => {
        check();
        const pixels = await projectFloatWindow(
          source,
          world
            .multiply(
              AffineTransform.scale(patch.width / width, patch.height / height),
            )
            .multiply(AffineTransform.translation(-1, -1)),
          area,
          {
            isCancelled: () => {
              check();
              return false;
            },
          },
        );
        check();
        return pixels;
      },
    });
  } catch (error) {
    captured.dispose();
    throw error;
  }
}

/** Source alpha is correction coverage. Replace color once while retaining
 * every target alpha word; uncovered/transparent pixels keep hidden RGB too. */
export async function applyFloatPatch(
  before: Float32Array,
  source: Float32Array,
  check: () => void,
): Promise<Float32Array> {
  check();
  validateFloatWorkerWindow(before);
  validateFloatWorkerWindow(source);
  if (source.length !== before.length)
    throw new Error("Native patch geometry differs from its backdrop.");
  const output = before.slice();
  let deadline = performance.now() + 2;
  for (let p = 0; p < output.length; p += 4) {
    const amount = source[p + 3];
    if (amount > 0 && before[p + 3] > 0)
      for (let c = 0; c < 3; c++)
        if (!Object.is(before[p + c], source[p + c]))
          output[p + c] =
            amount === 1
              ? source[p + c]
              : before[p + c] + amount * (source[p + c] - before[p + c]);
    if ((p & 511) === 0 && performance.now() >= deadline) {
      check();
      await yieldTask();
      check();
      deadline = performance.now() + 2;
    }
  }
  check();
  validateFloatWorkerWindow(output);
  return output;
}
