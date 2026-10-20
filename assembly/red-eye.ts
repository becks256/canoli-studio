/** Selection/mask compositing happens outside this pointwise straight-RGBA8 kernel. */
export function adjustRedEye(ptr: usize, length: i32, threshold: f64, strength: f64): void {
  if (strength == 0) return;
  for (let i = 0; i < length; i += 4) {
    const pixel = ptr + <usize>i;
    if (load<u8>(pixel + 3) == 0) continue;
    const red = <f64>load<u8>(pixel), green = <f64>load<u8>(pixel + 1), blue = <f64>load<u8>(pixel + 2);
    const excess = red - Math.max(green, blue);
    if (excess > 0 && excess >= threshold)
      store<u8>(pixel, <u8>Math.round(red + ((green + blue) / 2.0 - red) * strength / 100.0));
  }
}
