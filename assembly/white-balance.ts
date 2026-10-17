function encoded(value: f64): u8 {
  const v = Math.max(0.0, Math.min(1.0, value));
  const result = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1.0 / 2.4) - 0.055;
  return <u8>Math.round(result * 255.0);
}
/** Nine row-major coefficients followed by a 256-entry linear sRGB decode table. */
export function adjustWhiteBalance(ptr: usize, length: i32, values: usize, neutral: bool): void {
  if (neutral) return;
  const decode = values + 72;
  for (let i = 0; i < length; i += 4) {
    const pixel = ptr + <usize>i;
    const r = load<f64>(decode + <usize>load<u8>(pixel) * 8);
    const g = load<f64>(decode + <usize>load<u8>(pixel + 1) * 8);
    const b = load<f64>(decode + <usize>load<u8>(pixel + 2) * 8);
    for (let c = 0; c < 3; c++) {
      const row = values + <usize>(c * 24);
      store<u8>(pixel + <usize>c, encoded(load<f64>(row) * r + load<f64>(row + 8) * g + load<f64>(row + 16) * b));
    }
  }
}
