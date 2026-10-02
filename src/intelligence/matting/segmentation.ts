/**
 * Local deterministic salient-object segmentation and trimap generator (T19 / A04).
 * Evaluates image contrast, color variance, edge gradients, and spatial priors to extract
 * foreground subjects as reusable soft masks without requiring remote inference.
 */

import type { SelectionData } from "../../core/drawing";
import {
  TRIMAP_BACKGROUND,
  TRIMAP_FOREGROUND,
  TRIMAP_UNKNOWN,
  type SegmentationCandidate,
  type SelectSubjectOptions,
  type TrimapBuffer,
} from "./types";

/**
 * Detects the salient foreground subject in an RGBA image buffer.
 */
export function detectSalientSubject(
  input: Uint8Array | ImageData,
  widthOrOptions?: number | SelectSubjectOptions,
  heightParam?: number,
  optionsParam?: SelectSubjectOptions,
): SegmentationCandidate {
  let rgba: Uint8Array;
  let width: number;
  let height: number;
  let options: SelectSubjectOptions;

  if ("data" in input && typeof input.width === "number") {
    rgba = new Uint8Array(
      input.data.buffer,
      input.data.byteOffset,
      input.data.byteLength,
    );
    width = input.width;
    height = input.height;
    options = (typeof widthOrOptions === "object" ? widthOrOptions : {}) ?? {};
  } else {
    rgba = input as Uint8Array;
    width = widthOrOptions as number;
    height = heightParam!;
    options = optionsParam ?? {};
  }

  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    throw new Error(
      "Invalid image dimensions or buffer length for segmentation.",
    );
  }

  const threshold = options.threshold ?? 0.35;
  const numPixels = width * height;

  // 1. Calculate border background color model
  // The outer perimeter (top, bottom, left, right edges) provides the background prior
  const borderWidth = Math.max(
    1,
    Math.min(16, Math.floor(Math.min(width, height) / 20)),
  );
  let bgR = 0,
    bgG = 0,
    bgB = 0,
    bgCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (
        x < borderWidth ||
        x >= width - borderWidth ||
        y < borderWidth ||
        y >= height - borderWidth
      ) {
        const idx = (y * width + x) * 4;
        const a = rgba[idx + 3];
        if (a > 10) {
          bgR += rgba[idx];
          bgG += rgba[idx + 1];
          bgB += rgba[idx + 2];
          bgCount++;
        }
      }
    }
  }

  const meanBgR = bgCount > 0 ? bgR / bgCount : 255;
  const meanBgG = bgCount > 0 ? bgG / bgCount : 255;
  const meanBgB = bgCount > 0 ? bgB / bgCount : 255;

  // 2. Spatial center Gaussian prior
  const centerX = width / 2;
  const centerY = height / 2;
  const spatialSigmaSq = 2 * Math.pow(Math.max(width, height) * 0.45, 2);

  // 3. Compute luminance and Sobel edge gradient magnitude
  const luminance = new Float32Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    luminance[i] =
      0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
  }

  const gradients = new Float32Array(numPixels);
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      // Sobel kernel
      const gx =
        -luminance[idx - width - 1] +
        luminance[idx - width + 1] +
        -2 * luminance[idx - 1] +
        2 * luminance[idx + 1] +
        -luminance[idx + width - 1] +
        luminance[idx + width + 1];

      const gy =
        -luminance[idx - width - 1] -
        2 * luminance[idx - width] -
        luminance[idx - width + 1] +
        luminance[idx + width - 1] +
        2 * luminance[idx + width] +
        luminance[idx + width + 1];

      gradients[idx] = Math.sqrt(gx * gx + gy * gy) / 1020.0;
    }
  }

  // 4. Compute composite saliency score per pixel
  const saliency = new Float32Array(numPixels);
  let maxSaliency = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const pix = idx * 4;
      const a = rgba[pix + 3] / 255.0;

      if (a < 0.05) {
        saliency[idx] = 0;
        continue;
      }

      // Color distance from border background prior
      const dr = rgba[pix] - meanBgR;
      const dg = rgba[pix + 1] - meanBgG;
      const db = rgba[pix + 2] - meanBgB;
      const colorDist = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;

      // Spatial distance from canvas center
      const dxCenter = x - centerX;
      const dyCenter = y - centerY;
      const centerWeight = Math.exp(
        -(dxCenter * dxCenter + dyCenter * dyCenter) / spatialSigmaSq,
      );

      // Edge score
      const edge = gradients[idx];

      // Saliency combination
      const score =
        (colorDist * 0.55 + edge * 0.25 + 0.2) * (0.3 + 0.7 * centerWeight) * a;
      saliency[idx] = score;
      if (score > maxSaliency) maxSaliency = score;
    }
  }

  // Normalize saliency map
  const normFactor = maxSaliency > 0 ? 1.0 / maxSaliency : 1.0;
  const initialMask = new Uint8Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    initialMask[i] = saliency[i] * normFactor >= threshold ? 255 : 0;
  }

  // 5. Morphological hole filling (closing: dilation followed by erosion)
  const morphRadius = Math.max(
    1,
    Math.min(8, Math.round(Math.min(width, height) / 100)),
  );
  const dilated = dilateMask(initialMask, width, height, morphRadius);
  const closed = erodeMask(dilated, width, height, morphRadius);

  // 6. Connected Component Analysis: keep components near the center with significant area
  const cleanedMask = filterConnectedComponents(
    closed,
    width,
    height,
    centerX,
    centerY,
  );

  // 7. Calculate bounding box of the segmented subject
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let fgPixels = 0;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (cleanedMask[row + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        fgPixels++;
      }
    }
  }

  // Fallback if no subject passed the threshold (e.g. extremely low contrast image)
  if (fgPixels === 0 || minX > maxX) {
    minX = Math.round(width * 0.15);
    minY = Math.round(height * 0.15);
    maxX = Math.round(width * 0.85);
    maxY = Math.round(height * 0.85);
    for (let y = minY; y <= maxY; y++) {
      const row = y * width;
      for (let x = minX; x <= maxX; x++) {
        cleanedMask[row + x] = 255;
      }
    }
    fgPixels = (maxX - minX + 1) * (maxY - minY + 1);
  }

  // Apply optional expand radius
  let finalMask = cleanedMask;
  if ((options.expandRadius ?? 0) > 0) {
    finalMask = dilateMask(cleanedMask, width, height, options.expandRadius!);
  }

  const confidence = Math.min(
    1.0,
    Math.max(0.2, (fgPixels / numPixels) * 2.5 * maxSaliency),
  );

  return {
    bounds: {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1),
    },
    mask: finalMask,
    width,
    height,
    confidence,
    label: "Salient Subject",
  };
}

