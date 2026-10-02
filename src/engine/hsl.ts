import type { HslAdjustmentData } from "../core/adjustments";

/** HSL in encoded sRGB, straight RGB bytes. Alpha is copied unchanged. */
export function adjustHsl(
  input: Uint8ClampedArray,
  adjustment: HslAdjustmentData,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(input);
  if (!adjustment.hue && !adjustment.saturation && !adjustment.lightness)
    return output;
  const saturation = adjustment.saturation / 100,
    lightness = adjustment.lightness / 100;
  const shift = (value: number, amount: number) =>
    amount < 0 ? value * (1 + amount) : value + (1 - value) * amount;
  for (let i = 0; i < input.length; i += 4) {
    const r = input[i] / 255,
      g = input[i + 1] / 255,
      b = input[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    let l = (max + min) / 2,
      h = 0,
      s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    if (delta !== 0) {
      h =
        max === r
          ? ((g - b) / delta) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
      h = (((h / 6 + adjustment.hue / 360) % 1) + 1) % 1;
      s = shift(s, saturation);
    }
    // Neutral pixels stay neutral instead of acquiring an arbitrary hue.
    l = shift(l, lightness);
    const c = (1 - Math.abs(2 * l - 1)) * s,
      x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
      m = l - c / 2;
    const sector = Math.floor(h * 6);
    const rgb =
      sector === 0
        ? [c, x, 0]
        : sector === 1
          ? [x, c, 0]
          : sector === 2
            ? [0, c, x]
            : sector === 3
              ? [0, x, c]
              : sector === 4
                ? [x, 0, c]
                : [c, 0, x];
    for (let channel = 0; channel < 3; channel++)
      output[i + channel] = Math.round((rgb[channel] + m) * 255);
  }
  return output;
}
