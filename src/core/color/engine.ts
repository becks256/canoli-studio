/**
 * Color conversion engine, difference metrics (Delta E 76 / 2000),
 * gamut checking, and soft-proofing mask generation.
 */

import type {
  ColorSpaceId,
  GamutEvaluationResult,
  RenderingIntent,
  StandardRgbSpaceId,
  Vector3,
} from "./types";
import {
  cmykToRgb,
  fromLinearRgb,
  labToXyzD50,
  linearRgbToXyzD65,
  rgbToCmyk,
  toLinearRgb,
  xyzD50ToD65,
  xyzD50ToLab,
  xyzD65ToD50,
  xyzD65ToLinearRgb,
} from "./spaces";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Converts a 3D color vector from one color space to another.
 */
export function convertColor(
  color: Vector3,
  fromSpace: ColorSpaceId,
  toSpace: ColorSpaceId,
  intent: RenderingIntent = "relative-colorimetric",
): Vector3 {
  if (fromSpace === toSpace) {
    return [color[0], color[1], color[2]];
  }

  // 1. Convert source color to CIEXYZ (D50, PCS)
  let xyzD50: Vector3;

  if (fromSpace === "cielab") {
    xyzD50 = labToXyzD50(color);
  } else if (fromSpace === "xyz") {
    // Assume input XYZ is D50 (PCS)
    xyzD50 = [color[0], color[1], color[2]];
  } else if (fromSpace === "cmyk") {
    // CMYK -> sRGB -> XYZ
    const rgb = cmykToRgb([color[0], color[1], color[2], 0]);
    const lin = toLinearRgb(rgb, "srgb");
    const xyzD65 = linearRgbToXyzD65(lin, "srgb");
    xyzD50 = xyzD65ToD50(xyzD65);
  } else {
    // fromSpace is a StandardRgbSpaceId
    const lin = toLinearRgb(color, fromSpace);
    const xyzD65 = linearRgbToXyzD65(lin, fromSpace);
    xyzD50 = xyzD65ToD50(xyzD65);
  }

  // 2. Convert from CIEXYZ (D50) to target space
  if (toSpace === "cielab") {
    return xyzD50ToLab(xyzD50);
  }
  if (toSpace === "xyz") {
    return xyzD50;
  }
  if (toSpace === "cmyk") {
    const xyzD65 = xyzD50ToD65(xyzD50);
    const lin = xyzD65ToLinearRgb(xyzD65, "srgb");
    const srgb = fromLinearRgb(lin, "srgb");
    const cmyk = rgbToCmyk(srgb);
    return [cmyk[0], cmyk[1], cmyk[2]]; // Returns CMY (K stored separately if needed)
  }

  // toSpace is a StandardRgbSpaceId
  const xyzD65 = xyzD50ToD65(xyzD50);
  const linTarget = xyzD65ToLinearRgb(xyzD65, toSpace);
  const rawTargetRgb = fromLinearRgb(linTarget, toSpace);

  if (intent === "relative-colorimetric") {
    // Relative colorimetric clips out-of-gamut values to [0, 1]
    return [
      Math.max(0, Math.min(1, rawTargetRgb[0])),
      Math.max(0, Math.min(1, rawTargetRgb[1])),
      Math.max(0, Math.min(1, rawTargetRgb[2])),
    ];
  }

  // "unclipped", perceptual, or absolute-colorimetric passes unclipped floats
  return rawTargetRgb;
}

/**
 * CIELAB Delta E 1976 (standard Euclidean distance).
 */
