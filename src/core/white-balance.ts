import { z } from "zod";
import { SRGB_TO_XYZ_D65, multiplyMatrix3x3, multiplyMatrix3x3Vector3 } from "./color/spaces";
import type { Matrix3x3, Vector3 } from "./color/types";

export interface WhiteBalanceAdjustmentData { kind: "white-balance"; temperature: number; tint: number }
export const WHITE_BALANCE_NEUTRAL = 6504;
export const whiteBalanceAdjustmentSchema = z.object({
  kind: z.literal("white-balance"),
  temperature: z.number().finite().min(2000).max(25000),
  tint: z.number().finite().min(-100).max(100),
}).strict();
export function defaultWhiteBalanceAdjustment(): WhiteBalanceAdjustmentData {
  return { kind: "white-balance", temperature: WHITE_BALANCE_NEUTRAL, tint: 0 };
}

function inverse(m: Matrix3x3): Matrix3x3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
    [(f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
    [(d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant],
  ];
}
const bradford: Matrix3x3 = [[.8951, .2664, -.1614], [-.7502, 1.7135, .0367], [.0389, -.0685, 1.0296]];
const bradfordInverse = inverse(bradford);
const rgbToXYZ = SRGB_TO_XYZ_D65.map(row => [...row]) as Matrix3x3;
const xyzToRGB = inverse(rgbToXYZ);
const d65: [number, number] = [.3127, .329];
function uv(x: number, y: number): [number, number] { const d = -2 * x + 12 * y + 3; return [4 * x / d, 6 * y / d]; }
const referenceUV = uv(...d65);
const referenceXYZ: Vector3 = [d65[0] / d65[1], 1, (1 - d65[0] - d65[1]) / d65[1]];
const targetLMS = multiplyMatrix3x3Vector3(bradford, referenceXYZ);

/** Kang et al. (2002) approximation and its analytic tangent in CIE 1960 uv.
 * Analytic derivatives avoid crossing the polynomial's piecewise boundaries.
 */
function locus(temperature: number) {
  const t = temperature, [a, b, c, d] = t <= 4000 ? [-.2661239e9, -.2343589e6, .8776956e3, .179910] : [-3.0258469e9, 2.1070379e6, .2226347e3, .24039];
  const x = a / t ** 3 + b / t ** 2 + c / t + d;
  const dx = -3 * a / t ** 4 - 2 * b / t ** 3 - c / t ** 2;
  const [p, q, r, s] = t <= 2222 ? [-1.1063814, -1.34811020, 2.18555832, -.20219683] : t <= 4000 ? [-.9549476, -1.37418593, 2.09137015, -.16748867] : [3.081758, -5.8733867, 3.75112997, -.37001483];
  const y = p * x ** 3 + q * x ** 2 + r * x + s, dy = (3 * p * x ** 2 + 2 * q * x + r) * dx;
  const denominator = -2 * x + 12 * y + 3, derivative = -2 * dx + 12 * dy;
  const du = 4 * (dx * denominator - x * derivative) / denominator ** 2;
  const dv = 6 * (dy * denominator - y * derivative) / denominator ** 2;
  const length = Math.hypot(du, dv);
  return { uv: uv(x, y), greenNormal: [dv / length, -du / length] };
}
const neutralUV = locus(WHITE_BALANCE_NEUTRAL).uv;

/** D65-relative source illuminant, Y=1. Tint units are 0.00005 along the green normal. */
export function whiteBalanceWhitePoint(options: WhiteBalanceAdjustmentData): Vector3 {
  const settings = whiteBalanceAdjustmentSchema.parse(options), sample = locus(settings.temperature);
  const u = sample.uv[0] + referenceUV[0] - neutralUV[0] + sample.greenNormal[0] * settings.tint * .00005;
  const v = sample.uv[1] + referenceUV[1] - neutralUV[1] + sample.greenNormal[1] * settings.tint * .00005;
  const denominator = 2 * u - 8 * v + 4, x = 3 * u / denominator, y = 2 * v / denominator;
  return [x / y, 1, (1 - x - y) / y];
}

/** Bradford source-white -> D65 adaptation in linear sRGB. */
export function whiteBalanceMatrix(options: WhiteBalanceAdjustmentData): Matrix3x3 {
  const settings = whiteBalanceAdjustmentSchema.parse(options);
  if (settings.temperature === WHITE_BALANCE_NEUTRAL && settings.tint === 0) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const sourceLMS = multiplyMatrix3x3Vector3(bradford, whiteBalanceWhitePoint(settings));
  const gains = sourceLMS.map((value, i) => targetLMS[i] / value);
  const scaled = bradford.map((row, i) => row.map(value => value * gains[i])) as Matrix3x3;
  return multiplyMatrix3x3(xyzToRGB, multiplyMatrix3x3(bradfordInverse, multiplyMatrix3x3(scaled, rgbToXYZ)));
}
