// Alpha-weighted, per-channel lower median in a square native-pixel aperture.
// Input remains immutable; output preserves every original alpha and hidden RGB.
// Three sliding histograms and their cumulative ranks avoid sorting each aperture.
function column(input: usize, histograms: usize, ranks: usize, width: i32,
  x: i32, top: i32, bottom: i32, sign: i32): i32 {
  let coverage: i32 = 0;
  for (let y = top; y <= bottom; y++) {
    const pixel = input + <usize>((y * width + x) * 4);
    const weight = <i32>load<u8>(pixel + 3) * sign;
    if (weight === 0) continue;
    coverage += weight;
    for (let channel: i32 = 0; channel < 3; channel++) {
      const value = <i32>load<u8>(pixel + <usize>channel);
      const bin = histograms + <usize>((channel * 256 + value) * 4);
      store<i32>(bin, load<i32>(bin) + weight);
      const rank = ranks + <usize>(channel * 8);
      if (value <= load<i32>(rank)) store<i32>(rank + 4, load<i32>(rank + 4) + weight);
    }
  }
  return coverage;
}

export function medianFilter(input: usize, output: usize, scratch: usize,
  width: i32, height: i32, radius: i32): void {
  const ranks = scratch + 3 * 256 * 4;
  memory.copy(output, input, <usize>(width * height * 4));
  for (let y: i32 = 0; y < height; y++) {
    memory.fill(scratch, 0, 3 * 256 * 4 + 3 * 8);
    const top = max<i32>(0, y - radius), bottom = min<i32>(height - 1, y + radius);
    let total: i32 = 0;
    for (let x: i32 = 0; x <= min<i32>(radius, width - 1); x++)
      total += column(input, scratch, ranks, width, x, top, bottom, 1);
    for (let x: i32 = 0; x < width; x++) {
      if (x > 0) {
        if (x - radius - 1 >= 0)
          total += column(input, scratch, ranks, width, x - radius - 1, top, bottom, -1);
        if (x + radius < width)
          total += column(input, scratch, ranks, width, x + radius, top, bottom, 1);
      }
      const pixel = <usize>((y * width + x) * 4);
      if (load<u8>(input + pixel + 3) === 0) continue;
      const target = (total + 1) / 2;
      for (let channel: i32 = 0; channel < 3; channel++) {
        const rank = ranks + <usize>(channel * 8), histogram = scratch + <usize>(channel * 256 * 4);
        let median = load<i32>(rank), cumulative = load<i32>(rank + 4);
        while (cumulative < target && median < 255) {
          median++; cumulative += load<i32>(histogram + <usize>(median * 4));
        }
        while (median > 0 && cumulative - load<i32>(histogram + <usize>(median * 4)) >= target) {
          cumulative -= load<i32>(histogram + <usize>(median * 4)); median--;
        }
        store<i32>(rank, median); store<i32>(rank + 4, cumulative);
        store<u8>(output + pixel + <usize>channel, <u8>median);
      }
    }
  }
}
