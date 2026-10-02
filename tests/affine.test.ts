import { describe, expect, it } from "vitest";
import { AffineTransform as Matrix } from "../src/core/affine";
import { maskTransform, maskOrigin } from "../src/core/masks";
import { LayerMask } from "../src/dom";

describe("affine coordinate foundation", () => {
  it("composes linked mask offsets in layer space and keeps unlinked masks in document space", () => {
    const mask = new LayerMask({ base: 1, x: 4, y: 6 }).toJSON();
    const layer = Matrix.translation(20, 30).multiply(Matrix.scale(2, 3));
    expect(maskTransform(mask, layer).point({ x: 1, y: 2 })).toEqual({
      x: 30,
      y: 54,
    });
    expect(
      maskTransform({ ...mask, linked: false }, layer).point({ x: 1, y: 2 }),
    ).toEqual({ x: 5, y: 8 });
    expect(maskOrigin(mask, 20, 30)).toEqual({ x: 24, y: 36 });
    const rotation = Matrix.rotation(Math.PI / 2);
    const world = maskTransform(mask, rotation).point({ x: 1, y: 2 });
    expect(world.x).toBeCloseTo(-8);
    expect(world.y).toBeCloseTo(5);
    const local = maskTransform(mask, rotation).inverse().point(world);
    expect(local.x).toBeCloseTo(1);
    expect(local.y).toBeCloseTo(2);
  });
  it("composes child then parent, preserving the distinction from reversed order", () => {
    const parent = Matrix.translation(100, 50).multiply(
      Matrix.rotation(Math.PI / 2),
    );
    const child = Matrix.translation(10, 20).multiply(Matrix.scale(2, 3));
    const point = parent.multiply(child).point({ x: 4, y: 5 });
    expect(point.x).toBeCloseTo(65);
    expect(point.y).toBeCloseTo(68);
    expect(child.multiply(parent).point({ x: 4, y: 5 })).not.toEqual(point);
    const local = parent.multiply(child).inverse().point(point);
    expect(local.x).toBeCloseTo(4);
    expect(local.y).toBeCloseTo(5);
  });
  it("supports reflection, shear, pivots and enclosing bounds", () => {
    const matrix = new Matrix(-2, 0, 1, 3, 8, -4);
    expect(matrix.bounds({ x: 1, y: 2, width: 4, height: 5 })).toEqual({
      x: 0,
      y: 2,
      width: 13,
      height: 15,
    });
    const pivot = { x: 70, y: -30 };
    const rotation = Matrix.rotation(0.72).around(pivot);
    expect(rotation.point(pivot).x).toBeCloseTo(pivot.x);
    expect(rotation.point(pivot).y).toBeCloseTo(pivot.y);
    expect(Matrix.scale(-2, 3).inverse().point({ x: -8, y: 15 })).toEqual({
      x: 4,
      y: 5,
    });
  });
  it("inverts tiny and huge uniform scales without determinant overflow", () => {
    for (const scale of [1e-180, 1e180]) {
      const identity = Matrix.scale(scale)
        .inverse()
        .multiply(Matrix.scale(scale));
      expect(identity.a).toBeCloseTo(1);
      expect(identity.d).toBeCloseTo(1);
    }
  });
  it("rejects singular and nonfinite operations without mutating inputs", () => {
    const matrix = new Matrix();
    expect(Object.isFrozen(matrix)).toBe(true);
    expect(() => new Matrix(Infinity)).toThrow(/finite/);
    expect(() => Matrix.scale(0).inverse()).toThrow(/singular/);
    expect(() => new Matrix(1, 2, 2, 4).inverse()).toThrow(/singular/);
    expect(() => Matrix.scale(1e308).multiply(Matrix.scale(2))).toThrow(
      /finite/,
    );
    expect(() => matrix.point({ x: NaN, y: 0 })).toThrow(/finite/);
    expect(() => matrix.bounds({ x: 0, y: 0, width: -1, height: 4 })).toThrow(
      /Bounds/,
    );
    expect(matrix.point({ x: 2, y: 3 })).toEqual({ x: 2, y: 3 });
  });
});
