function shift(value: f64, amount: f64): f64 {
  return amount < 0 ? value * (1 + amount) : value + (1 - value) * amount;
}
function channel(value: f64): u8 {
  return <u8>Math.round(Math.min(255.0, Math.max(0.0, value * 255.0)));
}
/** Encoded-sRGB HSL, in-place straight RGBA; alpha is never written. */
export function adjustHsl(
  ptr: usize,
  length: i32,
  hue: f64,
  saturation: f64,
  lightness: f64,
): void {
  if (hue == 0 && saturation == 0 && lightness == 0) return;
  saturation /= 100;
  lightness /= 100;
  for (let i = 0; i < length; i += 4) {
    const p = ptr + <usize>i;
    const r = <f64>load<u8>(p) / 255,
      g = <f64>load<u8>(p + 1) / 255,
      b = <f64>load<u8>(p + 2) / 255;
    const maximum = Math.max(r, Math.max(g, b)),
      minimum = Math.min(r, Math.min(g, b)),
      delta = maximum - minimum;
    let l = (maximum + minimum) / 2,
      h: f64 = 0;
    let s: f64 = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    if (delta != 0) {
      h =
        maximum == r
          ? ((g - b) / delta) % 6
          : maximum == g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
      h = (((h / 6 + hue / 360) % 1) + 1) % 1;
      s = shift(s, saturation);
    }
    l = shift(l, lightness);
    const c = (1 - Math.abs(2 * l - 1)) * s,
      x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
      m = l - c / 2;
    const sector = <i32>Math.floor(h * 6);
    let red: f64 = 0,
      green: f64 = 0,
      blue: f64 = 0;
    if (sector == 0) {
      red = c;
      green = x;
    } else if (sector == 1) {
      red = x;
      green = c;
    } else if (sector == 2) {
      green = c;
      blue = x;
    } else if (sector == 3) {
      green = x;
      blue = c;
    } else if (sector == 4) {
      red = x;
      blue = c;
    } else {
      red = c;
      blue = x;
    }
    store<u8>(p, channel(red + m));
    store<u8>(p + 1, channel(green + m));
    store<u8>(p + 2, channel(blue + m));
  }
}
