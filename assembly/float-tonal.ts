/** Pointwise working-linear dodge/burn. RGB never enters an integer buffer.
 * Range selectors clamp Rec.709 luminance, not authored colors. Protection
 * prevents a newly over-white positive peak without darkening existing HDR. */
export function tonalFloat(source: usize, output: usize, coverage: usize, pixels: i32, exposure: f64, flow: f64, mode: i32, range: i32, protect: bool): i32 {
  if (pixels < 0 || !isFinite(exposure) || exposure < 0 || exposure > 1 || !isFinite(flow) || flow < 0 || flow > 1 || mode < 0 || mode > 1 || range < 0 || range > 2) return 1;
  for (let i = 0; i < pixels; i++) {
    const p = source + <usize>i * 16, amount = load<f32>(coverage + <usize>i * 4);
    if (!isFinite(amount) || amount < 0 || amount > 1) return 1;
    for (let c: usize = 0; c < 4; c++) {
      const v = load<f32>(p + c * 4); if (!isFinite(v) || c == 3 && (v < 0 || v > 1)) return 1;
    }
  }
  const strength = (mode == 0 ? 2.0 : -2.0) * exposure * flow;
  for (let i = 0; i < pixels; i++) {
    const p = source + <usize>i * 16, q = output + <usize>i * 16, amount = <f64>load<f32>(coverage + <usize>i * 4);
    const r = <f64>load<f32>(p), g = <f64>load<f32>(p + 4), b = <f64>load<f32>(p + 8);
    const l = Math.max(0.0, Math.min(1.0, .2126 * r + .7152 * g + .0722 * b));
    const weight = range == 0 ? 1.0 - l : range == 1 ? 4.0 * l * (1.0 - l) : l;
    let gain = Math.pow(2.0, strength * amount * weight);
    const peak = Math.max(r, Math.max(g, b));
    if (protect && peak > 0 && gain > 1) gain = Math.min(gain, Math.max(1.0, 1.0 / peak));
    // Preserve every word, including signed zero/hidden RGB, for identities.
    if (strength == 0 || amount == 0 || load<f32>(p + 12) == 0 || gain == 1) {
      for (let c: usize = 0; c < 4; c++) store<f32>(q + c * 4, load<f32>(p + c * 4));
      continue;
    }
    const red = <f32>(r * gain), green = <f32>(g * gain), blue = <f32>(b * gain);
    if (!isFinite(red) || !isFinite(green) || !isFinite(blue)) return 3;
    store<f32>(q, red); store<f32>(q + 4, green); store<f32>(q + 8, blue); store<f32>(q + 12, load<f32>(p + 12));
  }
  return 0;
}
