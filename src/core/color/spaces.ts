/**
 * Mathematical color spaces, transfer functions, and chromatic adaptation matrices.
 */

import type {
  Matrix3x3,
  StandardRgbSpaceId,
  Vector3,
  WhitePoint,
} from "./types";

export const WHITE_POINT_D65: WhitePoint = {
  x: 0.3127,
  y: 0.329,
  X: 0.95047,
  Y: 1.0,
  Z: 1.08883,
};

export const WHITE_POINT_D50: WhitePoint = {
  x: 0.3457,
  y: 0.3585,
  X: 0.96422,
  Y: 1.0,
  Z: 0.82521,
};

// Bradford Chromatic Adaptation Matrices (D65 <-> D50)
export const BRADFORD_D65_TO_D50: Matrix3x3 = [
  [1.0478112, 0.0228866, -0.050127],
  [0.0295424, 0.9904844, -0.0170491],
  [-0.0092345, 0.0150436, 0.7521316],
];

export const BRADFORD_D50_TO_D65: Matrix3x3 = [
  [0.9555766, -0.0230393, 0.0631636],
  [-0.0282895, 1.0099416, 0.0210077],
  [0.0122982, -0.020483, 1.3299098],
];

// Linear RGB to XYZ (D65)
export const SRGB_TO_XYZ_D65: Matrix3x3 = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];

export const XYZ_D65_TO_SRGB: Matrix3x3 = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];

export const DISPLAY_P3_TO_XYZ_D65: Matrix3x3 = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0.0, 0.0451134, 1.0439444],
];

export const XYZ_D65_TO_DISPLAY_P3: Matrix3x3 = [
  [2.4934969, -0.9313836, -0.4027108],
  [-0.829489, 1.7626641, 0.0236247],
  [0.0358458, -0.0761724, 0.9568845],
];

export const ADOBE_RGB_TO_XYZ_D65: Matrix3x3 = [
  [0.5767309, 0.185554, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085],
];

export const XYZ_D65_TO_ADOBE_RGB: Matrix3x3 = [
  [2.041369, -0.5649464, -0.3446944],
  [-0.969266, 1.8760108, 0.041556],
  [0.0134474, -0.1183897, 1.0154096],
];

export function multiplyMatrix3x3Vector3(m: Matrix3x3, v: Vector3): Vector3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function multiplyMatrix3x3(a: Matrix3x3, b: Matrix3x3): Matrix3x3 {
  const result: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      result[r][c] = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
    }
  }
  return result;
}

// Tone Reproduction Curves (EOTF & OETF)

