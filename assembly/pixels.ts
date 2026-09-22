// A small, allocation-free ABI. The host owns the RGBA buffer and memory growth.
// This module can be replaced by Rust/C++ without changing the document model.
export function bufferOffset(): usize {
  return __heap_base;
}

function channel(value: f64): u8 {
  return <u8>Math.round(Math.min(255.0, Math.max(0.0, value)));
}

export function adjust(
  ptr: usize,
  length: i32,
  exposure: f64,
  contrast: f64,
  saturation: f64,
): void {
  const gain = Math.pow(2.0, exposure);
  const contrastGain = Math.pow(2.0, contrast / 100.0);
  const saturationGain = 1.0 + saturation / 100.0;
  for (let i: i32 = 0; i < length; i += 4) {
    const p = ptr + <usize>i;
    const r = (<f64>load<u8>(p) * gain - 127.5) * contrastGain + 127.5;
    const g = (<f64>load<u8>(p + 1) * gain - 127.5) * contrastGain + 127.5;
    const b = (<f64>load<u8>(p + 2) * gain - 127.5) * contrastGain + 127.5;
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    store<u8>(p, channel(luminance + (r - luminance) * saturationGain));
    store<u8>(p + 1, channel(luminance + (g - luminance) * saturationGain));
    store<u8>(p + 2, channel(luminance + (b - luminance) * saturationGain));
    // Alpha is deliberately preserved, including fully transparent pixels.
  }
}

function rangeWeight(
  value: f64,
  lowStart: f64,
  lowEnd: f64,
  highStart: f64,
  highEnd: f64,
): f64 {
  if (value < lowStart || value > highEnd) return 0;
  const low =
    lowEnd > lowStart
      ? Math.min(1.0, Math.max(0.0, (value - lowStart) / (lowEnd - lowStart)))
      : 1.0;
  const high =
    highEnd > highStart
      ? Math.min(1.0, Math.max(0.0, (highEnd - value) / (highEnd - highStart)))
      : 1.0;
  return Math.min(low, high);
}
function sampleChannel(ptr: usize, component: i32): f64 {
  if (component >= 0) return <f64>load<u8>(ptr + <usize>component);
  return (
    <f64>load<u8>(ptr) * 0.2126 +
    <f64>load<u8>(ptr + 1) * 0.7152 +
    <f64>load<u8>(ptr + 2) * 0.0722
  );
}
export function blendIf(
  ptr: usize,
  backdrop: usize,
  length: i32,
  component: i32,
  s0: f64,
  s1: f64,
  s2: f64,
  s3: f64,
  b0: f64,
  b1: f64,
  b2: f64,
  b3: f64,
): void {
  for (let i: i32 = 0; i < length; i += 4) {
    const p = ptr + <usize>i,
      b = backdrop + <usize>i;
    const sourceWeight = rangeWeight(
      sampleChannel(p, component),
      s0,
      s1,
      s2,
      s3,
    );
    const underlyingWeight = rangeWeight(
      sampleChannel(b, component),
      b0,
      b1,
      b2,
      b3,
    );
    const coverage = <f64>load<u8>(b + 3) / 255.0;
    // Transparent backdrop contributes no tonal occlusion.
    store<u8>(
      p + 3,
      channel(
        <f64>load<u8>(p + 3) *
          sourceWeight *
          (1.0 - coverage + coverage * underlyingWeight),
      ),
    );
  }
}

// Evaluate Boolean selection coverage on a fixed subpixel grid in document
// coordinates. Browser ellipse tessellation can change when a path is clipped
// to a different export tile; this kernel makes coverage tile-independent.
export function selectionMask(
  ptr: usize,
  regions: usize,
  count: i32,
  width: i32,
  height: i32,
  x: f64,
  y: f64,
  stepX: f64,
  stepY: f64,
): void {
  for (let py: i32 = 0; py < height; py++) {
    for (let px: i32 = 0; px < width; px++) {
      let covered: i32 = 0;
      for (let sy: i32 = 0; sy < 4; sy++) {
        for (let sx: i32 = 0; sx < 4; sx++) {
          const sampleX = x + (<f64>px + (<f64>sx + 0.5) / 4.0) * stepX;
          const sampleY = y + (<f64>py + (<f64>sy + 0.5) / 4.0) * stepY;
          let inside = false;
          for (let n: i32 = 0; n < count; n++) {
            const r = regions + <usize>(n * 48);
            const operation = <i32>load<f64>(r),
              shape = <i32>load<f64>(r + 8);
            const rx = load<f64>(r + 16),
              ry = load<f64>(r + 24),
              rw = load<f64>(r + 32),
              rh = load<f64>(r + 40);
            let hit =
              sampleX >= rx &&
              sampleX < rx + rw &&
              sampleY >= ry &&
              sampleY < ry + rh;
            if (hit && shape == 1) {
              const dx = (sampleX - rx - rw / 2) / (rw / 2),
                dy = (sampleY - ry - rh / 2) / (rh / 2);
              hit = dx * dx + dy * dy <= 1;
            }
            inside =
              operation == 0
                ? inside || hit
                : operation == 1
                  ? inside && !hit
                  : inside && hit;
          }
          if (inside) covered++;
        }
      }
      const p = ptr + <usize>((py * width + px) * 4);
      store<u8>(p, 255);
      store<u8>(p + 1, 255);
      store<u8>(p + 2, 255);
      store<u8>(p + 3, channel((<f64>covered * 255) / 16));
    }
  }
}
