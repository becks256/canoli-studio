/**
 * Core alpha matting engine and color decontamination kernel (T19 / A04).
 * Implements color-line Laplacian / KNN alpha estimation across trimap unknown zones,
 * guided spatial regularization, edge contrast shaping, and color decontamination.
 */

import {
  TRIMAP_BACKGROUND,
  TRIMAP_FOREGROUND,
  TRIMAP_UNKNOWN,
  type MattingOptions,
  type MattingResult,
  type TrimapBuffer,
} from "./types";

/**
 * Solves the alpha matte from an RGBA image and a 3-state Trimap buffer.
 */
export function solveAlphaMatte(
  rgbaOrImage: Uint8Array | ImageData,
  trimap: TrimapBuffer,
  options: MattingOptions = {},
): MattingResult {
  const width = trimap.width;
  const height = trimap.height;
  const numPixels = width * height;
  const rgba =
    "data" in rgbaOrImage
      ? new Uint8Array(
          rgbaOrImage.data.buffer,
          rgbaOrImage.data.byteOffset,
          rgbaOrImage.data.byteLength,
        )
      : rgbaOrImage;

  if (rgba.length < numPixels * 4 || trimap.data.length < numPixels) {
    throw new Error("Buffer length does not match specified dimensions.");
  }

  const alpha = new Uint8Array(numPixels);
  const trimapData = options.trimap ?? trimap.data;

  // Search window for local color-line estimation
  const searchRadius = Math.max(
    3,
    Math.min(25, Math.round(options.radius ?? 10)),
  );
  const spatialSigmaSq = 2 * Math.pow(searchRadius * 0.75, 2);

  let totalUnknown = 0;
  let solvedUnknown = 0;
  let colorSeparationSum = 0;

  // 1. Initial pass: set known pixels and identify unknown pixels
  for (let i = 0; i < numPixels; i++) {
    const val = trimapData[i];
    if (val === TRIMAP_FOREGROUND) {
      alpha[i] = 255;
    } else if (val === TRIMAP_BACKGROUND) {
      alpha[i] = 0;
    } else {
      totalUnknown++;
    }
  }

  // If there are no unknown pixels, return early
  if (totalUnknown === 0) {
    return {
      alpha,
      width,
      height,
      trimap: trimapData,
      confidence: 1.0,
      foregroundRgba:
        options.decontaminate !== false
          ? decontaminateColors(
              rgba,
              alpha,
              trimapData,
              width,
              height,
              options.decontaminateAmount ?? 1.0,
            )
          : undefined,
    };
  }

  // 2. Solve unknown pixels using local KNN color line model
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (trimapData[idx] !== TRIMAP_UNKNOWN) continue;

      const px = idx * 4;
      const r = rgba[px];
      const g = rgba[px + 1];
      const b = rgba[px + 2];

      // Collect weighted nearby known foreground and background pixels
      let fgR = 0,
        fgG = 0,
        fgB = 0,
        fgWeight = 0;
      let bgR = 0,
        bgG = 0,
        bgB = 0,
        bgWeight = 0;

      const minY = Math.max(0, y - searchRadius);
      const maxY = Math.min(height - 1, y + searchRadius);
      const minX = Math.max(0, x - searchRadius);
      const maxX = Math.min(width - 1, x + searchRadius);

      for (let ny = minY; ny <= maxY; ny++) {
        const nRow = ny * width;
        for (let nx = minX; nx <= maxX; nx++) {
          const nIdx = nRow + nx;
          const tVal = trimapData[nIdx];
          if (tVal !== TRIMAP_FOREGROUND && tVal !== TRIMAP_BACKGROUND)
            continue;

          const dx = nx - x;
          const dy = ny - y;
          const distSq = dx * dx + dy * dy;
          const w = Math.exp(-distSq / spatialSigmaSq);

          const nPix = nIdx * 4;
          if (tVal === TRIMAP_FOREGROUND) {
            fgR += rgba[nPix] * w;
            fgG += rgba[nPix + 1] * w;
            fgB += rgba[nPix + 2] * w;
            fgWeight += w;
          } else {
            bgR += rgba[nPix] * w;
            bgG += rgba[nPix + 1] * w;
            bgB += rgba[nPix + 2] * w;
            bgWeight += w;
          }
        }
      }

      // If either foreground or background is missing in local window, expand or fallback
      if (fgWeight === 0 && bgWeight === 0) {
        // Fallback: estimate from distance to nearest border
        alpha[idx] = 128;
        continue;
      }

      if (fgWeight === 0) {
        alpha[idx] = 0;
        continue;
      }

      if (bgWeight === 0) {
        alpha[idx] = 255;
        continue;
      }

      const meanFgR = fgR / fgWeight;
      const meanFgG = fgG / fgWeight;
      const meanFgB = fgB / fgWeight;

      const meanBgR = bgR / bgWeight;
      const meanBgG = bgG / bgWeight;
      const meanBgB = bgB / bgWeight;

      // Color line vector from background to foreground: V = F - B
      const vR = meanFgR - meanBgR;
      const vG = meanFgG - meanBgG;
      const vB = meanFgB - meanBgB;
      const vLenSq = vR * vR + vG * vG + vB * vB;

      // Color vector from background to current pixel: U = I - B
      const uR = r - meanBgR;
      const uG = g - meanBgG;
      const uB = b - meanBgB;

      let estAlpha = 0.5;
      if (vLenSq > 4) {
        // Dot product projection: (U . V) / |V|^2
        const dot = uR * vR + uG * vG + uB * vB;
        estAlpha = dot / vLenSq;
        colorSeparationSum += Math.sqrt(vLenSq);
      } else {
        // If foreground and background colors are nearly identical in this window,
        // weight by relative spatial proximity between fgWeight and bgWeight
        estAlpha = fgWeight / (fgWeight + bgWeight);
      }

      // Clamp to [0, 1] and scale to [0, 255]
      const clamped = Math.max(0, Math.min(1, estAlpha));
      alpha[idx] = Math.round(clamped * 255);
      solvedUnknown++;
    }
  }

  // 3. Guided spatial regularization (bilateral smoothing) to regularize noisy estimates
  const smoothness = options.smoothness ?? 10;
  if (smoothness > 0) {
    applyJointBilateralSmooth(
      alpha,
      rgba,
      trimapData,
      width,
      height,
      smoothness,
    );
  }

  // 4. Contrast curve adjustment (-100 to +100)
  if (options.contrast && options.contrast !== 0) {
    applyMatteContrast(alpha, trimapData, options.contrast);
  }

  // 5. Sub-pixel edge feathering (if configured)
  if (options.edgeFeather && options.edgeFeather > 0) {
    applyMatteFeather(alpha, trimapData, width, height, options.edgeFeather);
  }

  // 6. Color Bleeding Decontamination
  let foregroundRgba: Uint8Array | undefined;
  if (options.decontaminate !== false) {
    foregroundRgba = decontaminateColors(
      rgba,
      alpha,
      trimapData,
      width,
      height,
      options.decontaminateAmount ?? 1.0,
    );
  }

  const avgColorSep =
    solvedUnknown > 0 ? colorSeparationSum / solvedUnknown / 441.67 : 0.5;
  const confidence = Math.max(0.2, Math.min(1.0, avgColorSep * 0.7 + 0.3));

  return {
    alpha,
    width,
    height,
    trimap: trimapData,
    confidence,
    foregroundRgba,
  };
}

