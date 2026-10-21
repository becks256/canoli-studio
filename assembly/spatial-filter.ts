// Separable finite Gaussian in premultiplied encoded RGB. Caller supplies normalized weights.
function byte(value: f64): u8 {
  return <u8>Math.round(Math.max(0, Math.min(255, value)));
}
@inline
function writeSpatialPixel(output: usize, red: f64, green: f64, blue: f64, alpha: f64, unsharp: bool, amount: f64, threshold: f64, band: i32): void {
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
    if (load<u8>(output + 3) === 0 || alpha <= 0) return;
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
  // Transparent samples contribute positive zero to every accumulator. Trim
  // only empty row margins, preserving the order of all retained operations.
  let top = height, bottom: i32 = -1;
  for (let y: i32 = 0; y < height; y++) {
    let left: i32 = 0, right = width - 1;
    while (left < width && load<u8>(ptr + <usize>((y * width + left) * 4 + 3)) === 0) left++;
    while (right >= left && load<u8>(ptr + <usize>((y * width + right) * 4 + 3)) === 0) right--;
    if (left <= right) { if (y < top) top = y; bottom = y; }
    for (let x: i32 = 0; x < width; x += 2) {
      let red: f64 = 0, green: f64 = 0, blue: f64 = 0, alpha: f64 = 0;
      const first = left > x - radiusX ? left : x - radiusX;
      const last = right < x + radiusX ? right : x + radiusX;
      const output = scratch + <usize>((y * width + x) * 32);
      if (x + 1 < width) {
        let redNext: f64 = 0, greenNext: f64 = 0, blueNext: f64 = 0, alphaNext: f64 = 0;
        const firstNext = left > x + 1 - radiusX ? left : x + 1 - radiusX;
        const lastNext = right < x + 1 + radiusX ? right : x + 1 + radiusX;
        // Neighboring support intervals differ by at most one sample per edge.
        if (first < firstNext && first <= last) {
          const source = ptr + <usize>((y * width + first) * 4);
          const weight = load<f64>(weightsX + <usize>((first - x + radiusX) * 8));
          const coverage = (<f64>load<u8>(source + 3) / 255) * weight;
          red += <f64>load<u8>(source) * coverage;
          green += <f64>load<u8>(source + 1) * coverage;
          blue += <f64>load<u8>(source + 2) * coverage;
          alpha += coverage;
        }
        for (let sx: i32 = firstNext; sx <= last; sx++) {
          const source = ptr + <usize>((y * width + sx) * 4);
          const coverage = <f64>load<u8>(source + 3) / 255;
          const weighted = coverage * load<f64>(weightsX + <usize>((sx - x + radiusX) * 8));
          const weightedNext = coverage * load<f64>(weightsX + <usize>((sx - x - 1 + radiusX) * 8));
          const r = <f64>load<u8>(source); red += r * weighted; redNext += r * weightedNext;
          const g = <f64>load<u8>(source + 1); green += g * weighted; greenNext += g * weightedNext;
          const b = <f64>load<u8>(source + 2); blue += b * weighted; blueNext += b * weightedNext;
          alpha += weighted; alphaNext += weightedNext;
        }
        if (last < lastNext && firstNext <= lastNext) {
          const source = ptr + <usize>((y * width + lastNext) * 4);
          const weight = load<f64>(weightsX + <usize>((lastNext - x - 1 + radiusX) * 8));
          const coverage = (<f64>load<u8>(source + 3) / 255) * weight;
          redNext += <f64>load<u8>(source) * coverage;
          greenNext += <f64>load<u8>(source + 1) * coverage;
          blueNext += <f64>load<u8>(source + 2) * coverage;
          alphaNext += coverage;
        }
        store<f64>(output + 32, redNext); store<f64>(output + 40, greenNext);
        store<f64>(output + 48, blueNext); store<f64>(output + 56, alphaNext);
      } else {
        for (let sx: i32 = first; sx <= last; sx++) {
          const source = ptr + <usize>((y * width + sx) * 4);
          const weight = load<f64>(weightsX + <usize>((sx - x + radiusX) * 8));
          const coverage = (<f64>load<u8>(source + 3) / 255) * weight;
          red += <f64>load<u8>(source) * coverage;
          green += <f64>load<u8>(source + 1) * coverage;
          blue += <f64>load<u8>(source + 2) * coverage;
          alpha += coverage;
        }
      }
      store<f64>(output, red); store<f64>(output + 8, green);
      store<f64>(output + 16, blue); store<f64>(output + 24, alpha);
    }
  }
  // Horizontal filtering cannot introduce coverage in an empty source row.
  // Keep the existing output order and skip only those identically zero rows.
  for (let y: i32 = 0; y < height; y++)
    for (let x: i32 = 0; x < width; x += 2) {
      let red: f64 = 0, green: f64 = 0, blue: f64 = 0, alpha: f64 = 0;
      const first = -radiusY > top - y ? -radiusY : top - y;
      const last = radiusY < bottom - y ? radiusY : bottom - y;
      const output = ptr + <usize>((y * width + x) * 4);
      if (x + 1 < width) {
        let redNext: f64 = 0, greenNext: f64 = 0, blueNext: f64 = 0, alphaNext: f64 = 0;
        for (let dy: i32 = first; dy <= last; dy++) {
          const source = scratch + <usize>(((y + dy) * width + x) * 32);
          const weight = load<f64>(weightsY + <usize>((dy + radiusY) * 8));
          red += load<f64>(source) * weight;
          green += load<f64>(source + 8) * weight;
          blue += load<f64>(source + 16) * weight;
          alpha += load<f64>(source + 24) * weight;
          redNext += load<f64>(source + 32) * weight;
          greenNext += load<f64>(source + 40) * weight;
          blueNext += load<f64>(source + 48) * weight;
          alphaNext += load<f64>(source + 56) * weight;
        }
        writeSpatialPixel(output, red, green, blue, alpha, unsharp, amount, threshold, band);
        writeSpatialPixel(output + 4, redNext, greenNext, blueNext, alphaNext, unsharp, amount, threshold, band);
      } else {
        for (let dy: i32 = first; dy <= last; dy++) {
          const source = scratch + <usize>(((y + dy) * width + x) * 32);
          const weight = load<f64>(weightsY + <usize>((dy + radiusY) * 8));
          red += load<f64>(source) * weight;
          green += load<f64>(source + 8) * weight;
          blue += load<f64>(source + 16) * weight;
          alpha += load<f64>(source + 24) * weight;
        }
        writeSpatialPixel(output, red, green, blue, alpha, unsharp, amount, threshold, band);
      }
    }
}
