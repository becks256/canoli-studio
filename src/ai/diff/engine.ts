import { selectionRegionTransform } from "../../core/drawing";
import type { SelectionData } from "../../core/drawing";
/**
 * Protected Masked Edit & Composite Verification Engine (Ticket T13 / A05/A06).
 *
 * Implements:
 * 1. Strict mathematical verification of the A06 exact-region invariant (zero difference
 *    in protected pixels, deterministic reference comparison, boundary feathering,
 *    and transparent rejection on incompatible edits).
 * 2. Visual difference heatmap generation (highlighting valid generative edits vs. protected violations).
 * 3. Protected composite guard kernel that guarantees byte-for-byte preservation of
 *    protected regions and source pixels outside the editable mask.
 */

import type {
  CompositeProtectedEditOptions,
  ProtectedInvariantEvaluationOptions,
  ProtectedInvariantReport,
  ProtectedRegion,
} from "./types";

/**
 * Applies a separable 1D moving-average box blur to feather mask coverage.
 */
export function featherMask(
  src: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return src;
  const r = Math.min(Math.round(radius), Math.min(width, height) - 1);
  if (r <= 0) return src;

  const total = width * height;
  const temp = new Float32Array(total);
  const out = new Uint8Array(total);
  const windowSize = 2 * r + 1;

  // Horizontal blur pass
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) {
      const clampedX = Math.max(0, Math.min(width - 1, x));
      sum += src[row + clampedX];
    }
    for (let x = 0; x < width; x++) {
      temp[row + x] = sum / windowSize;
      const removeX = Math.max(0, Math.min(width - 1, x - r));
      const addX = Math.max(0, Math.min(width - 1, x + r + 1));
      sum += src[row + addX] - src[row + removeX];
    }
  }

  // Vertical blur pass
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) {
      const clampedY = Math.max(0, Math.min(height - 1, y));
      sum += temp[clampedY * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / windowSize);
      const removeY = Math.max(0, Math.min(height - 1, y - r));
      const addY = Math.max(0, Math.min(height - 1, y + r + 1));
      sum += temp[addY * width + x] - temp[removeY * width + x];
    }
  }

  return out;
}

/**
 * Rasterizes geometric protected regions into a Uint8Array coverage mask (255 = protected).
 */
export function rasterizeProtectedRegions(
  regions: ProtectedRegion[],
  width: number,
  height: number,
  featherRadius: number = 0,
): Uint8Array {
  const mask = new Uint8Array(width * height);

  for (const region of regions) {
    const rx = Math.max(0, Math.floor(region.x));
    const ry = Math.max(0, Math.floor(region.y));
    const maxX = Math.max(
      rx,
      Math.min(width, Math.ceil(region.x + region.width)),
    );
    const maxY = Math.max(
      ry,
      Math.min(height, Math.ceil(region.y + region.height)),
    );

    if (region.shape === "ellipse") {
      const centerX = region.x + region.width / 2;
      const centerY = region.y + region.height / 2;
      const radiusX = Math.max(1, region.width / 2);
      const radiusY = Math.max(1, region.height / 2);

      for (let y = ry; y < maxY; y++) {
        for (let x = rx; x < maxX; x++) {
          const dx = (x - centerX) / radiusX;
          const dy = (y - centerY) / radiusY;
          if (dx * dx + dy * dy <= 1.0) {
            mask[y * width + x] = 255;
          }
        }
      }
    } else {
      // Rectangle
      for (let y = ry; y < maxY; y++) {
        const rowOffset = y * width;
        for (let x = rx; x < maxX; x++) {
          mask[rowOffset + x] = 255;
        }
      }
    }
  }

  return featherRadius > 0
    ? featherMask(mask, width, height, featherRadius)
    : mask;
}

/**
 * Rasterizes SelectionData regions into a Uint8Array edit coverage mask (255 = selected).
 */
