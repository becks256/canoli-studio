import type { PathAnchor, Point } from "./drawing";

/** De Casteljau subdivision; changes parameterization, not the cubic curve. */
export function splitPathSegment(
  points: readonly PathAnchor[],
  closed: boolean,
  index: number,
  t = 0.5,
): PathAnchor[] {
  const segments = closed ? points.length : points.length - 1;
  if (!Number.isInteger(index) || index < 0 || index >= segments)
    throw new Error("Path segment not found.");
  if (!Number.isFinite(t) || t <= 0 || t >= 1)
    throw new Error("Split position must be strictly between 0 and 1.");
  const next = (index + 1) % points.length,
    a = points[index],
    b = points[next];
  const mix = (p: Point, q: Point): Point => ({
    x: (1 - t) * p.x + t * q.x,
    y: (1 - t) * p.y + t * q.y,
  });
  const q0 = mix(a, a.out),
    q1 = mix(a.out, b.in),
    q2 = mix(b.in, b);
  const r0 = mix(q0, q1),
    r1 = mix(q1, q2),
    point = mix(r0, r1);
  const result = points.map((p) => ({
    ...p,
    in: { ...p.in },
    out: { ...p.out },
  }));
  result[index].out = q0;
  result[next].in = q2;
  result.splice(index + 1, 0, { ...point, in: r0, out: r1 });
  return result;
}

export interface CurveHit {
  index: number;
  t: number;
  distance: number;
}
export interface CurveHitBudget {
  remaining: number;
}
type Cubic = [Point, Point, Point, Point];
const mixPoint = (a: Point, b: Point, t: number): Point => ({
  x: (1 - t) * a.x + t * b.x,
  y: (1 - t) * a.y + t * b.y,
});
function divide(c: Cubic, t: number): [Cubic, Cubic] {
  const a = mixPoint(c[0], c[1], t),
    b = mixPoint(c[1], c[2], t),
    d = mixPoint(c[2], c[3], t);
  const e = mixPoint(a, b, t),
    f = mixPoint(b, d, t),
    p = mixPoint(e, f, t);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
}
function lowerDistance(c: Cubic): number {
  const xs = c.map((p) => p.x),
    ys = c.map((p) => p.y);
  // The curve lies inside the convex hull of its four control points.
  const x = Math.max(0, Math.min(...xs), -Math.max(...xs));
  const y = Math.max(0, Math.min(...ys), -Math.max(...ys));
  return Math.hypot(x, y);
}

/** Bounded closest-curve search in screen space. Returned distance is measured on the cubic itself. */
export function hitTestPath(
  points: readonly PathAnchor[],
  closed: boolean,
  point: Point,
  zoom: number,
  tolerance = 7,
  budget: CurveHitBudget = { remaining: 65536 },
): CurveHit | null {
  if (
    ![point.x, point.y, zoom, tolerance].every(Number.isFinite) ||
    zoom <= 0 ||
    tolerance < 0
  )
    return null;
  const nearest: { hit: CurveHit | null } = { hit: null };
  const consider = (p: Point, index: number, t: number) => {
    const distance = Math.hypot(p.x, p.y);
    if (
      distance <= tolerance &&
      (!nearest.hit || distance < nearest.hit.distance)
    )
      nearest.hit = { index, t, distance };
  };
  const screen = (p: Point): Point => ({
    x: (p.x - point.x) * zoom,
    y: (p.y - point.y) * zoom,
  });
  const count = closed ? points.length : Math.max(0, points.length - 1);
  for (let index = 0; index < count; index++) {
    const a = points[index],
      b = points[(index + 1) % points.length];
    const stack: { c: Cubic; from: number; to: number; depth: number }[] = [
      {
        c: [screen(a), screen(a.out), screen(b.in), screen(b)],
        from: 0,
        to: 1,
        depth: 0,
      },
    ];
    while (stack.length) {
      if (--budget.remaining < 0)
        throw new Error(
          "Curve hit testing exceeded its work budget. Zoom in or use Insert midpoint.",
        );
      const node = stack.pop()!,
        { c, from, to, depth } = node;
      const lower = lowerDistance(c);
      const current = nearest.hit;
      if (lower > tolerance || (current && lower >= current.distance - 0.01))
        continue;
      consider(c[0], index, from);
      consider(c[3], index, to);
      const dx = c[3].x - c[0].x,
        dy = c[3].y - c[0].y,
        length = dx * dx + dy * dy;
      const ratio = length
        ? Math.max(0, Math.min(1, -(c[0].x * dx + c[0].y * dy) / length))
        : 0.5;
      const [projected] = divide(c, ratio);
      consider(projected[3], index, from + ratio * (to - from));
      const [left, right] = divide(c, 0.5),
        middle = (from + to) / 2;
      consider(left[3], index, middle);
      if (depth >= 60 || middle === from || middle === to) continue;
      const first = { c: left, from, to: middle, depth: depth + 1 };
      const second = { c: right, from: middle, to, depth: depth + 1 };
      // Visit the more promising half first so later bounding-box checks prune work.
      if (lowerDistance(left) < lowerDistance(right)) stack.push(second, first);
      else stack.push(first, second);
    }
  }
  const result = nearest.hit;
  return result && result.t > 0 && result.t < 1 ? result : null;
}
