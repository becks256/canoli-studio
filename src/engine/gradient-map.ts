import { gradientMapAdjustmentSchema, packGradientStops, type GradientMapAdjustmentData } from "../core/gradient-map";

/** Independent test reference. Production pixels use the WASM worker or WGSL. */
export function adjustGradientMap(pixels: Uint8ClampedArray, adjustment: GradientMapAdjustmentData): Uint8ClampedArray {
  if (pixels.length % 4) throw new Error("Gradient maps require complete RGBA pixels.");
  const settings = gradientMapAdjustmentSchema.parse(adjustment);
  const stops = packGradientStops(settings.stops), output = pixels.slice();
  for (let i = 0; i < pixels.length; i += 4) {
    let value = (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) / 255;
    if (settings.reverse) value = 1 - value;
    let upper = 1;
    while (upper < settings.stops.length - 1 && value > stops[upper * 4]) upper++;
    const lower = (upper - 1) * 4, high = upper * 4;
    const t = Math.max(0, Math.min(1, (value - stops[lower]) / (stops[high] - stops[lower])));
    for (let c = 1; c <= 3; c++) output[i + c - 1] = Math.round(
      (stops[lower + c] + (stops[high + c] - stops[lower + c]) * t) * 255,
    );
  }
  return output;
}