/**
 * Decontaminates background color bleeding from transition pixels (0 < alpha < 255).
 * Unmixes the background light: F_decon = (I - (1 - a) * B) / a
 */
export function decontaminateColors(
  rgbaOrImage: Uint8Array | ImageData,
  alpha: Uint8Array,
  trimapOrAmount?: Uint8Array | number,
  width?: number,
  height?: number,
  amount = 1.0,
): Uint8Array {
  let rgba: Uint8Array;
  let w: number;
  let h: number;
  let trimap: Uint8Array;
  let amt: number;

  if ("data" in rgbaOrImage && typeof rgbaOrImage.width === "number") {
    rgba = new Uint8Array(
      rgbaOrImage.data.buffer,
      rgbaOrImage.data.byteOffset,
      rgbaOrImage.data.byteLength,
    );
    w = rgbaOrImage.width;
    h = rgbaOrImage.height;
    amt = typeof trimapOrAmount === "number" ? trimapOrAmount : 1.0;
    trimap = new Uint8Array(w * h);
    for (let i = 0; i < trimap.length; i++) {
      trimap[i] =
        alpha[i] >= 240
          ? TRIMAP_FOREGROUND
          : alpha[i] <= 15
            ? TRIMAP_BACKGROUND
            : TRIMAP_UNKNOWN;
    }
  } else {
    rgba = rgbaOrImage as Uint8Array;
    trimap = trimapOrAmount as Uint8Array;
    w = width!;
    h = height!;
    amt = amount;
  }

  const output = new Uint8Array(rgba);
  const searchRadius = 8;
  const spatialSigmaSq = 2 * (searchRadius * 0.6) * (searchRadius * 0.6);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const a = alpha[idx] / 255.0;

      // Only decontaminate semi-transparent transition boundary pixels
      if (a <= 0.05 || a >= 0.98) continue;

      const px = idx * 4;
      const r = rgba[px];
      const g = rgba[px + 1];
      const b = rgba[px + 2];

      // Sample nearby background color
      let bgR = 0,
        bgG = 0,
        bgB = 0,
        bgWeight = 0;
      const minY = Math.max(0, y - searchRadius);
      const maxY = Math.min(h - 1, y + searchRadius);
      const minX = Math.max(0, x - searchRadius);
      const maxX = Math.min(w - 1, x + searchRadius);

      for (let ny = minY; ny <= maxY; ny++) {
        const nRow = ny * w;
        for (let nx = minX; nx <= maxX; nx++) {
          const nIdx = nRow + nx;
          if (trimap[nIdx] !== TRIMAP_BACKGROUND && alpha[nIdx] > 10) continue;

          const dx = nx - x;
          const dy = ny - y;
          const spatialW = Math.exp(-(dx * dx + dy * dy) / spatialSigmaSq);

          const nPix = nIdx * 4;
          bgR += rgba[nPix] * spatialW;
          bgG += rgba[nPix + 1] * spatialW;
          bgB += rgba[nPix + 2] * spatialW;
          bgWeight += spatialW;
        }
      }

      if (bgWeight === 0) continue;

      const meanBgR = bgR / bgWeight;
      const meanBgG = bgG / bgWeight;
      const meanBgB = bgB / bgWeight;

      // Unmix foreground color
      const invA = 1.0 - a;
      const safeA = Math.max(a, 0.12);

      const unmixedR = Math.max(0, Math.min(255, (r - invA * meanBgR) / safeA));
      const unmixedG = Math.max(0, Math.min(255, (g - invA * meanBgG) / safeA));
      const unmixedB = Math.max(0, Math.min(255, (b - invA * meanBgB) / safeA));

      // Blend with original color based on decontamination amount
      output[px] = Math.round(r * (1 - amt) + unmixedR * amt);
      output[px + 1] = Math.round(g * (1 - amt) + unmixedG * amt);
      output[px + 2] = Math.round(b * (1 - amt) + unmixedB * amt);
      output[px + 3] = alpha[idx];
    }
  }

  return output;
}

