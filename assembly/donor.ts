// Host-validated packed support scan. Output order is dy-major, then dx.
export function donorValidity(
  blocked: usize,
  support: usize,
  count: i32,
  stride: i32,
  minX: i32,
  maxX: i32,
  minY: i32,
  maxY: i32,
  output: usize,
): void {
  let index: usize = 0;
  for (let dy = minY; dy <= maxY; dy++)
    for (let dx = minX; dx <= maxX; dx++) {
      let valid: u8 = 1;
      for (let i = 0; i < count; i++) {
        const entry = support + <usize>i * 12;
        const row = (load<i32>(entry) + dy) * stride;
        const start = load<i32>(entry + 4) + dx;
        const word = start >> 5,
          bit = start & 31;
        const low =
          word >= 0 && word < stride
            ? load<u32>(blocked + ((<usize>(row + word)) << 2))
            : 0;
        const high =
          word + 1 >= 0 && word + 1 < stride
            ? load<u32>(blocked + ((<usize>(row + word + 1)) << 2))
            : 0;
        const invalid = bit ? (low >> bit) | (high << (32 - bit)) : low;
        if (load<u32>(entry + 8) & invalid) {
          valid = 0;
          break;
        }
      }
      store<u8>(output + index, valid);
      index++;
    }
}