export function deltaE76(lab1: Vector3, lab2: Vector3): number {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * CIEDE2000 color difference formula (CIE standard ISO/CIE 11664-6:2014).
 */
export function deltaE2000(
  lab1: Vector3,
  lab2: Vector3,
  kL = 1,
  kC = 1,
  kH = 1,
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const avgL = (L1 + L2) / 2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;

  const avgC7 = Math.pow(avgC, 7);
  const G = 0.5 * (1 - Math.sqrt(avgC7 / (avgC7 + 6103515625))); // 25^7 = 6103515625

  const a1Prime = (1 + G) * a1;
  const a2Prime = (1 + G) * a2;

  const C1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
  const C2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);
  const avgCPrime = (C1Prime + C2Prime) / 2;

  let h1Prime = Math.atan2(b1, a1Prime) * RAD_TO_DEG;
  if (h1Prime < 0) h1Prime += 360;

  let h2Prime = Math.atan2(b2, a2Prime) * RAD_TO_DEG;
  if (h2Prime < 0) h2Prime += 360;

  let diffHPrime = h2Prime - h1Prime;
  if (Math.abs(diffHPrime) > 180) {
    if (h2Prime <= h1Prime) {
      diffHPrime += 360;
    } else {
      diffHPrime -= 360;
    }
  }

  const deltaHPrime =
    2 * Math.sqrt(C1Prime * C2Prime) * Math.sin((diffHPrime * DEG_TO_RAD) / 2);

  let avgHPrime = (h1Prime + h2Prime) / 2;
  if (Math.abs(h1Prime - h2Prime) > 180) {
    if (h1Prime + h2Prime < 360) {
      avgHPrime += 180;
    } else {
      avgHPrime -= 180;
    }
  }

  const deltaLPrime = L2 - L1;
  const deltaCPrime = C2Prime - C1Prime;

  const T =
    1 -
    0.17 * Math.cos((avgHPrime - 30) * DEG_TO_RAD) +
    0.24 * Math.cos(2 * avgHPrime * DEG_TO_RAD) +
    0.32 * Math.cos((3 * avgHPrime + 6) * DEG_TO_RAD) -
    0.2 * Math.cos((4 * avgHPrime - 63) * DEG_TO_RAD);

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHPrime - 275) / 25, 2));

  const avgCPrime7 = Math.pow(avgCPrime, 7);
  const RC = 2 * Math.sqrt(avgCPrime7 / (avgCPrime7 + 6103515625));

  const SL =
    1 +
    (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCPrime;
  const SH = 1 + 0.015 * avgCPrime * T;
  const RT = -Math.sin(2 * deltaTheta * DEG_TO_RAD) * RC;

  const termL = deltaLPrime / (kL * SL);
  const termC = deltaCPrime / (kC * SC);
  const termH = deltaHPrime / (kH * SH);

  return Math.sqrt(
    termL * termL + termC * termC + termH * termH + RT * termC * termH,
  );
}

/**
 * Checks if a color is strictly within target RGB gamut (with epsilon margin).
 */
export function isInsideGamut(rgb: Vector3, epsilon = 1e-4): boolean {
  return (
    rgb[0] >= -epsilon &&
    rgb[0] <= 1 + epsilon &&
    rgb[1] >= -epsilon &&
    rgb[1] <= 1 + epsilon &&
    rgb[2] >= -epsilon &&
    rgb[2] <= 1 + epsilon
  );
}

/**
 * Evaluates whether a source color falls inside the target RGB gamut,
 * calculating color shift and delta E when clipped.
 */
