import type { BlendMode } from "../core/model";
import type { BlendIfData } from "../core/drawing";
import type { PixelProcessor } from "./processor";
import { createCanvas, release } from "./canvas";

/** Blend adjusted straight colors, then interpolate once while retaining backdrop alpha. */
export async function blendAdjustedTile(
  processor: PixelProcessor,
  target: ImageData,
  adjusted: ImageData,
  mask: Uint8ClampedArray | null,
  opacity: number,
  mode: BlendMode,
  blendIf: BlendIfData,
) {
  const opaque = new Uint8ClampedArray(adjusted.data);
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  let coverage = mask;
  if (blendIf.enabled) {
    const gated = await processor.blendIf(
      new Uint8ClampedArray(opaque),
      new Uint8ClampedArray(target.data),
      blendIf,
    );
    coverage = new Uint8ClampedArray(gated);
    if (mask)
      for (let i = 3; i < coverage.length; i += 4)
        coverage[i] = Math.round((coverage[i] * mask[i]) / 255);
  }
  let colors = adjusted.data;
  if (mode !== "normal") {
    const canvas = createCanvas(target.width, target.height, true);
    const source = createCanvas(target.width, target.height, true);
    try {
      const backdrop = new Uint8ClampedArray(target.data);
      for (let i = 3; i < backdrop.length; i += 4) backdrop[i] = 255;
      const c = canvas.getContext("2d")!,
        s = source.getContext("2d")!;
      const b = c.createImageData(target.width, target.height);
      b.data.set(backdrop);
      c.putImageData(b, 0, 0);
      const a = s.createImageData(target.width, target.height);
      a.data.set(opaque);
      s.putImageData(a, 0, 0);
      c.globalCompositeOperation = mode;
      c.drawImage(source, 0, 0);
      colors = c.getImageData(0, 0, target.width, target.height).data;
    } finally {
      release(canvas);
      release(source);
    }
  }
  return processor.blendAdjustment(target.data, colors, coverage, opacity);
}
