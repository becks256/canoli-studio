import { whiteBalanceAdjustmentSchema, whiteBalanceMatrix, WHITE_BALANCE_NEUTRAL, type WhiteBalanceAdjustmentData } from "../core/white-balance";
import { srgbToLinear, linearToSrgb, multiplyMatrix3x3Vector3 } from "../core/color/spaces";

/** JS conformance reference only; production pixel loops execute in WASM/WGSL. */
export function adjustWhiteBalance(pixels: Uint8ClampedArray, adjustment: WhiteBalanceAdjustmentData): Uint8ClampedArray {
  if (pixels.length % 4) throw new Error("White balance requires complete RGBA pixels.");
  const settings = whiteBalanceAdjustmentSchema.parse(adjustment), output = pixels.slice();
  if (settings.temperature === WHITE_BALANCE_NEUTRAL && settings.tint === 0) return output;
  const matrix = whiteBalanceMatrix(settings);
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = multiplyMatrix3x3Vector3(matrix, [srgbToLinear(pixels[i] / 255), srgbToLinear(pixels[i + 1] / 255), srgbToLinear(pixels[i + 2] / 255)]);
    for (let c = 0; c < 3; c++) output[i + c] = Math.round(linearToSrgb(Math.max(0, Math.min(1, rgb[c]))) * 255);
  }
  return output;
}
