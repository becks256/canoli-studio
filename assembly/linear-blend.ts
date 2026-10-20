/** Straight RGBA8 source-over with encoded-sRGB Linear Light blend colors. */
export function compositeLinearBlend(source: usize, backdrop: usize, length: i32, opacity: f64, mode: i32): void {
  for (let i = 0; i < length; i += 4) {
    const s = source + <usize>i, b = backdrop + <usize>i;
    const sa = <f64>load<u8>(s + 3) / 255.0 * opacity;
    const ba = <f64>load<u8>(b + 3) / 255.0;
    const alpha = sa + ba * (1.0 - sa);
    for (let c: usize = 0; c < 3; c++) {
      const sc = <f64>load<u8>(s + c) / 255.0, bc = <f64>load<u8>(b + c) / 255.0;
      const blend = Math.max(0.0, Math.min(1.0, bc + (mode == 1 ? sc : 2.0 * sc) - 1.0));
      const value = alpha > 0 ? ((1.0 - sa) * ba * bc + (1.0 - ba) * sa * sc + sa * ba * blend) / alpha : 0.0;
      store<u8>(s + c, <u8>Math.round(Math.max(0.0, Math.min(255.0, value * 255.0))));
    }
    store<u8>(s + 3, <u8>Math.round(alpha * 255.0));
  }
}
