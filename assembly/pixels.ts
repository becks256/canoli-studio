export { adjustHsl } from "./hsl";
export { spatialFilter } from "./spatial-filter";
export { donorValidity } from "./donor";
// A small, allocation-free ABI. The host owns the RGBA buffer and memory growth.
export { poissonSolve } from "./poisson";
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
  stepXY: f64,
  stepYX: f64,
): void {
  for (let py: i32 = 0; py < height; py++) {
    for (let px: i32 = 0; px < width; px++) {
      let covered: i32 = 0;
      for (let sy: i32 = 0; sy < 4; sy++) {
        for (let sx: i32 = 0; sx < 4; sx++) {
          const column = <f64>px + (<f64>sx + 0.5) / 4.0;
          const row = <f64>py + (<f64>sy + 0.5) / 4.0;
          const sampleX = x + column * stepX + row * stepXY;
          const sampleY = y + row * stepY + column * stepYX;
          let inside = false;
          for (let n: i32 = 0; n < count; n++) {
            const r = regions + <usize>(n * 96);
            const operation = <i32>load<f64>(r),
              shape = <i32>load<f64>(r + 8);
            const rx = load<f64>(r + 16),
              ry = load<f64>(r + 24),
              rw = load<f64>(r + 32),
              rh = load<f64>(r + 40);
            const localX =
              load<f64>(r + 48) * sampleX +
              load<f64>(r + 64) * sampleY +
              load<f64>(r + 80);
            const localY =
              load<f64>(r + 56) * sampleX +
              load<f64>(r + 72) * sampleY +
              load<f64>(r + 88);
            let hit =
              localX >= rx &&
              localX < rx + rw &&
              localY >= ry &&
              localY < ry + rh;
            if (hit && shape == 1) {
              const dx = (localX - rx - rw / 2) / (rw / 2),
                dy = (localY - ry - rh / 2) / (rh / 2);
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

// Sliding fractional box filter. Three separable passes soften mask coverage;
// float intermediates avoid accumulating byte-rounding errors between passes.
function alphaBox(
  source: usize,
  target: usize,
  width: i32,
  height: i32,
  radius: f64,
  vertical: bool,
): void {
  const r = <i32>Math.floor(radius),
    fraction = radius - <f64>r;
  const size = vertical ? height : width,
    lines = vertical ? width : height;
  const step = vertical ? width : 1;
  const divisor = <f64>(2 * r + 1) + 2 * fraction;
  for (let line: i32 = 0; line < lines; line++) {
    const base = vertical ? line : line * width;
    let sum: f64 = 0;
    for (let n: i32 = 0; n <= r && n < size; n++)
      sum += <f64>load<f32>(source + <usize>((base + n * step) * 4));
    for (let n: i32 = 0; n < size; n++) {
      let edge: f64 = 0;
      if (n - r - 1 >= 0)
        edge += <f64>(
          load<f32>(source + <usize>((base + (n - r - 1) * step) * 4))
        );
      if (n + r + 1 < size)
        edge += <f64>(
          load<f32>(source + <usize>((base + (n + r + 1) * step) * 4))
        );
      store<f32>(
        target + <usize>((base + n * step) * 4),
        <f32>((sum + fraction * edge) / divisor),
      );
      if (n - r >= 0)
        sum -= <f64>load<f32>(source + <usize>((base + (n - r) * step) * 4));
      if (n + r + 1 < size)
        sum += <f64>(
          load<f32>(source + <usize>((base + (n + r + 1) * step) * 4))
        );
    }
  }
}
export function featherAlpha(
  ptr: usize,
  scratchA: usize,
  scratchB: usize,
  width: i32,
  height: i32,
  radiusX: f64,
  radiusY: f64,
): void {
  const length = width * height;
  for (let i: i32 = 0; i < length; i++)
    store<f32>(
      scratchA + <usize>(i * 4),
      <f32>load<u8>(ptr + <usize>(i * 4 + 3)),
    );
  for (let pass: i32 = 0; pass < 3; pass++) {
    alphaBox(scratchA, scratchB, width, height, radiusX, false);
    alphaBox(scratchB, scratchA, width, height, radiusY, true);
  }
  for (let i: i32 = 0; i < length; i++) {
    const p = ptr + <usize>(i * 4);
    store<u8>(p, 255);
    store<u8>(p + 1, 255);
    store<u8>(p + 2, 255);
    store<u8>(p + 3, channel(<f64>load<f32>(scratchA + <usize>(i * 4))));
  }
}

export function applyLut(ptr: usize, length: i32, lutPtr: usize): void {
  for (let i: i32 = 0; i < length; i += 4) {
    const p = ptr + <usize>i;
    store<u8>(p, load<u8>(lutPtr + <usize>load<u8>(p)));
    store<u8>(p + 1, load<u8>(lutPtr + 256 + <usize>load<u8>(p + 1)));
    store<u8>(p + 2, load<u8>(lutPtr + 512 + <usize>load<u8>(p + 2)));
  }
}

export function blendAdjustment(
  targetPtr: usize,
  adjustedPtr: usize,
  maskPtr: usize,
  length: i32,
  hasMask: bool,
  opacity: f64,
): void {
  for (let i: i32 = 0; i < length; i += 4) {
    const tp = targetPtr + <usize>i;
    const ap = adjustedPtr + <usize>i;
    const targetAlpha = load<u8>(tp + 3);
    if (targetAlpha == 0) continue;

    let weight = opacity;
    if (hasMask) {
      const maskVal = <f64>load<u8>(maskPtr + <usize>(i + 3)) / 255.0;
      weight *= maskVal;
    }
    if (weight <= 0.0) continue;

    const tr = <f64>load<u8>(tp);
    const tg = <f64>load<u8>(tp + 1);
    const tb = <f64>load<u8>(tp + 2);

    const ar = <f64>load<u8>(ap);
    const ag = <f64>load<u8>(ap + 1);
    const ab = <f64>load<u8>(ap + 2);

    store<u8>(tp, channel(tr + weight * (ar - tr)));
    store<u8>(tp + 1, channel(tg + weight * (ag - tg)));
    store<u8>(tp + 2, channel(tb + weight * (ab - tb)));
  }
}

export function histogram(ptr: usize, length: i32, outPtr: usize): void {
  for (let b: usize = 0; b < 1024; b++) {
    store<u32>(outPtr + (b << 2), 0);
  }
  for (let i: i32 = 0; i < length; i += 4) {
    const p = ptr + <usize>i;
    const a = load<u8>(p + 3);
    if (a == 0) continue;
    const r = <usize>load<u8>(p);
    const g = <usize>load<u8>(p + 1);
    const b = <usize>load<u8>(p + 2);
    const lum = <usize>(
      (<u8>Math.round(<f64>r * 0.2126 + <f64>g * 0.7152 + <f64>b * 0.0722))
    );

    const rAddr = outPtr + (r << 2);
    store<u32>(rAddr, load<u32>(rAddr) + 1);

    const gAddr = outPtr + ((256 + g) << 2);
    store<u32>(gAddr, load<u32>(gAddr) + 1);

    const bAddr = outPtr + ((512 + b) << 2);
    store<u32>(bAddr, load<u32>(bAddr) + 1);

    const lumAddr = outPtr + ((768 + lum) << 2);
    store<u32>(lumAddr, load<u32>(lumAddr) + 1);
  }
}

// Mix complete filtered/original RGBA, unlike alpha-preserving adjustment layers.
export function mixFiltered(
  originalPtr: usize,
  filteredPtr: usize,
  maskPtr: usize,
  length: i32,
  density: f64,
  inverted: bool,
): void {
  for (let i: i32 = 0; i < length; i += 4) {
    const p = originalPtr + <usize>i,
      q = filteredPtr + <usize>i;
    const raw = <f64>load<u8>(maskPtr + <usize>i + 3) / 255.0;
    const coverage = 1.0 - density + density * (inverted ? 1.0 - raw : raw);
    if (coverage <= 0.0) continue;
    if (coverage >= 1.0) {
      store<u32>(p, load<u32>(q));
      continue;
    }
    // Identical visible pixels are invariant under premultiplied interpolation.
    // Keep this after endpoint handling: hidden RGB must survive exact endpoints.
    if (load<u32>(p) == load<u32>(q) && load<u8>(p + 3) != 0) continue;
    if (load<u8>(p + 3) == 0 && load<u8>(q + 3) == 0) {
      store<u32>(p, 0);
      continue;
    }
    const a = <f64>load<u8>(p + 3) * (1.0 - coverage);
    const b = <f64>load<u8>(q + 3) * coverage;
    const alpha = a + b;
    const roundedAlpha = channel(alpha);
    for (let c: usize = 0; c < 3; c++) {
      store<u8>(
        p + c,
        roundedAlpha == 0
          ? 0
          : channel(
              (<f64>load<u8>(p + c) * a + <f64>load<u8>(q + c) * b) / alpha,
            ),
      );
    }
    store<u8>(p + 3, roundedAlpha);
  }
}
