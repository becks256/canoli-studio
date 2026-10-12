import { AffineTransform } from "../core/affine";
import { maskStrokeSchema } from "../core/masks";
import { strokeBounds, type BrushStrokeData } from "../core/drawing";
import type { DodgeBurnOptions } from "../core/retouch/types";
import { createCanvas, release } from "./canvas";
import type { RenderSpace } from "./canvas";
import { drawMaskStroke, overlaps } from "./drawing";
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
  space = { ...space };
  if (source.length !== space.width * space.height * 4)
    throw new Error("Invalid retouch render tile geometry.");
  const captured = source.slice();
  const options = { ...adjustment, flow: 1 };
  const coverage = await renderRetouchCoverage(brush, space, processor, world);
  let left = space.width, top = space.height, right = -1, bottom = -1;
  for (let p = 0; p < coverage.length; p++) {
    if (!coverage[p]) continue;
    const x = p % space.width, y = Math.floor(p / space.width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const width = right - left + 1, height = bottom - top + 1;
  // Tonal correction is pointwise. Keep coverage rasterization on its fixed
  // grid, but transfer only covered bounds to the numerical worker.
  if (width > 0 && height > 0 && width * height < coverage.length) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const start = (top + y) * space.width + left;
      pixels.set(captured.subarray(start * 4, (start + width) * 4), y * width * 4);
      mask.set(coverage.subarray(start, start + width), y * width);
    }
    const corrected = await processor.dodgeBurn(pixels, width, height, options, mask);
    for (let y = 0; y < height; y++)
      captured.set(corrected.subarray(y * width * 4, (y + 1) * width * 4),
        ((top + y) * space.width + left) * 4);
    return captured;
  }
  // Keep validation/error semantics even when no coverage intersects the tile.
  return processor.dodgeBurn(captured, space.width, space.height, options, coverage);
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
  const bounds = world.bounds(strokeBounds(entry.stroke));
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
        // drawMaskStroke applies the same rejection. Do it before allocating
        // and reading back an empty cell, retaining the fixed raster grid.
        if (!overlaps(bounds, padded, 0, 0)) continue;
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