export function rasterizeSelection(
  selection: SelectionData,
  width: number,
  height: number,
  featherRadius: number = 0,
): Uint8Array {
  const mask = new Uint8Array(width * height);

  for (const reg of selection.regions) {
    const transform = selectionRegionTransform(reg);
    const inverse = transform.inverse();
    const bounds = transform.bounds(reg);
    const rx = Math.max(0, Math.min(width, Math.floor(bounds.x)));
    const ry = Math.max(0, Math.min(height, Math.floor(bounds.y)));
    const maxX = Math.max(
      rx,
      Math.min(width, Math.ceil(bounds.x + bounds.width)),
    );
    const maxY = Math.max(
      ry,
      Math.min(height, Math.ceil(bounds.y + bounds.height)),
    );
    if (reg.operation === "intersect") {
      for (let y = 0; y < height; y++) {
        if (y < ry || y >= maxY) mask.fill(0, y * width, (y + 1) * width);
        else {
          mask.fill(0, y * width, y * width + rx);
          mask.fill(0, y * width + maxX, (y + 1) * width);
        }
      }
    }
    for (let y = ry; y < maxY; y++)
      for (let x = rx; x < maxX; x++) {
        const point = inverse.point({ x, y });
        let inside =
          point.x >= reg.x &&
          point.x < reg.x + reg.width &&
          point.y >= reg.y &&
          point.y < reg.y + reg.height;
        if (inside && reg.shape === "ellipse") {
          const dx = (point.x - reg.x - reg.width / 2) / (reg.width / 2);
          const dy = (point.y - reg.y - reg.height / 2) / (reg.height / 2);
          inside = dx * dx + dy * dy <= 1;
        }
        const i = y * width + x;
        if (reg.operation === "intersect")
          mask[i] = inside && mask[i] === 255 ? 255 : 0;
        else if (inside) mask[i] = reg.operation === "add" ? 255 : 0;
      }
  }

  return featherRadius > 0
    ? featherMask(mask, width, height, featherRadius)
    : mask;
}

/**
 * Evaluates the A06 exact-region invariant between a pre-edit reference composite
 * and a generated candidate edit.
 *
 * Enforces zero-difference (tolerance Δ = 0) inside fully protected regions and
 * validates boundary feathering transitions.
 */
