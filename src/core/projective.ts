import type {AffineBounds, AffineData, AffinePoint} from './affine';

export type ProjectiveData = readonly [number, number, number, number, number, number, number, number, number];
export type ProjectiveQuad = readonly [AffinePoint, AffinePoint, AffinePoint, AffinePoint];

/** Private homogeneous column-vector geometry. Public layer transforms remain
 * affine until commands, source ownership and all editor surfaces are connected. */
export class ProjectiveTransform {
  readonly values: ProjectiveData;
  constructor(values: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1]) {
    if (!Array.isArray(values) || values.length !== 9 || !values.every(Number.isFinite))
      throw new Error('Use nine finite projective coefficients.');
    const scale = Math.max(...values.map(Math.abs));
    if (!scale) throw new Error('Projective transform is singular.');
    this.values = Object.freeze([...values]) as unknown as ProjectiveData;
    Object.freeze(this);
  }
  static fromAffine(m: AffineData) {
    return new ProjectiveTransform([m.a, m.c, m.e, m.b, m.d, m.f, 0, 0, 1]);
  }
  /** Source boundary corners map in TL, TR, BR, BL order; reflection is valid.
   * Solve in a translated/scaled destination frame, then restore placement. */
  static rectangle(width: number, height: number, corners: ProjectiveQuad) {
    nativeExtent(width, height);
    const quad = captureQuad(corners), origin = quad[0];
    const scale = Math.max(...quad.flatMap(p => [Math.abs(p.x - origin.x), Math.abs(p.y - origin.y)]));
    const p = quad.map(q => ({x: (q.x - origin.x) / scale, y: (q.y - origin.y) / scale}));
    const dx1 = p[1].x - p[2].x, dx2 = p[3].x - p[2].x, dx3 = p[2].x - p[1].x - p[3].x;
    const dy1 = p[1].y - p[2].y, dy2 = p[3].y - p[2].y, dy3 = p[2].y - p[1].y - p[3].y;
    const determinant = dx1 * dy2 - dx2 * dy1;
    let g = 0, h = 0;
    if (dx3 !== 0 || dy3 !== 0) {
      if (!determinant) throw new Error('Perspective corners cannot be resolved at working precision.');
      g = (dx3 * dy2 - dx2 * dy3) / determinant;
      h = (dx1 * dy3 - dx3 * dy1) / determinant;
    }
    const local = new ProjectiveTransform([
      (1 + g) * p[1].x / width, (1 + h) * p[3].x / height, 0,
      (1 + g) * p[1].y / width, (1 + h) * p[3].y / height, 0,
      g / width, h / height, 1,
    ]);
    const result = new ProjectiveTransform([scale, 0, origin.x, 0, scale, origin.y, 0, 0, 1]).multiply(local);
    result.quad(width, height);
    return result;
  }
  multiply(child: ProjectiveTransform) {
    const a = this.values, b = child.values, result = new Array<number>(9).fill(0);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++)
      for (let k = 0; k < 3; k++) result[row * 3 + col] += a[row * 3 + k] * b[k * 3 + col];
    return new ProjectiveTransform(result);
  }
  point({x, y}: AffinePoint): AffinePoint {
    if (![x, y].every(Number.isFinite)) throw new Error('Projective point must be finite.');
    const m = this.values, w = m[6] * x + m[7] * y + m[8];
    const px = (m[0] * x + m[1] * y + m[2]) / w, py = (m[3] * x + m[4] * y + m[5]) / w;
    if (!w || !Number.isFinite(w) || !Number.isFinite(px) || !Number.isFinite(py))
      throw new Error('Projective point reaches a horizon or exceeds coordinate precision.');
    return {x: px, y: py};
  }
  inverse() {
    const scale=Math.max(...this.values.map(Math.abs));
    const [a,b,c,d,e,f,g,h,i] = scale>1e150||scale<1e-150?this.values.map(v=>v/scale):this.values;
    const inverse = [e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
    const determinant=a*inverse[0]+b*inverse[3]+c*inverse[6];
    if(!Number.isFinite(determinant)||Math.abs(determinant)<2**-1022){
      // A perfectly usable uniform scale can have an underflowed determinant.
      // Balance rows before forming cofactors, then apply reciprocal row scales
      // to columns of the inverse. No geometry/scale admission cutoff is used.
      const m=this.values,rows=[Math.max(...m.slice(0,3).map(Math.abs)),Math.max(...m.slice(3,6).map(Math.abs)),Math.max(...m.slice(6,9).map(Math.abs))];
      if(rows.some(v=>v===0))throw new Error('Projective transform is singular at working precision.');
      const [a,b,c,d,e,f,g,h,i]=m.map((v,index)=>v/rows[Math.floor(index/3)]);
      const balanced=[e*i-f*h,c*h-b*i,b*f-c*e,f*g-d*i,a*i-c*g,c*d-a*f,d*h-e*g,b*g-a*h,a*e-b*d];
      if(a*balanced[0]+b*balanced[3]+c*balanced[6]===0)throw new Error('Projective transform is singular at working precision.');
      let weights=rows.map(v=>1/v);
      if(weights.some(v=>!Number.isFinite(v))){const common=Math.min(...rows);weights=rows.map(v=>common/v);}
      const norm=Math.max(...balanced.map(Math.abs)),values=balanced.map((v,index)=>v/norm*weights[index%3]);
      if(weights.some(v=>v===0)||values.some((v,index)=>!Number.isFinite(v)||v===0&&balanced[index]!==0))
        throw new Error('Projective inverse cannot be resolved at working precision.');
      return new ProjectiveTransform(values);
    }
    // A homogeneous inverse is an adjugate; dividing by its determinant adds
    // overflow without changing any mapped point.
    return new ProjectiveTransform(inverse);
  }
  quad(width: number, height: number): ProjectiveQuad {
    nativeExtent(width, height);
    const source = [{x: 0, y: 0}, {x: width, y: 0}, {x: width, y: height}, {x: 0, y: height}];
    const m = this.values, denominators = source.map(p => m[6] * p.x + m[7] * p.y + m[8]);
    if (denominators.some(w => !Number.isFinite(w) || w === 0 || Math.sign(w) !== Math.sign(denominators[0])))
      throw new Error('Perspective crosses a horizon inside the original image.');
    this.inverse();
    return captureQuad(source.map(p => this.point(p)) as unknown as ProjectiveQuad);
  }
  bounds(width: number, height: number): AffineBounds {
    const quad = this.quad(width, height), xs = quad.map(p => p.x), ys = quad.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (![x,y,w,h].every(Number.isFinite)) throw new Error('Perspective bounds exceed coordinate precision.');
    return {x, y, width: w, height: h};
  }
}

