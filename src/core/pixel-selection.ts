import { z } from 'zod';

export interface CoverageRequest {
  width: number;
  height: number;
  wand?: { x: number; y: number; tolerance?: number; contiguous?: boolean };
}

/** Run pairs: exclusive linear pixel end, followed by 8-bit coverage. */
export interface PixelCoverage { width: number; height: number; runs: number[] }
export const pixelCoverageSchema = z.object({
  width: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  runs: z.array(z.number().int().nonnegative()),
}).strict().superRefine((value, ctx) => {
  let previous = 0;
  let valid = Number.isSafeInteger(value.width * value.height) && value.runs.length > 0 && value.runs.length % 2 === 0;
  for (let i = 0; i < value.runs.length; i += 2) {
    if (!Number.isSafeInteger(value.runs[i]) || value.runs[i] <= previous || value.runs[i + 1] > 255) valid = false;
    previous = value.runs[i];
  }
  if (!valid || previous !== value.width * value.height) ctx.addIssue({ code: 'custom', message: 'Invalid pixel coverage runs.' });
});
export function encodeCoverage(alpha: Uint8Array | Uint8ClampedArray, width: number, height: number): PixelCoverage {
  if (alpha.length !== width * height || !alpha.length) throw new Error('Pixel coverage geometry does not match its data.');
  const runs: number[] = [];
  let value = alpha[0];
  for (let i = 1; i <= alpha.length; i++) if (i === alpha.length || alpha[i] !== value) {
    runs.push(i, value); value = alpha[i];
  }
  return { width, height, runs };
}
export function coverageAt(data: PixelCoverage, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= data.width || y >= data.height) return 0;
  const index = Math.floor(y) * data.width + Math.floor(x);
  let lo = 0, hi = data.runs.length / 2;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (index < data.runs[mid * 2]) hi = mid; else lo = mid + 1; }
  return data.runs[lo * 2 + 1] ?? 0;
}
/** Color distance includes alpha; hidden RGB never separates transparent pixels. */
export function wandCoverage(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, tolerance = 32, contiguous = true): Uint8Array {
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255 || pixels.length !== width * height * 4) throw new Error('Invalid magic wand input.');
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error('Click inside the image to select pixels.');
  const count = width * height, result = new Uint8Array(count), seed = y * width + x;
  const seedOffset = seed * 4, seedAlpha = pixels[seedOffset + 3];
  const red = pixels[seedOffset] * seedAlpha / 255;
  const green = pixels[seedOffset + 1] * seedAlpha / 255;
  const blue = pixels[seedOffset + 2] * seedAlpha / 255;
  const matches = (index: number) => {
    const offset = index * 4, alpha = pixels[offset + 3];
    return Math.abs(alpha - seedAlpha) <= tolerance &&
      Math.abs(pixels[offset] * alpha / 255 - red) <= tolerance &&
      Math.abs(pixels[offset + 1] * alpha / 255 - green) <= tolerance &&
      Math.abs(pixels[offset + 2] * alpha / 255 - blue) <= tolerance;
  };
  if (!contiguous) { for (let i = 0; i < count; i++) if (matches(i)) result[i] = 255; return result; }
  // 0 = untested, 1 = rejected, 2 = pending run, 3 = selected.
  // Queue one seed per horizontal run instead of four neighbors per pixel.
  const seen = new Uint8Array(count), pending = [seed];
  seen[seed] = 2;
  const accepts = (i: number) => {
    if (seen[i]) return seen[i] === 2;
    const accepted = matches(i);
    seen[i] = accepted ? 2 : 1;
    return accepted;
  };
  while (pending.length) {
    const i = pending.pop()!;
    if (seen[i] === 3) continue;
    const rowStart = i - i % width, rowEnd = rowStart + width;
    let left = i, right = i + 1;
    while (left > rowStart && accepts(left - 1)) left--;
    while (right < rowEnd && accepts(right)) right++;
    seen.fill(3, left, right);
    result.fill(255, left, right);
    for (const offset of [-width, width]) {
      if (left + offset < 0 || right + offset > count) continue;
      let inRun = false;
      for (let next = left + offset; next < right + offset; next++) {
        if (seen[next]) { inRun = false; continue; }
        if (accepts(next)) {
          if (!inRun) pending.push(next);
          inRun = true;
        } else inRun = false;
      }
    }
  }
  return result;
}

const outlines = new WeakMap<PixelCoverage, string>();
/** Sparse row intervals avoid tracing each transparent source pixel on pointer moves. */
export function coverageOutline(data: PixelCoverage): string {
  const cached = outlines.get(data); if (cached !== undefined) return cached;
  const rows = new Map<number, [number, number][]>();
  let start = 0;
  for (let i = 0; i < data.runs.length; i += 2) {
    const end = data.runs[i];
    if (data.runs[i + 1]) for (let p = start; p < end;) {
      const y = Math.floor(p / data.width), x = p % data.width, right = Math.min(data.width, x + end - p);
      const spans = rows.get(y) ?? []; const last = spans.at(-1);
      if (last && last[1] === x) last[1] = right; else spans.push([x, right]);
      rows.set(y, spans); p += right - x;
    }
    start = end;
  }
  const path: string[] = [];
  const edges = (spans: [number, number][], neighbors: [number, number][], y: number) => {
    let neighborIndex = 0;
    for (const [left, right] of spans) {
      // Both interval lists are ordered and disjoint. Do not restart the
      // neighbor scan for every island in a detailed selection.
      while (neighborIndex < neighbors.length && neighbors[neighborIndex][1] <= left) neighborIndex++;
      let cursor = left;
      for (let i = neighborIndex; i < neighbors.length; i++) {
        const [a, b] = neighbors[i];
        if (b <= cursor) continue; if (a >= right) break;
        if (a > cursor) path.push(`M${cursor} ${y}H${Math.min(a, right)}`);
        cursor = Math.max(cursor, b); if (cursor >= right) break;
      }
      if (cursor < right) path.push(`M${cursor} ${y}H${right}`);
    }
  };
  let vertical = new Map<number, { start: number; end: number }>();
  const emitVertical = (x: number, edge: { start: number; end: number }) =>
    path.push(`M${x} ${edge.start}v${edge.end-edge.start}`);
  for (const [y, spans] of rows) {
    edges(spans, rows.get(y - 1) ?? [], y); edges(spans, rows.get(y + 1) ?? [], y + 1);
    const next = new Map<number, { start: number; end: number }>();
    for (const span of spans) for (const x of span) {
      const prior = vertical.get(x);
      if (prior?.end === y) {
        prior.end = y + 1;
        next.set(x, prior);
        vertical.delete(x);
      } else next.set(x, { start: y, end: y + 1 });
    }
    for (const [x, edge] of vertical) emitVertical(x, edge);
    vertical = next;
  }
  for (const [x, edge] of vertical) emitVertical(x, edge);
  const result = path.join(''); outlines.set(data, result); return result;
}