export function srgbToLinear(c: number): number {
  const abs = Math.abs(c);
  const sign = Math.sign(c);
  if (abs <= 0.04045) {
    return (sign * abs) / 12.92;
  }
  return sign * Math.pow((abs + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const abs = Math.abs(c);
  const sign = Math.sign(c);
  if (abs <= 0.0031308) {
    return sign * abs * 12.92;
  }
  return sign * (1.055 * Math.pow(abs, 1 / 2.4) - 0.055);
}

export function adobeRgbToLinear(c: number): number {
  const gamma = 2.19921875;
  const abs = Math.abs(c);
  const sign = Math.sign(c);
  return sign * Math.pow(abs, gamma);
}

export function linearToAdobeRgb(c: number): number {
  const gamma = 2.19921875;
  const abs = Math.abs(c);
  const sign = Math.sign(c);
  return sign * Math.pow(abs, 1 / gamma);
}

// RGB space transfer curve application
export function toLinearRgb(rgb: Vector3, space: StandardRgbSpaceId): Vector3 {
  switch (space) {
    case "srgb":
    case "display-p3":
      return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
    case "adobe-rgb":
      return [
        adobeRgbToLinear(rgb[0]),
        adobeRgbToLinear(rgb[1]),
        adobeRgbToLinear(rgb[2]),
      ];
    case "linear-srgb":
      return [rgb[0], rgb[1], rgb[2]];
  }
}

export function fromLinearRgb(
  linearRgb: Vector3,
  space: StandardRgbSpaceId,
): Vector3 {
  switch (space) {
    case "srgb":
    case "display-p3":
      return [
        linearToSrgb(linearRgb[0]),
        linearToSrgb(linearRgb[1]),
        linearToSrgb(linearRgb[2]),
      ];
    case "adobe-rgb":
      return [
        linearToAdobeRgb(linearRgb[0]),
        linearToAdobeRgb(linearRgb[1]),
        linearToAdobeRgb(linearRgb[2]),
      ];
    case "linear-srgb":
      return [linearRgb[0], linearRgb[1], linearRgb[2]];
  }
}

// Linear RGB to XYZ (D65)
export function linearRgbToXyzD65(
  linearRgb: Vector3,
  space: StandardRgbSpaceId,
): Vector3 {
  switch (space) {
    case "srgb":
    case "linear-srgb":
      return multiplyMatrix3x3Vector3(SRGB_TO_XYZ_D65, linearRgb);
    case "display-p3":
      return multiplyMatrix3x3Vector3(DISPLAY_P3_TO_XYZ_D65, linearRgb);
    case "adobe-rgb":
      return multiplyMatrix3x3Vector3(ADOBE_RGB_TO_XYZ_D65, linearRgb);
  }
}

export function xyzD65ToLinearRgb(
  xyz: Vector3,
  space: StandardRgbSpaceId,
): Vector3 {
  switch (space) {
    case "srgb":
    case "linear-srgb":
      return multiplyMatrix3x3Vector3(XYZ_D65_TO_SRGB, xyz);
    case "display-p3":
      return multiplyMatrix3x3Vector3(XYZ_D65_TO_DISPLAY_P3, xyz);
    case "adobe-rgb":
      return multiplyMatrix3x3Vector3(XYZ_D65_TO_ADOBE_RGB, xyz);
  }
}

// CIEXYZ (D50) <-> CIEXYZ (D65) via Bradford
export function xyzD65ToD50(xyzD65: Vector3): Vector3 {
  return multiplyMatrix3x3Vector3(BRADFORD_D65_TO_D50, xyzD65);
}

export function xyzD50ToD65(xyzD50: Vector3): Vector3 {
  return multiplyMatrix3x3Vector3(BRADFORD_D50_TO_D65, xyzD50);
}

// CIEXYZ (D50 standard PCS) <-> CIELAB (L*a*b*)
const LAB_EPSILON = 216 / 24389; // (6/29)^3 ≈ 0.008856
const LAB_KAPPA = 24389 / 27; // (29/3)^3 ≈ 903.3

function labF(t: number): number {
  if (t > LAB_EPSILON) {
    return Math.cbrt(t);
  }
  return (LAB_KAPPA * t + 16) / 116;
}

function labFInverse(t: number): number {
  if (t > 6 / 29) {
    return t * t * t;
  }
  return (116 * t - 16) / LAB_KAPPA;
}

export function xyzD50ToLab(xyzD50: Vector3): Vector3 {
  const xr = xyzD50[0] / WHITE_POINT_D50.X;
  const yr = xyzD50[1] / WHITE_POINT_D50.Y;
  const zr = xyzD50[2] / WHITE_POINT_D50.Z;

  const fx = labF(xr);
  const fy = labF(yr);
  const fz = labF(zr);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return [L, a, b];
}

export function labToXyzD50(lab: Vector3): Vector3 {
  const L = lab[0];
  const a = lab[1];
  const b = lab[2];

  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const xr = labFInverse(fx);
  const yr = labFInverse(fy);
  const zr = labFInverse(fz);

  return [
    xr * WHITE_POINT_D50.X,
    yr * WHITE_POINT_D50.Y,
    zr * WHITE_POINT_D50.Z,
  ];
}

// Simple CMYK standard conversions for reference & print evaluation
export function rgbToCmyk(rgb: Vector3): [number, number, number, number] {
  const r = Math.max(0, Math.min(1, rgb[0]));
  const g = Math.max(0, Math.min(1, rgb[1]));
  const b = Math.max(0, Math.min(1, rgb[2]));

  const k = 1 - Math.max(r, g, b);
  if (k >= 0.9999) {
    return [0, 0, 0, 1];
  }
  const c = (1 - r - k) / (1 - k);
  const m = (1 - g - k) / (1 - k);
  const y = (1 - b - k) / (1 - k);

  return [c, m, y, k];
}

export function cmykToRgb(cmyk: [number, number, number, number]): Vector3 {
  const c = Math.max(0, Math.min(1, cmyk[0]));
  const m = Math.max(0, Math.min(1, cmyk[1]));
  const y = Math.max(0, Math.min(1, cmyk[2]));
  const k = Math.max(0, Math.min(1, cmyk[3]));

  const r = (1 - c) * (1 - k);
  const g = (1 - m) * (1 - k);
  const b = (1 - y) * (1 - k);

  return [r, g, b];
}