export function nativeExtent(width: number, height: number) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0))
    throw new Error('Perspective requires complete native source geometry.');
}

export function captureQuad(value: ProjectiveQuad): ProjectiveQuad {
  if (!Array.isArray(value) || value.length !== 4 || value.some(p => !p || ![p.x,p.y].every(Number.isFinite)))
    throw new Error('Use four finite ordered perspective corners.');
  const quad = value.map(p => ({x:p.x, y:p.y}));
  const scale = Math.max(...quad.flatMap(p => [Math.abs(p.x - quad[0].x), Math.abs(p.y - quad[0].y)]));
  if (!Number.isFinite(scale) || scale === 0) throw new Error('Perspective corners are degenerate.');
  const p = quad.map(v => ({x:(v.x-quad[0].x)/scale,y:(v.y-quad[0].y)/scale}));
  let winding = 0;
  for (let i = 0; i < 4; i++) {
    const a=p[i], b=p[(i+1)%4], c=p[(i+2)%4], cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if (!Number.isFinite(cross) || cross === 0 || winding && Math.sign(cross) !== winding)
      throw new Error('Perspective corners must form a strictly convex nonfolding quadrilateral.');
    winding = Math.sign(cross);
  }
  return Object.freeze(quad.map(p => Object.freeze(p))) as unknown as ProjectiveQuad;
}

/** Convex polygon clipped to an axis-aligned window, calculated in its local
 * frame so shoelace/edge arithmetic does not subtract large absolute products. */
export function clipProjectiveQuad(quad: ProjectiveQuad, bounds: AffineBounds): AffinePoint[] {
  let polygon = quad.map(p => ({x:p.x-bounds.x,y:p.y-bounds.y}));
  for (let edge=0;edge<4;edge++) {
    const axis=edge<2?'x':'y', limit=edge===1?bounds.width:edge===3?bounds.height:0, lower=edge%2===0;
    const output:AffinePoint[]=[];
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i], b=polygon[(i+1)%polygon.length], av=a[axis]-limit,bv=b[axis]-limit,ai=lower?av>=0:av<=0,bi=lower?bv>=0:bv<=0;
      if(ai)output.push(a);
      if(ai!==bi){const t=av/(av-bv);output.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
    }
    polygon=output;
  }
  return polygon.map(p=>({x:p.x+bounds.x,y:p.y+bounds.y}));
}
