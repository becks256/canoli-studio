import type {BrushStrokeData,Rect,StrokePoint} from './drawing';

/** Shared native replay grid, clipped without changing segment stamp indices. */
export function* strokeStamps(
  stroke: BrushStrokeData,
  visible: Rect,
  from = 0,
) {
  const padding = stroke.size / 2 + 2;
  const inView = (p: StrokePoint) =>
    p.x >= visible.x - padding &&
    p.x <= visible.x + visible.width + padding &&
    p.y >= visible.y - padding &&
    p.y <= visible.y + visible.height + padding;
  if (from === 0 && inView(stroke.points[0])) yield stroke.points[0];
  for (let i = Math.max(1, from); i < stroke.points.length; i++) {
    const a = stroke.points[i - 1],
      b = stroke.points[i];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const length =
      stroke.kind === "pencil"
        ? Math.max(Math.abs(dx), Math.abs(dy))
        : Math.hypot(dx, dy);
    const spacingFactor = stroke.spacing ?? 0.12;
    const spacing =
      stroke.kind === "pencil"
        ? 1
        : Math.max(
            0.5,
            stroke.size *
              spacingFactor *
              Math.max(0.05, Math.min(a.pressure, b.pressure)),
          );
    const count = Math.max(1, Math.ceil(length / spacing));
    // Clip the parameter interval before stepping, retaining the same stamp grid
    // on every viewport/export tile to avoid seams.
    let low = 0,
      high = 1;
    for (const [start, delta, min, max] of [
      [a.x, dx, visible.x - padding, visible.x + visible.width + padding],
      [a.y, dy, visible.y - padding, visible.y + visible.height + padding],
    ]) {
      if (delta === 0) {
        if (start < min || start > max) {
          high = -1;
          break;
        }
      } else {
        const t0 = (min - start) / delta,
          t1 = (max - start) / delta;
        low = Math.max(low, Math.min(t0, t1));
        high = Math.min(high, Math.max(t0, t1));
      }
    }
    const first = Math.max(1, Math.ceil(low * count)),
      last = Math.min(count, Math.floor(high * count));
    // Beyond safe integers, ++ can leave the index unchanged forever. This is
    // a numeric replay failure, never a source-image/import resolution limit.
    if (first <= last && (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)))
      throw new Error('Stroke stamp indices exceed numeric precision. Move extremely distant geometry closer before rendering.');
    for (
      let step = first;
      step <= last;
      step++
    ) {
      const t = step / count;
      yield {
        x: a.x + dx * t,
        y: a.y + dy * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      };
    }
  }
}

export function paintStampSize(stroke:BrushStrokeData,point:StrokePoint):number{return (stroke.pressureSize??true)?stroke.size*Math.max(0.05,point.pressure):stroke.size;}
export function paintStampAlpha(stroke:BrushStrokeData,point:StrokePoint,alpha=1):number{const flow=stroke.flow??1;if(flow<1)alpha*=Math.max(0.01,flow);if(stroke.pressureOpacity??false)alpha*=Math.max(0.01,point.pressure);return alpha;}
