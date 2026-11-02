import { AffineTransform } from "../core/affine";
import type { CloneTile } from "../core/drawing";
import type { WetAssetProvider } from "../core/wet-assets";
import { captureFloatCloneAssets } from "../core/float-clone-assets";
import {
  readFloatWetTileWindow,
  type FloatWetTileControl,
} from "../core/float-wet-tile";
import {
  validateWindow,
  type FloatSourceWindow,
} from "../core/float-source/types";
import { projectFloatWindow } from "./float-projection";
import type { PixelProcessor } from "./processor";
import { validateFloatWorkerWindow } from "./float-pixels";

export interface CapturedFloatClone {
  check(): void;
  dispose(): void;
  read(area: FloatSourceWindow, world: AffineTransform): Promise<Float32Array>;
}
/** Reconstruct the unmasked native source plane before current placement.
 * Adjacent tiles share interpolation halos. Ordered overlaps source-over once;
 * brush coverage and stroke opacity belong to the later paint compositor. */
export async function captureFloatClone(
  input: readonly CloneTile[],
  provider: WetAssetProvider,
  processor: Pick<PixelProcessor, "floatComposite">,
  control: FloatWetTileControl = {},
): Promise<CapturedFloatClone> {
  const assets = await captureFloatCloneAssets(input, provider, control);
  try {
    const tiles = assets.tiles,
      left = Math.min(...tiles.map((t) => t.region.x)) - 1,
      top = Math.min(...tiles.map((t) => t.region.y)) - 1,
      right = Math.max(...tiles.map((t) => t.region.x + t.region.width)) + 1,
      bottom = Math.max(...tiles.map((t) => t.region.y + t.region.height)) + 1,
      width = right - left,
      height = bottom - top;
    if (
      ![left, top, right, bottom, width, height].every(Number.isSafeInteger) ||
      width <= 0 ||
      height <= 0
    )
      throw new Error("Float clone source bounds exceed numeric precision.");
    const check = assets.check,
      source = {
        width,
        height,
        readWindow: async (input: FloatSourceWindow) => {
          check();
          const area = validateWindow(input),
            region = { ...area, x: area.x + left, y: area.y + top };
          let output: Float32Array = new Float32Array(
            region.width * region.height * 4,
          );
          for (const tile of tiles) {
            if (
              region.x >= tile.region.x + tile.region.width ||
              region.y >= tile.region.y + tile.region.height ||
              region.x + region.width <= tile.region.x ||
              region.y + region.height <= tile.region.y
            )
              continue;
            const pixels = await readFloatWetTileWindow(
              tile.original,
              tile.region.width,
              tile.region.height,
              {
                ...region,
                x: region.x - tile.region.x,
                y: region.y - tile.region.y,
              },
              { check },
            );
            check();
            const next = await processor.floatComposite(pixels, output, {
              mode: "normal",
              opacity: 1,
            });
            check();
            validateFloatWorkerWindow(next);
            if (next.length !== output.length)
              throw new Error(
                "Float clone reconstruction returned the wrong geometry.",
              );
            output = next;
          }
          check();
          return output;
        },
      };
    return Object.freeze({
      check,
      dispose: assets.dispose,
      read: async (area: FloatSourceWindow, world: AffineTransform) => {
        check();
        const output = await projectFloatWindow(
          source,
          world.multiply(AffineTransform.translation(left, top)),
          area,
          {
            isCancelled: () => {
              check();
              return false;
            },
          },
        );
        check();
        return output;
      },
    });
  } catch (error) {
    assets.dispose();
    throw error;
  }
}
