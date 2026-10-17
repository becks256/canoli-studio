import { lutAdjustmentSchema, lutValues, type LutAdjustmentData } from "../core/lut";

/** JS conformance oracle; production pixel loops run in WASM/WGSL. */
export function adjustLookup(pixels: Uint8ClampedArray, adjustment: LutAdjustmentData): Uint8ClampedArray {
  if (pixels.length % 4) throw new Error("LUT processing requires complete RGBA pixels.");
  const settings = lutAdjustmentSchema.parse(adjustment), { lut } = settings, output = pixels.slice();
  if (settings.amount === 0) return output;
  const table = lutValues(lut), n = lut.size, stride = [3, 3 * n, 3 * n * n], amount = settings.amount / 100;
  for (let i = 0; i < pixels.length; i += 4) {
    const position = [0, 1, 2].map(c => Math.max(0, Math.min(1,
      (pixels[i + c] / 255 - lut.domainMin[c]) / (lut.domainMax[c] - lut.domainMin[c]))) * (n - 1));
    const lo = position.map(value => Math.min(n - 2, Math.floor(value))), f = position.map((value, c) => value - lo[c]);
    const base = lo.reduce((sum, value, c) => sum + value * stride[c], 0);
    for (let c = 0; c < 3; c++) {
      let value: number;
      if (lut.dimension === 1) {
        const low = lo[c] * 3 + c; value = table[low] + (table[low + 3] - table[low]) * f[c];
      } else if (settings.interpolation === "tetrahedral") {
        const order = [0, 1, 2].sort((a, b) => f[b] - f[a]);
        const a = base + c, b = a + stride[order[0]], d = b + stride[order[1]], e = base + c + stride.reduce((x, y) => x + y, 0);
        value = table[a] + f[order[0]] * (table[b] - table[a]) + f[order[1]] * (table[d] - table[b]) + f[order[2]] * (table[e] - table[d]);
      } else {
        value = 0;
        for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++)
          value += table[base + c + r * stride[0] + g * stride[1] + b * stride[2]] *
            (r ? f[0] : 1 - f[0]) * (g ? f[1] : 1 - f[1]) * (b ? f[2] : 1 - f[2]);
      }
      output[i + c] = Math.round(pixels[i + c] + (Math.max(0, Math.min(1, value)) * 255 - pixels[i + c]) * amount);
    }
  }
  return output;
}