export function evaluateProtectedRegionInvariant(
  options: ProtectedInvariantEvaluationOptions,
): ProtectedInvariantReport {
  const {
    referenceBuffer,
    candidateBuffer,
    width,
    height,
    tolerance = 0,
    generateHeatmap = true,
  } = options;

  const totalPixels = width * height;
  const expectedByteLength = totalPixels * 4;

  if (referenceBuffer.length < expectedByteLength) {
    throw new Error(
      `Reference buffer size (${referenceBuffer.length}) does not match expected dimensions (${width}x${height}x4 = ${expectedByteLength}).`,
    );
  }
  if (candidateBuffer.length < expectedByteLength) {
    throw new Error(
      `Candidate buffer size (${candidateBuffer.length}) does not match expected dimensions (${width}x${height}x4 = ${expectedByteLength}).`,
    );
  }
  if (options.protectedMask && options.protectedMask.length < totalPixels) {
    throw new Error(
      `Protected mask buffer size (${options.protectedMask.length}) does not match expected pixel count (${totalPixels}).`,
    );
  }
  if (options.editMask && options.editMask.length < totalPixels) {
    throw new Error(
      `Edit mask buffer size (${options.editMask.length}) does not match expected pixel count (${totalPixels}).`,
    );
  }

  // Build effective protected coverage mask
  let protectedMask: Uint8Array | null = null;
  if (options.protectedMask && options.protectedRegions?.length) {
    const geoMask = rasterizeProtectedRegions(
      options.protectedRegions,
      width,
      height,
      options.featherRadius,
    );
    protectedMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      protectedMask[i] = Math.max(options.protectedMask[i], geoMask[i]);
    }
  } else if (options.protectedMask) {
    protectedMask = options.protectedMask;
  } else if (options.protectedRegions?.length) {
    protectedMask = rasterizeProtectedRegions(
      options.protectedRegions,
      width,
      height,
      options.featherRadius,
    );
  }

  const editMask = options.editMask;

  let violatedPixelCount = 0;
  let totalProtectedPixels = 0;
  let maxChannelDifference = 0;
  let protectedSqErrorSum = 0;
  let editRegionPixelCount = 0;
  let editSqErrorSum = 0;
  let alteredPixelCount = 0;
  let featherViolationsCount = 0;

  const heatmapBuffer = generateHeatmap
    ? new Uint8Array(totalPixels * 4)
    : undefined;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;

    const rR = referenceBuffer[idx];
    const rG = referenceBuffer[idx + 1];
    const rB = referenceBuffer[idx + 2];
    const rA = referenceBuffer[idx + 3];

    const cR = candidateBuffer[idx];
    const cG = candidateBuffer[idx + 1];
    const cB = candidateBuffer[idx + 2];
    const cA = candidateBuffer[idx + 3];

    const dR = Math.abs(rR - cR);
    const dG = Math.abs(rG - cG);
    const dB = Math.abs(rB - cB);
    const dA = Math.abs(rA - cA);

    const maxDelta = Math.max(dR, dG, dB, dA);
    const sqDelta = (dR * dR + dG * dG + dB * dB + dA * dA) / 4;

    if (maxDelta > 0) {
      alteredPixelCount++;
    }

    const pw = protectedMask ? protectedMask[i] : 0;
    const ew = editMask ? editMask[i] : 255;

    let isProtectedViolation = false;
    let isFeatherViolation = false;

    if (pw > 0) {
      totalProtectedPixels++;

      if (pw === 255) {
        // Fully protected pixel: exact invariant requires maxDelta <= tolerance (tolerance = 0)
        if (maxDelta > tolerance) {
          violatedPixelCount++;
          isProtectedViolation = true;
          protectedSqErrorSum += sqDelta;
          if (maxDelta > maxChannelDifference) {
            maxChannelDifference = maxDelta;
          }
        }
      } else {
        // Feather transition pixel: allowed delta scaled by (1 - pw / 255)
        const allowedDelta = Math.round((1.0 - pw / 255) * 255) + tolerance;
        if (maxDelta > allowedDelta) {
          featherViolationsCount++;
          isFeatherViolation = true;
          if (maxDelta > maxChannelDifference) {
            maxChannelDifference = maxDelta;
          }
        }
      }
    }

    if (ew > 0) {
      editRegionPixelCount++;
      editSqErrorSum += sqDelta;
    }

    // Generate Heatmap RGBA visualization
    if (heatmapBuffer) {
      if (isProtectedViolation) {
        // High-visibility RED for protected invariant violations
        heatmapBuffer[idx] = 255;
        heatmapBuffer[idx + 1] = 30;
        heatmapBuffer[idx + 2] = 30;
        heatmapBuffer[idx + 3] = Math.min(255, 140 + maxDelta);
      } else if (isFeatherViolation) {
        // ORANGE for boundary feather violations
        heatmapBuffer[idx] = 255;
        heatmapBuffer[idx + 1] = 120;
        heatmapBuffer[idx + 2] = 20;
        heatmapBuffer[idx + 3] = Math.min(255, 140 + maxDelta);
      } else if (maxDelta > 0) {
        // GREEN/CYAN for legitimate generative edits within allowed region
        heatmapBuffer[idx] = 46;
        heatmapBuffer[idx + 1] = 204;
        heatmapBuffer[idx + 2] = 113;
        heatmapBuffer[idx + 3] = Math.min(220, 50 + Math.round(maxDelta * 0.7));
      } else if (pw === 255) {
        // Fully preserved protected pixel: transparent
        heatmapBuffer[idx] = 0;
        heatmapBuffer[idx + 1] = 0;
        heatmapBuffer[idx + 2] = 0;
        heatmapBuffer[idx + 3] = 0;
      } else {
        // Untouched pixel
        heatmapBuffer[idx] = 0;
        heatmapBuffer[idx + 1] = 0;
        heatmapBuffer[idx + 2] = 0;
        heatmapBuffer[idx + 3] = 0;
      }
    }
  }

  const meanSquaredError =
    totalProtectedPixels > 0
      ? Math.round((protectedSqErrorSum / totalProtectedPixels) * 100) / 100
      : 0;
  const editRegionMeanSquaredError =
    editRegionPixelCount > 0
      ? Math.round((editSqErrorSum / editRegionPixelCount) * 100) / 100
      : 0;
  const preservedPercentage =
    totalProtectedPixels > 0
      ? Math.round(
          ((totalProtectedPixels - violatedPixelCount) / totalProtectedPixels) *
            10000,
        ) / 100
      : 100.0;

  const passed = violatedPixelCount === 0 && featherViolationsCount === 0;

  const diagnosticErrors: string[] = [];
  if (violatedPixelCount > 0) {
    diagnosticErrors.push(
      `Protected region invariant violated: ${violatedPixelCount} pixel${
        violatedPixelCount > 1 ? "s" : ""
      } altered inside protected region (max channel Δ = ${maxChannelDifference}).`,
    );
  }
  if (featherViolationsCount > 0) {
    diagnosticErrors.push(
      `Boundary feathering transition violated at ${featherViolationsCount} pixel${
        featherViolationsCount > 1 ? "s" : ""
      }.`,
    );
  }

  let summary: string;
  if (passed) {
    summary = `Protected region invariant verified: 0 violations across ${totalProtectedPixels} protected pixels (${preservedPercentage.toFixed(
      1,
    )}% preserved, max Δ = ${maxChannelDifference}).`;
  } else if (violatedPixelCount > 0) {
    summary = `Protected region invariant VIOLATED: ${violatedPixelCount} protected pixels altered (max channel Δ = ${maxChannelDifference}, MSE = ${meanSquaredError.toFixed(
      2,
    )}).`;
  } else {
    summary = `Protected region invariant VIOLATED: ${featherViolationsCount} boundary feather transition violations (max channel Δ = ${maxChannelDifference}).`;
  }

  return {
    passed,
    violatedPixelCount,
    totalProtectedPixels,
    maxChannelDifference,
    meanSquaredError,
    editRegionMeanSquaredError,
    alteredPixelCount,
    preservedPercentage,
    featherViolationsCount,
    heatmapBuffer,
    summary,
    diagnosticErrors,
  };
}

