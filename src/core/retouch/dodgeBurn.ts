import { linearToSrgb, srgbToLinear } from "../color/spaces";
import type { DodgeBurnOptions, DodgeBurnRange } from "./types";

const LINEAR = Float64Array.from({ length: 256 }, (_, value) =>
  srgbToLinear(value / 255),
);

/** Broad, continuous linear-light tonal masks; ranges intentionally overlap. */
export function tonalRangeWeight(
  luminance: number,
  range: DodgeBurnRange,
): number {
  if (!Number.isFinite(luminance) || luminance < 0 || luminance > 1)
    throw new Error("Luminance must be in [0, 1].");
  switch (range) {
    case "shadows":
      return 1 - luminance;
    case "midtones":
      return 4 * luminance * (1 - luminance);
    case "highlights":
      return luminance;
    default:
      throw new Error("Unknown dodge/burn tonal range.");
  }
}

/**
 * Pure sRGB straight-alpha kernel. Returns new pixels; sources and alpha are untouched.
 * Coverage includes brush shape/pressure, one byte per pixel, in the same tile basis.
 * RGB receives a common linear-light gain derived from a bounded luminance curve.
 */
export function applyDodgeBurn(
  source: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: DodgeBurnOptions,
  coverage?: Uint8Array | Uint8ClampedArray,
): Uint8ClampedArray {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height * 4) ||
    source.length !== width * height * 4
  ) {
    throw new Error(
      "Dodge/burn requires matching positive integer RGBA dimensions.",
    );
  }
  if (coverage && coverage.length !== width * height)
    throw new Error("Dodge/burn coverage dimensions do not match.");
  if (options.mode !== "dodge" && options.mode !== "burn")
    throw new Error("Unknown dodge/burn mode.");
  const flow = options.flow ?? 1;
  for (const value of [options.exposure, flow]) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error("Exposure and flow must be in [0, 1].");
  }
  tonalRangeWeight(0, options.range); // Validate even an empty-coverage operation.
  if (
    options.protectTones !== undefined &&
    typeof options.protectTones !== "boolean"
  )
    throw new Error("Protect tones must be boolean.");
  const output = new Uint8ClampedArray(source);
  const strength =
    (options.mode === "dodge" ? 2 : -2) * options.exposure * flow;
  if (!strength) return output;
  for (
    let pixel = 0, offset = 0;
    offset < source.length;
    pixel++, offset += 4
  ) {
    const amount = coverage ? coverage[pixel] / 255 : 1;
    if (!amount || !source[offset + 3]) continue;
    const r = LINEAR[source[offset]],
      g = LINEAR[source[offset + 1]],
      b = LINEAR[source[offset + 2]];
    const luminance = Math.min(1, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    const gain =
      2 ** (strength * amount * tonalRangeWeight(luminance, options.range));
    // L' = gain * L / (1 + (gain - 1) * L), fixing black and white.
    let scale = gain / (1 + (gain - 1) * luminance);
    const peak = Math.max(r, g, b);
    if (options.protectTones !== false && peak > 0)
      scale = Math.min(scale, 1 / peak);
    output[offset] = Math.round(255 * linearToSrgb(Math.min(1, r * scale)));
    output[offset + 1] = Math.round(255 * linearToSrgb(Math.min(1, g * scale)));
    output[offset + 2] = Math.round(255 * linearToSrgb(Math.min(1, b * scale)));
  }
  return output;
}
