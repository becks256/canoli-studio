import { expect, it } from "vitest";
import { AffineTransform } from "../src/core/affine";
import { renderTransform } from "../src/engine/canvas";

it("maps a rotated local point into a nonuniformly scaled render tile", () => {
  const world = AffineTransform.translation(100, 80).multiply(
    new AffineTransform(0, 1, -1, 0),
  );
  const matrix = renderTransform(
    { x: 90, y: 70, width: 100, height: 100, sx: 2, sy: 3 },
    world,
  );
  expect(matrix.point({ x: 4, y: 5 })).toEqual({ x: 10, y: 42 });
  expect(matrix.bounds({ x: 0, y: 0, width: 4, height: 5 })).toEqual({
    x: 10,
    y: 30,
    width: 10,
    height: 12,
  });
});

it("subtracts tile origins before scaling to preserve nearby large coordinates", () => {
  const origin = Number.MAX_SAFE_INTEGER - 100;
  const matrix = renderTransform(
    { x: origin, y: -origin, width: 100, height: 100, sx: 0.3, sy: 0.7 },
    AffineTransform.translation(origin + 3, -origin + 5),
  );
  expect(matrix.e).toBe(3 * 0.3);
  expect(matrix.f).toBe(5 * 0.7);
});