/**
 * Compositing Guard Kernel for Protected Masked Edits.
 *
 * Clamps generated inpainting strictly to the allowed editable mask while
 * guaranteeing byte-for-byte preservation (Δ = 0) of protected regions and
 * source pixels outside the edit mask.
 */
export function compositeProtectedEdit(
  options: CompositeProtectedEditOptions,
): Uint8Array {
  const { referenceBuffer, candidateBuffer, width, height } = options;
  const totalPixels = width * height;
  const expectedByteLength = totalPixels * 4;

  if (referenceBuffer.length < expectedByteLength) {
    throw new Error(
      `Reference buffer size (${referenceBuffer.length}) does not match expected dimensions (${width}x${height}x4 = ${expectedByteLength}).`,
    );
  }
  if (candidateBuffer.length < expectedByteLength) {
    throw new Error(
      `Candidate buffer size (${candidateBuffer.length}) does not match expected dimensions (${width}x${height}x4 = ${expectedByteLength}).`,
    );
  }
  if (options.protectedMask && options.protectedMask.length < totalPixels) {
    throw new Error(
      `Protected mask buffer size (${options.protectedMask.length}) does not match expected pixel count (${totalPixels}).`,
    );
  }
  if (options.editMask && options.editMask.length < totalPixels) {
    throw new Error(
      `Edit mask buffer size (${options.editMask.length}) does not match expected pixel count (${totalPixels}).`,
    );
  }

  const output = new Uint8Array(totalPixels * 4);

  // Build effective protected coverage mask
  let protectedMask: Uint8Array | null = null;
  if (options.protectedMask && options.protectedRegions?.length) {
    const geoMask = rasterizeProtectedRegions(
      options.protectedRegions,
      width,
      height,
      options.featherRadius,
    );
    protectedMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      protectedMask[i] = Math.max(options.protectedMask[i], geoMask[i]);
    }
  } else if (options.protectedMask) {
    protectedMask = options.protectedMask;
  } else if (options.protectedRegions?.length) {
    protectedMask = rasterizeProtectedRegions(
      options.protectedRegions,
      width,
      height,
      options.featherRadius,
    );
  }

  const editMask = options.editMask;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;

    const pw = protectedMask ? protectedMask[i] / 255 : 0;
    const ew = editMask ? editMask[i] / 255 : 1.0;

    // Invariant Rule: Protected content takes absolute priority
    if (pw >= 1.0) {
      // 100% protected: byte-for-byte reference copy (zero difference)
      output[idx] = referenceBuffer[idx];
      output[idx + 1] = referenceBuffer[idx + 1];
      output[idx + 2] = referenceBuffer[idx + 2];
      output[idx + 3] = referenceBuffer[idx + 3];
      continue;
    }

    // Outside edit mask: byte-for-byte reference copy
    if (ew <= 0) {
      output[idx] = referenceBuffer[idx];
      output[idx + 1] = referenceBuffer[idx + 1];
      output[idx + 2] = referenceBuffer[idx + 2];
      output[idx + 3] = referenceBuffer[idx + 3];
      continue;
    }

    // Effective candidate blending weight
    const weight = Math.max(0, Math.min(1.0, ew * (1.0 - pw)));

    if (weight <= 0.0) {
      output[idx] = referenceBuffer[idx];
      output[idx + 1] = referenceBuffer[idx + 1];
      output[idx + 2] = referenceBuffer[idx + 2];
      output[idx + 3] = referenceBuffer[idx + 3];
    } else if (weight >= 1.0) {
      output[idx] = candidateBuffer[idx];
      output[idx + 1] = candidateBuffer[idx + 1];
      output[idx + 2] = candidateBuffer[idx + 2];
      output[idx + 3] = candidateBuffer[idx + 3];
    } else {
      // Feathered boundary interpolation
      output[idx] = Math.round(
        referenceBuffer[idx] * (1.0 - weight) + candidateBuffer[idx] * weight,
      );
      output[idx + 1] = Math.round(
        referenceBuffer[idx + 1] * (1.0 - weight) +
          candidateBuffer[idx + 1] * weight,
      );
      output[idx + 2] = Math.round(
        referenceBuffer[idx + 2] * (1.0 - weight) +
          candidateBuffer[idx + 2] * weight,
      );
      output[idx + 3] = Math.round(
        referenceBuffer[idx + 3] * (1.0 - weight) +
          candidateBuffer[idx + 3] * weight,
      );
    }
  }

  return output;
}