/**
 * Generates a 3-state Trimap (0 = background, 128 = unknown, 255 = foreground)
 * from a subject mask by expanding and eroding the transition boundary by radius.
 */
export function generateTrimapFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 10,
): TrimapBuffer {
  const r = Math.max(1, Math.min(64, Math.round(radius)));
  const eroded = erodeMask(mask, width, height, r);
  const dilated = dilateMask(mask, width, height, r);

  const trimap = new Uint8Array(width * height);

  for (let i = 0; i < trimap.length; i++) {
    if (eroded[i] >= 128) {
      trimap[i] = TRIMAP_FOREGROUND;
    } else if (dilated[i] >= 128) {
      trimap[i] = TRIMAP_UNKNOWN;
    } else {
      trimap[i] = TRIMAP_BACKGROUND;
    }
  }

  return {
    width,
    height,
    data: trimap,
  };
}

/**
 * Converts a subject mask and bounding box into SelectionData.
 */
export function maskToSelectionData(
  _mask: Uint8Array,
  _width: number,
  _height: number,
  bounds: { x: number; y: number; width: number; height: number },
): SelectionData {
  return {
    regions: [
      {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        shape: "rectangle",
        operation: "add",
      },
    ],
  };
}

/**
 * Fast separable box dilation for masks.
 */