export function evaluateGamut(
  sourceColor: Vector3,
  sourceSpace: StandardRgbSpaceId,
  targetSpace: StandardRgbSpaceId,
): GamutEvaluationResult {
  const unclippedTarget = convertColor(
    sourceColor,
    sourceSpace,
    targetSpace,
    "absolute-colorimetric", // Pass unclipped floats
  );

  const inGamut = isInsideGamut(unclippedTarget);

  const clippedColor: Vector3 = [
    Math.max(0, Math.min(1, unclippedTarget[0])),
    Math.max(0, Math.min(1, unclippedTarget[1])),
    Math.max(0, Math.min(1, unclippedTarget[2])),
  ];

  let maxExcursion = 0;
  for (let i = 0; i < 3; i++) {
    if (unclippedTarget[i] < 0) {
      maxExcursion = Math.max(maxExcursion, -unclippedTarget[i]);
    } else if (unclippedTarget[i] > 1) {
      maxExcursion = Math.max(maxExcursion, unclippedTarget[i] - 1);
    }
  }

  // Compute Delta E between original in Lab and clipped in Lab
  const origLab = convertColor(sourceColor, sourceSpace, "cielab");
  const clippedLab = convertColor(clippedColor, targetSpace, "cielab");

  return {
    inGamut,
    maxExcursion,
    deltaE76: deltaE76(origLab, clippedLab),
    deltaE2000: deltaE2000(origLab, clippedLab),
    clippedColor,
  };
}

/**
 * Converts an entire ImageData pixel buffer from source color space to target color space.
 */
export function convertImageData(
  sourceData: ImageData,
  sourceSpace: StandardRgbSpaceId,
  targetSpace: StandardRgbSpaceId,
  intent: RenderingIntent = "relative-colorimetric",
): ImageData {
  if (sourceSpace === targetSpace) {
    return new ImageData(
      new Uint8ClampedArray(sourceData.data),
      sourceData.width,
      sourceData.height,
    );
  }

  const result = new ImageData(sourceData.width, sourceData.height);
  const src = sourceData.data;
  const dst = result.data;
  const len = src.length;

  for (let i = 0; i < len; i += 4) {
    const a = src[i + 3];
    if (a === 0) {
      dst[i] = 0;
      dst[i + 1] = 0;
      dst[i + 2] = 0;
      dst[i + 3] = 0;
      continue;
    }

    const rgb: Vector3 = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const converted = convertColor(rgb, sourceSpace, targetSpace, intent);

    dst[i] = Math.round(Math.max(0, Math.min(1, converted[0])) * 255);
    dst[i + 1] = Math.round(Math.max(0, Math.min(1, converted[1])) * 255);
    dst[i + 2] = Math.round(Math.max(0, Math.min(1, converted[2])) * 255);
    dst[i + 3] = a;
  }

  return result;
}

/**
 * Generates an out-of-gamut visualization overlay for soft-proofing.
 * Out-of-gamut pixels are highlighted with warningColor (e.g. Neon Cyan/Magenta),
 * while in-gamut pixels remain transparent.
 */
export function generateGamutWarningMask(
  imageData: ImageData,
  sourceSpace: StandardRgbSpaceId,
  targetSpace: StandardRgbSpaceId,
  warningColor: [number, number, number, number] = [0, 255, 255, 220],
): ImageData {
  const result = new ImageData(imageData.width, imageData.height);
  const src = imageData.data;
  const dst = result.data;
  const len = src.length;

  for (let i = 0; i < len; i += 4) {
    const a = src[i + 3];
    if (a < 10) continue; // Skip near-transparent pixels

    const rgb: Vector3 = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
    const targetCoord = convertColor(
      rgb,
      sourceSpace,
      targetSpace,
      "unclipped",
    );
    const rExc =
      targetCoord[0] < 0
        ? -targetCoord[0]
        : targetCoord[0] > 1
          ? targetCoord[0] - 1
          : 0;
    const gExc =
      targetCoord[1] < 0
        ? -targetCoord[1]
        : targetCoord[1] > 1
          ? targetCoord[1] - 1
          : 0;
    const bExc =
      targetCoord[2] < 0
        ? -targetCoord[2]
        : targetCoord[2] > 1
          ? targetCoord[2] - 1
          : 0;
    const maxExcursion = Math.max(rExc, gExc, bExc);

    if (maxExcursion > 0.005) {
      dst[i] = warningColor[0];
      dst[i + 1] = warningColor[1];
      dst[i + 2] = warningColor[2];
      dst[i + 3] = warningColor[3];
    }
  }

  return result;
}