/**
 * Joint bilateral smoothing on unknown alpha matte values guided by image color.
 */
function applyJointBilateralSmooth(
  alpha: Uint8Array,
  rgba: Uint8Array,
  trimap: Uint8Array,
  width: number,
  height: number,
  strength: number,
): void {
  const radius = Math.max(1, Math.min(5, Math.round(strength / 20)));
  const colorSigmaSq = 2 * 30 * 30;
  const spatialSigmaSq = 2 * radius * radius;
  const temp = new Uint8Array(alpha);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (trimap[idx] !== TRIMAP_UNKNOWN) continue;

      const px = idx * 4;
      const r = rgba[px];
      const g = rgba[px + 1];
      const b = rgba[px + 2];

      let sumA = 0;
      let sumW = 0;

      const minY = Math.max(0, y - radius);
      const maxY = Math.min(height - 1, y + radius);
      const minX = Math.max(0, x - radius);
      const maxX = Math.min(width - 1, x + radius);

      for (let ny = minY; ny <= maxY; ny++) {
        const nRow = ny * width;
        for (let nx = minX; nx <= maxX; nx++) {
          const nIdx = nRow + nx;
          const nPix = nIdx * 4;

          const dx = nx - x;
          const dy = ny - y;
          const spatialDistSq = dx * dx + dy * dy;

          const dr = rgba[nPix] - r;
          const dg = rgba[nPix + 1] - g;
          const db = rgba[nPix + 2] - b;
          const colorDistSq = dr * dr + dg * dg + db * db;

          const w = Math.exp(
            -spatialDistSq / spatialSigmaSq - colorDistSq / colorSigmaSq,
          );
          sumA += temp[nIdx] * w;
          sumW += w;
        }
      }

      if (sumW > 0) {
        alpha[idx] = Math.round(sumA / sumW);
      }
    }
  }
}