export function dilateMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(src);
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      const startX = Math.max(0, x - radius);
      const endX = Math.min(width - 1, x + radius);
      for (let k = startX; k <= endX; k++) {
        const val = src[row + k];
        if (val > maxVal) {
          maxVal = val;
          if (maxVal === 255) break;
        }
      }
      temp[row + x] = maxVal;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let maxVal = 0;
      const startY = Math.max(0, y - radius);
      const endY = Math.min(height - 1, y + radius);
      for (let k = startY; k <= endY; k++) {
        const val = temp[k * width + x];
        if (val > maxVal) {
          maxVal = val;
          if (maxVal === 255) break;
        }
      }
      dst[y * width + x] = maxVal;
    }
  }

  return dst;
}

/**
 * Fast separable box erosion for masks.
 */
export function erodeMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(src);
  const temp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let minVal = 255;
      const startX = Math.max(0, x - radius);
      const endX = Math.min(width - 1, x + radius);
      for (let k = startX; k <= endX; k++) {
        const val = src[row + k];
        if (val < minVal) {
          minVal = val;
          if (minVal === 0) break;
        }
      }
      temp[row + x] = minVal;
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let minVal = 255;
      const startY = Math.max(0, y - radius);
      const endY = Math.min(height - 1, y + radius);
      for (let k = startY; k <= endY; k++) {
        const val = temp[k * width + x];
        if (val < minVal) {
          minVal = val;
          if (minVal === 0) break;
        }
      }
      dst[y * width + x] = minVal;
    }
  }

  return dst;
}

/**
 * Connected Component Labeling to eliminate small noise blobs and keep the primary subject.
 */
function filterConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
): Uint8Array {
  const labels = new Int32Array(mask.length);
  let currentLabel = 0;
  const componentAreas = new Map<number, number>();
  const componentCenterDist = new Map<number, number>();

  // 4-connected flood fill
  const stack: number[] = [];

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      if (mask[idx] > 0 && labels[idx] === 0) {
        currentLabel++;
        let area = 0;
        let sumX = 0;
        let sumY = 0;

        stack.push(idx);
        labels[idx] = currentLabel;

        while (stack.length > 0) {
          const curr = stack.pop()!;
          area++;
          const cx = curr % width;
          const cy = Math.floor(curr / width);
          sumX += cx;
          sumY += cy;

          // 4 neighbors
          if (cx > 0) {
            const left = curr - 1;
            if (mask[left] > 0 && labels[left] === 0) {
              labels[left] = currentLabel;
              stack.push(left);
            }
          }
          if (cx < width - 1) {
            const right = curr + 1;
            if (mask[right] > 0 && labels[right] === 0) {
              labels[right] = currentLabel;
              stack.push(right);
            }
          }
          if (cy > 0) {
            const up = curr - width;
            if (mask[up] > 0 && labels[up] === 0) {
              labels[up] = currentLabel;
              stack.push(up);
            }
          }
          if (cy < height - 1) {
            const down = curr + width;
            if (mask[down] > 0 && labels[down] === 0) {
              labels[down] = currentLabel;
              stack.push(down);
            }
          }
        }

        const avgX = sumX / area;
        const avgY = sumY / area;
        const dist = Math.hypot(avgX - centerX, avgY - centerY);
        componentAreas.set(currentLabel, area);
        componentCenterDist.set(currentLabel, dist);
      }
    }
  }

  if (currentLabel === 0) return mask;

  // Find max area and prioritize central components
  let maxArea = 0;
  for (const area of componentAreas.values()) {
    if (area > maxArea) maxArea = area;
  }

  const minAcceptableArea = Math.max(16, maxArea * 0.05);
  const validLabels = new Set<number>();

  for (const [lbl, area] of componentAreas.entries()) {
    if (area >= minAcceptableArea) {
      validLabels.add(lbl);
    }
  }

  const result = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (validLabels.has(labels[i])) {
      result[i] = 255;
    }
  }

  return result;
}
