import type { BrushStrokeData, Rect } from '../core/drawing';

/** Conservative support of all linearly interpolated brush stamps. */
export function strokeIntersectsRegion(stroke: BrushStrokeData, rect: Rect, margin = 2): boolean {
  const padding = stroke.size / 2 + margin;
  if (!Number.isFinite(padding)) return true;
  const slack = 1e-10 * (1 + Math.abs(rect.x) + Math.abs(rect.y) + rect.width + rect.height + padding);
  const left = rect.x - padding - slack, top = rect.y - padding - slack;
  const right = rect.x + rect.width + padding + slack, bottom = rect.y + rect.height + padding + slack;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
    const rounding = 1e-10 * (Math.abs(a.x) + Math.abs(a.y) + Math.abs(b.x) + Math.abs(b.y));
    let low = 0, high = 1;
    for (const [start, delta, min, max] of [
      [a.x, b.x - a.x, left - rounding, right + rounding],
      [a.y, b.y - a.y, top - rounding, bottom + rounding],
    ]) {
      if (!Number.isFinite(start) || !Number.isFinite(delta)) return true;
      if (delta === 0) {
        if (start < min || start > max) { high = -1; break; }
      } else {
        const t0 = (min - start) / delta, t1 = (max - start) / delta;
        low = Math.max(low, Math.min(t0, t1)); high = Math.min(high, Math.max(t0, t1));
      }
    }
    if (low <= high) return true;
  }
  return false;
}

/** Integer native-pixel bounds containing every stamp that can touch this tile. */
export function strokeCaptureRegion(stroke: BrushStrokeData, rect: Rect): Rect | null {
  const padding = stroke.size / 2 + 2;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)], b = stroke.points[i];
    const x0 = Math.max(rect.x, Math.floor(Math.min(a.x, b.x) - padding));
    const y0 = Math.max(rect.y, Math.floor(Math.min(a.y, b.y) - padding));
    const x1 = Math.min(rect.x + rect.width, Math.ceil(Math.max(a.x, b.x) + padding));
    const y1 = Math.min(rect.y + rect.height, Math.ceil(Math.max(a.y, b.y) + padding));
    if (x1 <= x0 || y1 <= y0) continue;
    left = Math.min(left, x0); top = Math.min(top, y0);
    right = Math.max(right, x1); bottom = Math.max(bottom, y1);
  }
  return right > left && bottom > top ? { x: left, y: top, width: right-left, height: bottom-top } : null;
}
