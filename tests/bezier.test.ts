import { expect, it } from "vitest";
import { Document, VectorLayer, VectorPath } from "../src/dom";
import { hitTestPath } from "../src/core/bezier";
import type { PathAnchor } from "../src/core/drawing";
const sample = (a: PathAnchor, b: PathAnchor, t: number) => {
  const u = 1 - t;
  return {
    x:
      u * u * u * a.x +
      3 * u * u * t * a.out.x +
      3 * u * t * t * b.in.x +
      t * t * t * b.x,
    y:
      u * u * u * a.y +
      3 * u * u * t * a.out.y +
      3 * u * t * t * b.in.y +
      t * t * t * b.y,
  };
};
it("subdivides open, closing and single-anchor cubic segments without changing their curves", () => {
  for (const loop of [false, true])
    for (const split of [0.13, 0.5, 0.87]) {
      const path = new VectorPath({
        closed: loop,
        points: [
          { x: 10, y: 20, out: { x: 160, y: -90 }, in: { x: -30, y: 65 } },
          { x: 120, y: 140, in: { x: -80, y: 220 }, out: { x: 170, y: 60 } },
        ],
      });
      const before = path.points,
        index = loop ? 1 : 0,
        next = (index + 1) % before.length;
      const inserted = path.splitSegment(index, split),
        after = path.points;
      expect(inserted).toBe(index + 1);
      expect(after).toHaveLength(3);
      for (let step = 0; step <= 40; step++) {
        const t = step / 40,
          expected = sample(before[index], before[next], t);
        const actual =
          t <= split
            ? sample(after[index], after[inserted], t / split)
            : sample(
                after[inserted],
                after[(inserted + 1) % after.length],
                (t - split) / (1 - split),
              );
        expect(actual.x).toBeCloseTo(expected.x, 10);
        expect(actual.y).toBeCloseTo(expected.y, 10);
      }
    }
  const loop = new VectorPath({
    closed: true,
    points: [{ x: 30, y: 40, in: { x: -50, y: 90 }, out: { x: 100, y: 90 } }],
  });
  const before = loop.points[0];
  loop.splitSegment(0);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20,
      expected = sample(before, before, t),
      points = loop.points;
    const actual =
      t <= 0.5
        ? sample(points[0], points[1], t * 2)
        : sample(points[1], points[0], (t - 0.5) * 2);
    expect(actual.x).toBeCloseTo(expected.x, 10);
    expect(actual.y).toBeCloseTo(expected.y, 10);
  }
});
it("validates split positions and preserves attached path identity, locks and undo", () => {
  const doc = new Document(),
    layer = doc.layers.add(new VectorLayer());
  const path = layer.paths.add(
    new VectorPath({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
    }),
  );
  const before = path.toJSON(),
    past = doc.getSnapshot().past.length;
  expect(path.splitSegment(0)).toBe(1);
  expect(path.id).toBe(before.id);
  expect(doc.getSnapshot().past).toHaveLength(past + 1);
  doc.undo();
  expect(path.toJSON()).toEqual(before);
  doc.redo();
  expect(path.points).toHaveLength(3);
  for (const t of [0, 1, -1, NaN, Infinity])
    expect(() => path.splitSegment(0, t)).toThrow(/strictly between/);
  for (const index of [-1, 0.5, 2, NaN])
    expect(() => path.splitSegment(index)).toThrow(/segment/);
  layer.locked = true;
  const locked = path.toJSON();
  expect(() => path.splitSegment(0)).toThrow(/Unlock/);
  expect(path.toJSON()).toEqual(locked);
});

it("hits actual cubic curves, including loops and backtracking, with screen-space tolerance", () => {
  const cases = [
    [
      { x: 0, y: 0, out: { x: 100, y: 200 } },
      { x: 200, y: 0, in: { x: 100, y: 200 } },
    ],
    [
      { x: 0, y: 0, out: { x: 220, y: 0 } },
      { x: 0, y: 0, in: { x: -220, y: 0 } },
    ],
    [{ x: 0, y: 0, out: { x: 180, y: 200 }, in: { x: -180, y: 200 } }],
  ];
  for (const anchors of cases) {
    const path = new VectorPath({ closed: true, points: anchors }),
      points = path.points;
    for (const t of [0.19, 0.4, 0.73]) {
      const expected = sample(points[0], points[1] ?? points[0], t);
      const click = { x: expected.x + 1, y: expected.y + 2 };
      const hit = hitTestPath(points, true, click, 1)!;
      expect(hit).not.toBeNull();
      expect(hit.distance).toBeLessThanOrEqual(7);
      const onCurve = sample(
        points[hit.index],
        points[(hit.index + 1) % points.length],
        hit.t,
      );
      expect(Math.hypot(onCurve.x - click.x, onCurve.y - click.y)).toBeCloseTo(
        hit.distance,
        8,
      );
      let reference = Infinity;
      for (let i = 0; i <= 20000; i++)
        for (let j = 0; j < points.length; j++) {
          const p = sample(
            points[j],
            points[(j + 1) % points.length],
            i / 20000,
          );
          reference = Math.min(
            reference,
            Math.hypot(p.x - click.x, p.y - click.y),
          );
        }
      expect(hit.distance).toBeLessThanOrEqual(reference + 0.011);
    }
  }
  const line = new VectorPath({
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }).points;
  for (const zoom of [0.1, 1, 4]) {
    expect(
      hitTestPath(line, false, { x: 50, y: 6.99 / zoom }, zoom),
    ).not.toBeNull();
    expect(
      hitTestPath(line, false, { x: 50, y: 7.01 / zoom }, zoom),
    ).toBeNull();
  }
  expect(hitTestPath(line, false, { x: 50, y: 50 }, 1)).toBeNull();
  expect(hitTestPath(line, false, { x: 0, y: 0 }, 1)).toBeNull();
});

it("curve hits handle closing segments, large coordinates and bounded work", () => {
  const path = new VectorPath({
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
  }).points;
  expect(hitTestPath(path, true, { x: 50, y: 50 }, 1)?.index).toBe(2);
  expect(hitTestPath(path, false, { x: 50, y: 50 }, 1)).toBeNull();
  const large = new VectorPath({
    points: [
      { x: 1e12, y: 1e12 },
      { x: 1e12 + 1e6, y: 1e12 },
    ],
  }).points;
  expect(
    hitTestPath(large, false, { x: 1e12 + 5e5, y: 1e12 + 6000 }, 0.001)
      ?.distance,
  ).toBeCloseTo(6);
  expect(() =>
    hitTestPath(path, true, { x: 50, y: 50 }, 1, 7, { remaining: 0 }),
  ).toThrow(/work budget/);
  expect(hitTestPath(path, true, { x: Infinity, y: 50 }, 1)).toBeNull();
});
