// Separable finite Gaussian in premultiplied encoded RGB. Caller supplies normalized weights.
function byte(value: f64): u8 {
  return <u8>Math.round(Math.max(0, Math.min(255, value)));
}
export function spatialFilter(
  ptr: usize,
  scratch: usize,
  weightsX: usize,
  weightsY: usize,
  width: i32,
  height: i32,
  radiusX: i32,
  radiusY: i32,
  unsharp: bool,
  amount: f64,
  threshold: f64,
  band: i32,
): void {
  for (let y: i32 = 0; y < height; y++)
    for (let x: i32 = 0; x < width; x++) {
      let red: f64 = 0,
        green: f64 = 0,
        blue: f64 = 0,
        alpha: f64 = 0;
      for (let dx: i32 = -radiusX; dx <= radiusX; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        const source = ptr + <usize>((y * width + sx) * 4);
        const weight = load<f64>(weightsX + <usize>((dx + radiusX) * 8));
        const coverage = (<f64>load<u8>(source + 3) / 255) * weight;
        red += <f64>load<u8>(source) * coverage;
        green += <f64>load<u8>(source + 1) * coverage;
        blue += <f64>load<u8>(source + 2) * coverage;
        alpha += coverage;
      }
      const output = scratch + <usize>((y * width + x) * 32);
      store<f64>(output, red);
      store<f64>(output + 8, green);
      store<f64>(output + 16, blue);
      store<f64>(output + 24, alpha);
    }
  for (let y: i32 = 0; y < height; y++)
    for (let x: i32 = 0; x < width; x++) {
      let red: f64 = 0,
        green: f64 = 0,
        blue: f64 = 0,
        alpha: f64 = 0;
      for (let dy: i32 = -radiusY; dy <= radiusY; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= height) continue;
        const source = scratch + <usize>((sy * width + x) * 32);
        const weight = load<f64>(weightsY + <usize>((dy + radiusY) * 8));
        red += load<f64>(source) * weight;
        green += load<f64>(source + 8) * weight;
        blue += load<f64>(source + 16) * weight;
        alpha += load<f64>(source + 24) * weight;
      }
      const output = ptr + <usize>((y * width + x) * 4);
      if (band > 0) {
        // The coverage mask belongs to the enclosing group, not these opaque color planes.
        for (let channel: i32 = 0; channel < 3; channel++) {
          const address = output + <usize>channel;
          const low = alpha > 0 ? <f64>byte((channel === 0 ? red : channel === 1 ? green : blue) / alpha) : 0.0;
          const original = <f64>load<u8>(address);
          store<u8>(address, band === 1 ? <u8>low : band === 2 ? byte(127.5 + (original - low) / 2.0) : <u8>(255 - (original < 255.0 && ((<i32>original - <i32>low) & 1) == 0 ? 1 : 0)));
        }
        store<u8>(output + 3, 255);
      } else if (unsharp) {
        if (load<u8>(output + 3) === 0 || alpha <= 0) continue;
        for (let channel: i32 = 0; channel < 3; channel++) {
          const address = output + <usize>channel;
          const original = <f64>load<u8>(address);
          const blurred =
            (channel === 0 ? red : channel === 1 ? green : blue) / alpha;
          const delta = original - blurred;
          if (Math.abs(delta) >= threshold)
            store<u8>(address, byte(original + amount * delta));
        }
      } else {
        const coverage = byte(alpha * 255);
        store<u8>(output, coverage > 0 ? byte(red / alpha) : 0);
        store<u8>(output + 1, coverage > 0 ? byte(green / alpha) : 0);
        store<u8>(output + 2, coverage > 0 ? byte(blue / alpha) : 0);
        store<u8>(output + 3, coverage);
      }
    }
}
