function sample(table: usize, index: i32): f64 { return <f64>load<f32>(table + <usize>index * 4); }
function position(value: u8, min: f64, span: f64, size: i32): f64 {
  return Math.max(0, Math.min(1, (<f64>value / 255 - min) / span)) * <f64>(size - 1);
}
/** Header: min RGB, span RGB, amount as f64; red-fastest RGB table is float32. */
export function adjustLookup(ptr: usize, length: i32, table: usize, params: usize, size: i32, dimension: i32, tetrahedral: bool): void {
  const amount = load<f64>(params + 48) / 100;
  if (amount == 0) return;
  const sr = 3, sg = size * 3, sb = size * size * 3;
  for (let i = 0; i < length; i += 4) {
    const pixel = ptr + <usize>i;
    const r = load<u8>(pixel), g = load<u8>(pixel + 1), b = load<u8>(pixel + 2);
    const pr = position(r, load<f64>(params), load<f64>(params + 24), size);
    const pg = position(g, load<f64>(params + 8), load<f64>(params + 32), size);
    const pb = position(b, load<f64>(params + 16), load<f64>(params + 40), size);
    const lr = <i32>Math.min(size - 2, Math.floor(pr)), lg = <i32>Math.min(size - 2, Math.floor(pg)), lb = <i32>Math.min(size - 2, Math.floor(pb));
    const fr = pr - lr, fg = pg - lg, fb = pb - lb, base = lr * sr + lg * sg + lb * sb;
    let sa = sr, sd = sg; let fa = fr, fd = fg, fe = fb;
    if (fr >= fg) {
      if (fg >= fb) {} else if (fr >= fb) { sd = sb; fd = fb; fe = fg; }
      else { sa = sb; sd = sr; fa = fb; fd = fr; fe = fg; }
    } else {
      if (fb >= fg) { sa = sb; sd = sg; fa = fb; fd = fg; fe = fr; }
      else if (fb >= fr) { sa = sg; sd = sb; fa = fg; fd = fb; fe = fr; }
      else { sa = sg; sd = sr; fa = fg; fd = fr; fe = fb; }
    }
    for (let c = 0; c < 3; c++) {
      let value: f64 = 0;
      if (dimension == 1) {
        const low = (c == 0 ? lr : c == 1 ? lg : lb) * 3 + c;
        const f = c == 0 ? fr : c == 1 ? fg : fb;
        value = sample(table, low) + (sample(table, low + 3) - sample(table, low)) * f;
      } else if (tetrahedral) {
        const a = sample(table, base + c), d = sample(table, base + c + sa), e = sample(table, base + c + sa + sd), z = sample(table, base + c + sr + sg + sb);
        value = a + fa * (d - a) + fd * (e - d) + fe * (z - e);
      } else {
        for (let bz = 0; bz < 2; bz++) for (let gy = 0; gy < 2; gy++) for (let rx = 0; rx < 2; rx++)
          value += sample(table, base + c + rx * sr + gy * sg + bz * sb) *
            (rx == 1 ? fr : 1 - fr) * (gy == 1 ? fg : 1 - fg) * (bz == 1 ? fb : 1 - fb);
      }
      const original = <f64>load<u8>(pixel + <usize>c);
      store<u8>(pixel + <usize>c, <u8>Math.round(original + (Math.max(0, Math.min(1, value)) * 255 - original) * amount));
    }
  }
}