/**
 * Adjusts alpha transition contrast via an S-curve.
 */
function applyMatteContrast(
  alpha: Uint8Array,
  trimap: Uint8Array,
  contrast: number,
): void {
  const factor = Math.max(-0.95, Math.min(3.0, contrast / 50.0));
  for (let i = 0; i < alpha.length; i++) {
    if (trimap[i] !== TRIMAP_UNKNOWN) continue;
    const aNorm = alpha[i] / 255.0;
    // S-curve centered around 0.5
    let adjusted: number;
    if (factor >= 0) {
      adjusted =
        aNorm >= 0.5
          ? 0.5 + 0.5 * Math.pow((aNorm - 0.5) * 2, 1 + factor)
          : 0.5 - 0.5 * Math.pow((0.5 - aNorm) * 2, 1 + factor);
    } else {
      const soften = 1.0 / (1.0 - factor);
      adjusted =
        aNorm >= 0.5
          ? 0.5 + 0.5 * Math.pow((aNorm - 0.5) * 2, soften)
          : 0.5 - 0.5 * Math.pow((0.5 - aNorm) * 2, soften);
    }
    alpha[i] = Math.round(Math.max(0, Math.min(1, adjusted)) * 255);
  }
}

/**
 * Fractional sub-pixel feathering on matte transition boundary.
 */
function applyMatteFeather(
  alpha: Uint8Array,
  trimap: Uint8Array,
  width: number,
  height: number,
  featherRadius: number,
): void {
  const radius = Math.max(1, Math.min(10, Math.round(featherRadius)));
  const temp = new Uint8Array(alpha);
  const sigma = radius / 2.0;
  const twoSigmaSq = 2 * sigma * sigma;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (trimap[idx] !== TRIMAP_UNKNOWN) continue;

      let sumA = 0;
      let sumW = 0;

      const minY = Math.max(0, y - radius);
      const maxY = Math.min(height - 1, y + radius);
      const minX = Math.max(0, x - radius);
      const maxX = Math.min(width - 1, x + radius);

      for (let ny = minY; ny <= maxY; ny++) {
        const nRow = ny * width;
        for (let nx = minX; nx <= maxX; nx++) {
          const nIdx = nRow + nx;
          const dx = nx - x;
          const dy = ny - y;
          const w = Math.exp(-(dx * dx + dy * dy) / twoSigmaSq);
          sumA += temp[nIdx] * w;
          sumW += w;
        }
      }

      if (sumW > 0) {
        alpha[idx] = Math.round(sumA / sumW);
      }
    }
  }
}
