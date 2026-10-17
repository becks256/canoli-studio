/** Piecewise linear mapping of encoded RGB brightness; straight alpha is untouched. */
export function adjustGradientMap(ptr: usize, length: i32, stops: usize, count: i32, reverse: bool): void {
  for (let i = 0; i < length; i += 4) {
    const pixel = ptr + <usize>i;
    let value = (0.2126 * <f64>load<u8>(pixel) + 0.7152 * <f64>load<u8>(pixel + 1) + 0.0722 * <f64>load<u8>(pixel + 2)) / 255.0;
    if (reverse) value = 1.0 - value;
    let upper = 1;
    while (upper < count - 1 && value > load<f64>(stops + <usize>(upper * 32))) upper++;
    const low = stops + <usize>((upper - 1) * 32), high = stops + <usize>(upper * 32);
    const t = Math.max(0.0, Math.min(1.0, (value - load<f64>(low)) / (load<f64>(high) - load<f64>(low))));
    for (let c = 1; c <= 3; c++) {
      const start = load<f64>(low + <usize>(c * 8)), end = load<f64>(high + <usize>(c * 8));
      store<u8>(pixel + <usize>(c - 1), <u8>Math.round((start + (end - start) * t) * 255.0));
    }
  }
}
