export interface AffineData {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
export interface AffinePoint {
  x: number;
  y: number;
}
export interface AffineBounds extends AffinePoint {
  width: number;
  height: number;
}

/** Column-vector matrix [a c e; b d f; 0 0 1], in double precision.
 * multiply(child) applies child first, then this transform.
 * Immutable value shared by rendering and selection coordinate transforms.
 */
export class AffineTransform {
  constructor(
    readonly a = 1,
    readonly b = 0,
    readonly c = 0,
    readonly d = 1,
    readonly e = 0,
    readonly f = 0,
  ) {
    if (![a, b, c, d, e, f].every(Number.isFinite))
      throw new Error("Transform coefficients must be finite.");
    Object.freeze(this);
  }

  static fromJSON(value: AffineData) {
    return new AffineTransform(
      value.a,
      value.b,
      value.c,
      value.d,
      value.e,
      value.f,
    );
  }
  toJSON(): AffineData {
    return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f };
  }

  static translation(x: number, y: number) {
    return new AffineTransform(1, 0, 0, 1, x, y);
  }
  static scale(x: number, y = x) {
    return new AffineTransform(x, 0, 0, y);
  }
  /** Positive angles rotate clockwise in the editor's downward-positive Y plane. */
  static rotation(radians: number) {
    return new AffineTransform(
      Math.cos(radians),
      Math.sin(radians),
      -Math.sin(radians),
      Math.cos(radians),
    );
  }
  multiply(child: AffineTransform) {
    return new AffineTransform(
      this.a * child.a + this.c * child.b,
      this.b * child.a + this.d * child.b,
      this.a * child.c + this.c * child.d,
      this.b * child.c + this.d * child.d,
      this.a * child.e + this.c * child.f + this.e,
      this.b * child.e + this.d * child.f + this.f,
    );
  }
  around(pivot: AffinePoint) {
    return AffineTransform.translation(pivot.x, pivot.y)
      .multiply(this)
      .multiply(AffineTransform.translation(-pivot.x, -pivot.y));
  }
  point(point: AffinePoint): AffinePoint {
    const x = this.a * point.x + this.c * point.y + this.e;
    const y = this.b * point.x + this.d * point.y + this.f;
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Transformed point is not finite.");
    return { x, y };
  }
  inverse() {
    // Normalize before computing the determinant to avoid overflow/underflow
    // for uniformly very large/small scales. No arbitrary scale cutoff.
    const scale = Math.max(
      Math.abs(this.a),
      Math.abs(this.b),
      Math.abs(this.c),
      Math.abs(this.d),
    );
    if (scale === 0) throw new Error("Transform is singular.");
    const a = this.a / scale,
      b = this.b / scale,
      c = this.c / scale,
      d = this.d / scale;
    const determinant = a * d - b * c;
    if (determinant === 0)
      throw new Error("Transform is singular at working precision.");
    const ia = d / determinant / scale,
      ib = -b / determinant / scale;
    const ic = -c / determinant / scale,
      id = a / determinant / scale;
    return new AffineTransform(
      ia,
      ib,
      ic,
      id,
      -(ia * this.e + ic * this.f),
      -(ib * this.e + id * this.f),
    );
  }
  bounds(bounds: AffineBounds): AffineBounds {
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(
        Number.isFinite,
      ) ||
      bounds.width < 0 ||
      bounds.height < 0
    )
      throw new Error("Bounds must be finite with nonnegative dimensions.");
    const points = [
      this.point(bounds),
      this.point({ x: bounds.x + bounds.width, y: bounds.y }),
      this.point({ x: bounds.x, y: bounds.y + bounds.height }),
      this.point({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }),
    ];
    const x = Math.min(...points.map((point) => point.x)),
      y = Math.min(...points.map((point) => point.y));
    const width =
      Math.abs(this.a) * bounds.width + Math.abs(this.c) * bounds.height;
    const height =
      Math.abs(this.b) * bounds.width + Math.abs(this.d) * bounds.height;
    if (!Number.isFinite(width) || !Number.isFinite(height))
      throw new Error("Transformed bounds are not finite.");
    return { x, y, width, height };
  }
}
