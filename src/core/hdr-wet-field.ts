/** Private linear replacement field: premultiplied RGB, alpha, removal coverage.
 * Float64 intermediates avoid rounding an already completed Float32 pixel again
 * merely to store its premultiplied form. This is not a public edit DTO. */
export function validateHdrWetField(
  value: unknown,
  pixels: number,
): asserts value is Float64Array<ArrayBuffer> {
  if (
    !(value instanceof Float64Array) ||
    !(value.buffer instanceof ArrayBuffer) ||
    ("resizable" in value.buffer && value.buffer.resizable) ||
    ("detached" in value.buffer && value.buffer.detached) ||
    !Number.isSafeInteger(pixels) ||
    pixels < 1 ||
    value.length !== pixels * 5
  )
    throw new Error("Invalid HDR wet field geometry or ownership.");
  for (let i = 0; i < value.length; i += 5) {
    const alpha = value[i + 3],
      coverage = value[i + 4];
    if (
      !Number.isFinite(alpha) ||
      !Number.isFinite(coverage) ||
      alpha < 0 ||
      coverage > 1 ||
      alpha > coverage
    )
      throw new Error(
        "HDR wet field alpha must be normalized and bounded by coverage.",
      );
    for (let c = 0; c < 3; c++)
      if (!Number.isFinite(value[i + c]) || (alpha === 0 && value[i + c] !== 0))
        throw new Error(
          "HDR wet field pigment must be finite and zero at zero alpha.",
        );
  }
}
