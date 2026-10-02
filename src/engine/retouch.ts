import { AffineTransform } from "../core/affine";
import { maskStrokeSchema } from "../core/masks";
import type { BrushStrokeData } from "../core/drawing";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { createCanvas, release } from "./canvas";
import type { RenderSpace } from "./canvas";
import { drawMaskStroke } from "./drawing";
import type { PixelProcessor } from "./processor";

/** Render one editable brush path into a sampled RGBA tile without changing source pixels. */
export async function renderTonalStroke(
  source: Uint8ClampedArray,
  brush: BrushStrokeData,
  adjustment: Omit<DodgeBurnOptions, "flow">,
  space: RenderSpace,
  processor: PixelProcessor,
  world = new AffineTransform(),
): Promise<Uint8ClampedArray> {
  if (source.length !== space.width * space.height * 4)
    throw new Error("Invalid retouch render tile geometry.");
  const captured = source.slice();
  const options = { ...adjustment, flow: 1 };
  const coverage = await renderRetouchCoverage(brush, space, processor, world);
  return processor.dodgeBurn(
    captured,
    space.width,
    space.height,
    options,
    coverage,
  );
}

/** Shared fixed-grid brush coverage for healing and tonal retouching. */
export async function renderRetouchCoverage(
  brush: BrushStrokeData,
  space: RenderSpace,
  processor: PixelProcessor,
  world = new AffineTransform(),
): Promise<Uint8Array> {
  space = { ...space };
  if (
    !Number.isSafeInteger(space.width) ||
    !Number.isSafeInteger(space.height) ||
    space.width <= 0 ||
    space.height <= 0 ||
    !Number.isSafeInteger(space.width * space.height * 4) ||
    ![space.x, space.y, space.sx, space.sy].every(Number.isFinite) ||
    space.sx <= 0 ||
    space.sy <= 0
  )
    throw new Error("Invalid retouch render tile geometry.");
  const entry = maskStrokeSchema.parse({ mode: "reveal", stroke: brush });
  // Rasterize on a fixed output-pixel grid: Canvas antialiasing can vary with its
  // clip bounds, so request-sized surfaces cannot guarantee identical tile edges.
  const cellSize = 256,
    gutter = 2;
  const pixelX = Math.floor(space.x * space.sx),
    pixelY = Math.floor(space.y * space.sy);
  if (
    ![pixelX, pixelY, pixelX + space.width, pixelY + space.height].every(
      Number.isSafeInteger,
    )
  ) {
    throw new Error("Retouch render coordinates exceed pixel-grid precision.");
  }
  const phaseX = space.x * space.sx - pixelX,
    phaseY = space.y * space.sy - pixelY;
  const coverage = new Uint8Array(space.width * space.height);
  if (entry.stroke.flow !== 0) {
    for (
      let cy = Math.floor(pixelY / cellSize) * cellSize;
      cy < pixelY + space.height;
      cy += cellSize
    ) {
      for (
        let cx = Math.floor(pixelX / cellSize) * cellSize;
        cx < pixelX + space.width;
        cx += cellSize
      ) {
        const padded = {
          ...space,
          x: (cx + phaseX - gutter) / space.sx,
          y: (cy + phaseY - gutter) / space.sy,
          width: cellSize + 2 * gutter,
          height: cellSize + 2 * gutter,
        };
        const mask = createCanvas(padded.width, padded.height, true);
        try {
          await drawMaskStroke(
            entry,
            mask,
            padded,
            0,
            0,
            processor,
            undefined,
            world,
          );
          const left = Math.max(cx, pixelX),
            top = Math.max(cy, pixelY);
          const width = Math.min(cx + cellSize, pixelX + space.width) - left;
          const height = Math.min(cy + cellSize, pixelY + space.height) - top;
          const rgba = mask
            .getContext("2d")!
            .getImageData(
              left - cx + gutter,
              top - cy + gutter,
              width,
              height,
            ).data;
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              coverage[(top - pixelY + y) * space.width + left - pixelX + x] =
                rgba[(y * width + x) * 4 + 3];
            }
        } finally {
          release(mask);
        }
      }
    }
  }
  return coverage;
}
